import { pendingForShard } from "../receipts";
import { parseShard, shardIndexOf, shardOwns } from "../shard";

describe("shard", () => {
  it("rejects a shard that is not index/count with the index below the count", () => {
    expect(() => parseShard("16/16")).toThrow(/index below the count/);
    expect(() => parseShard("1/0")).toThrow();
    expect(() => parseShard("one/two")).toThrow();
    expect(parseShard("3/16")).toEqual({ index: 3, count: 16 });
  });

  it("assigns every item to exactly one shard", () => {
    const identities = Array.from({ length: 500 }, (_, n) => `house:${n}`);
    const count = 16;
    const owners = identities.map((identity) => shardIndexOf(identity, count));

    expect(owners.every((index) => index >= 0 && index < count)).toBe(true);
    for (const identity of identities) {
      const owning = Array.from({ length: count }, (_, index) => index).filter((index) =>
        shardOwns({ index, count }, identity)
      );
      expect(owning).toHaveLength(1);
    }
  });

  it("depends on identity, not on listing order", () => {
    // A restarted machine re-lists its input, often in a different order. If assignment moved
    // with position, the restart would process a different slice: some work twice, some never.
    expect(shardIndexOf("house:9110123", 16)).toBe(shardIndexOf("house:9110123", 16));
  });

  it("skips what the round already finished, so a restart resumes rather than repeats", () => {
    const items = ["a", "b", "c", "d"].map((id) => ({ id }));
    const shard = { index: 0, count: 1 };

    expect(pendingForShard(items, (item) => item.id, shard, new Set())).toHaveLength(4);
    expect(pendingForShard(items, (item) => item.id, shard, new Set(["a", "c"]))).toEqual([
      { id: "b" },
      { id: "d" },
    ]);
  });

  it("lets the shard count change between runs without redoing finished work", () => {
    // Receipts are keyed by identity, so re-sharding 16 into 32 only redivides what is left.
    const identities = Array.from({ length: 200 }, (_, n) => `house:${n}`);
    const finished = new Set(identities.slice(0, 120));
    const items = identities.map((id) => ({ id }));

    const across32 = Array.from({ length: 32 }, (_, index) =>
      pendingForShard(items, (item) => item.id, { index, count: 32 }, finished)
    ).flat();

    expect(across32).toHaveLength(80);
    expect(new Set(across32.map((item) => item.id)).size).toBe(80);
    expect(across32.some((item) => finished.has(item.id))).toBe(false);
  });
});
