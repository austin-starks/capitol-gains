import { progressDelta, readProgress } from "../progress";
import { createReceiptStore, type ReceiptStore } from "../receipts";
import { runRound } from "../round";
import type { DataStore, PutOptions, StoredObject } from "../ports";

/** An in-memory DataStore, so the round's own rules are what is under test. */
function memoryStore(): DataStore {
  const objects = new Map<string, Buffer>();
  return {
    async get(key) {
      const body = objects.get(key);
      if (!body) throw new Error(`missing ${key}`);
      return body;
    },
    async put(key, body) {
      objects.set(key, body);
    },
    async putIfAbsent(key, body) {
      if (objects.has(key)) return false;
      objects.set(key, body);
      return true;
    },
    async list(prefix) {
      const found: StoredObject[] = [];
      for (const [key, body] of objects) {
        if (key.startsWith(prefix)) found.push({ key, size: body.length });
      }
      return found;
    },
    async head(key) {
      const body = objects.get(key);
      return body ? { key, size: body.length } : null;
    },
    async exists(key) {
      return objects.has(key);
    },
  };
}

const receiptsFor = (store: DataStore): ReceiptStore =>
  createReceiptStore({ store, root: "receipts", roundId: "round-1" });

const body = (identity: string): Buffer => Buffer.from(JSON.stringify({ identity }));

describe("runRound", () => {
  it("works through a slice in batches and reports each pass", async () => {
    const store = memoryStore();
    const receipts = receiptsFor(store);
    const items = Array.from({ length: 7 }, (_, n) => ({ id: `item-${n}` }));

    const summary = await runRound({
      shard: { index: 0, count: 1 },
      receipts,
      list: async () => items,
      identityOf: (item) => item.id,
      process: async (batch) => batch.map((item) => ({ identity: item.id, body: body(item.id) })),
      batchSize: 3,
    });

    expect(summary.complete).toBe(true);
    expect(summary.passes.map((pass) => pass.processed)).toEqual([3, 3, 1]);
    expect((await receipts.finished()).size).toBe(7);
  });

  it("resumes rather than repeating what a previous run finished", async () => {
    const store = memoryStore();
    const receipts = receiptsFor(store);
    await receipts.write("item-0", body("item-0"));
    await receipts.write("item-1", body("item-1"));
    const seen: string[] = [];

    await runRound({
      shard: { index: 0, count: 1 },
      receipts,
      list: async () => Array.from({ length: 4 }, (_, n) => ({ id: `item-${n}` })),
      identityOf: (item) => item.id,
      process: async (batch) => {
        seen.push(...batch.map((item) => item.id));
        return batch.map((item) => ({ identity: item.id, body: body(item.id) }));
      },
      batchSize: 10,
    });

    expect(seen).toEqual(["item-2", "item-3"]);
  });

  it("stops instead of burning every pass when a pass finishes nothing", async () => {
    const store = memoryStore();
    let calls = 0;

    const summary = await runRound({
      shard: { index: 0, count: 1 },
      receipts: receiptsFor(store),
      list: async () => [{ id: "poison" }],
      identityOf: (item) => item.id,
      process: async () => {
        calls += 1;
        throw new Error("provider refused");
      },
      batchSize: 1,
      maxPasses: 50,
    });

    expect(calls).toBe(1);
    expect(summary.complete).toBe(false);
    expect(summary.passes[0]?.failures).toEqual(["provider refused"]);
  });
});

describe("progress", () => {
  it("counts receipts and splits them by shard", async () => {
    const store = memoryStore();
    const receipts = receiptsFor(store);
    for (let n = 0; n < 20; n += 1) await receipts.write(`item-${n}`, body(`item-${n}`));

    const reading = await readProgress(receipts, { shardCount: 4 });
    expect(reading.total).toBe(20);
    expect([...(reading.byShard?.values() ?? [])].reduce((a, b) => a + b, 0)).toBe(20);
    expect(reading.byShard?.size).toBe(4);
  });

  it("takes its rate from two readings, not from object timestamps", async () => {
    // Receipts flush in bursts, so a whole pass can share one modification second: on a live
    // round 389 of them did, which made a timestamp-derived rate read 23,340 per minute.
    const earlier = { at: new Date("2026-09-16T09:00:00Z"), total: 100 };
    const later = { at: new Date("2026-09-16T09:02:00Z"), total: 220 };

    const delta = progressDelta(earlier, later, 1000);
    expect(delta.added).toBe(120);
    expect(delta.perMinute).toBe(60);
    expect(delta.remaining).toBe(780);
    expect(delta.etaMs).toBe(13 * 60 * 1000);
  });
});
