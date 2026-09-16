import * as backfillCore from "../index";
import type { DataStore, StoredObject } from "../ports";

/**
 * Every other suite imports the module it tests by path, so none of them touches `index.ts`.
 * That is how 0.1.0 shipped without `runRound`: the source exported it, the published build
 * predated it, and a green suite said nothing because no test ever crossed the public surface.
 * These tests fail if the entry point stops exposing what the README documents.
 */

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

describe("public entry point", () => {
  it("exports everything a consumer needs to run and repair a round", () => {
    const required = [
      "createReceiptStore",
      "createSingleFlight",
      "parseShard",
      "pendingForShard",
      "progressDelta",
      "readProgress",
      "repairRound",
      "roundPrefix",
      "runRound",
      "shardIndexOf",
      "shardOwns",
      "systemClock",
      "S3DataStore",
    ] as const;
    const missing = required.filter((name) => backfillCore[name] === undefined);
    expect(missing).toEqual([]);
  });

  it("runs and resumes a round through the entry point alone", async () => {
    const receipts = backfillCore.createReceiptStore({
      store: memoryStore(),
      root: "receipts",
      roundId: "entry-1",
    });
    const body = Buffer.from(JSON.stringify({ status: "ok" }));
    const config = (seen: string[]) => ({
      shard: { index: 0, count: 1 },
      receipts,
      list: async () => [{ id: "a" }, { id: "b" }],
      identityOf: (item: { id: string }) => item.id,
      process: async (batch: { id: string }[]) => {
        seen.push(...batch.map((item) => item.id));
        return batch.map((item) => ({ identity: item.id, body }));
      },
      batchSize: 10,
    });

    const first: string[] = [];
    await backfillCore.runRound(config(first));
    expect(first).toEqual(["a", "b"]);

    // The property the whole design rests on: a receipted item is never paid for twice.
    const resumed: string[] = [];
    await backfillCore.runRound(config(resumed));
    expect(resumed).toEqual([]);
  });
});
