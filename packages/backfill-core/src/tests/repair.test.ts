import type { DataStore, StoredObject } from "../ports";
import { createReceiptStore, repairRound, type ReceiptStore } from "../receipts";
import { runRound } from "../round";

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
    async delete(key) {
      objects.delete(key);
    },
  };
}

const receiptsFor = (store: DataStore): ReceiptStore =>
  createReceiptStore({ store, root: "receipts", roundId: "round-1" });

const receipt = (status: "ok" | "failed", reason = ""): Buffer =>
  Buffer.from(JSON.stringify({ status, reason }));

const statusOf = (body: Buffer): { status: string; reason: string } =>
  JSON.parse(body.toString("utf8")) as { status: string; reason: string };

describe("repair", () => {
  it("a failed receipt still makes the round skip the item", async () => {
    // The reason repair has to exist: a receipt recording failure is indistinguishable from
    // one recording success as far as the next pass is concerned.
    const store = memoryStore();
    const receipts = receiptsFor(store);
    await receipts.write("item-1", receipt("failed", "provider refused"));
    const seen: string[] = [];

    await runRound({
      shard: { index: 0, count: 1 },
      receipts,
      list: async () => [{ id: "item-1" }],
      identityOf: (item) => item.id,
      process: async (batch) => {
        seen.push(...batch.map((item) => item.id));
        return batch.map((item) => ({ identity: item.id, body: receipt("ok") }));
      },
      batchSize: 10,
    });

    expect(seen).toEqual([]);
  });

  it("reports what it would drop without touching anything", async () => {
    const store = memoryStore();
    const receipts = receiptsFor(store);
    await receipts.write("good", receipt("ok"));
    await receipts.write("bad", receipt("failed", "lease held"));

    const result = await repairRound({
      receipts,
      keep: (_identity, body) => statusOf(body).status !== "failed",
    });

    expect(result.dryRun).toBe(true);
    expect(result.inspected).toBe(2);
    expect(result.dropped).toEqual(["bad"]);
    expect((await receipts.finished()).size).toBe(2);
  });

  it("drops only what the predicate rejects, and the round then redoes exactly those", async () => {
    const store = memoryStore();
    const receipts = receiptsFor(store);
    await receipts.write("good", receipt("ok"));
    await receipts.write("lease", receipt("failed", "already in progress"));
    await receipts.write("bad-data", receipt("failed", "row dated after the filing date"));

    // Only the repairable cause. Re-running the others reproduces the same answer and spends
    // money doing it, which is why the predicate is narrower than "any failure".
    const result = await repairRound({
      receipts,
      dryRun: false,
      keep: (_identity, body) => {
        const { status, reason } = statusOf(body);
        return status !== "failed" || !reason.includes("already in progress");
      },
    });

    expect(result.dropped).toEqual(["lease"]);
    expect([...(await receipts.finished())].sort()).toEqual(["bad-data", "good"]);

    const redone: string[] = [];
    await runRound({
      shard: { index: 0, count: 1 },
      receipts,
      list: async () => [{ id: "good" }, { id: "lease" }, { id: "bad-data" }],
      identityOf: (item) => item.id,
      process: async (batch) => {
        redone.push(...batch.map((item) => item.id));
        return batch.map((item) => ({ identity: item.id, body: receipt("ok") }));
      },
      batchSize: 10,
    });

    expect(redone).toEqual(["lease"]);
  });
});
