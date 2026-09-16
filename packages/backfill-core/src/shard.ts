import { createHash } from "crypto";

/** A slice of the work, written "index/count" — `3/16`. */
export interface Shard {
  index: number;
  count: number;
}

export function parseShard(value: string): Shard {
  const match = /^(\d+)\/(\d+)$/.exec(value);
  const index = match ? Number(match[1]) : Number.NaN;
  const count = match ? Number(match[2]) : Number.NaN;
  if (!Number.isInteger(index) || !Number.isInteger(count) || count < 1 || index < 0 || index >= count) {
    throw new Error(`a shard looks like 3/16, with an index below the count; got ${JSON.stringify(value)}`);
  }
  return { index, count };
}

/**
 * Which slice an item belongs to, from a stable hash of its identity.
 *
 * Identity, not position: the assignment must not move when the input is re-listed in a
 * different order, or a restarted machine would process a different slice and the round
 * would both duplicate and miss work.
 */
export function shardIndexOf(identity: string, count: number): number {
  return createHash("sha256").update(identity).digest().readUInt32BE(0) % count;
}

export function shardOwns(shard: Shard, identity: string): boolean {
  return shardIndexOf(identity, shard.count) === shard.index;
}
