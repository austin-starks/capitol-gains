import type { ReceiptStore } from "./receipts";
import { shardIndexOf } from "./shard";

/**
 * Progress read from the receipt store, which is the only signal that does not lie.
 *
 * Logs roll over — a chatty machine floods a shared window and evicts the lines that matter.
 * Machine state lies too: a cloud provider will report a host as running long after the
 * process inside it died. Receipts are durable, countable and survive every restart.
 *
 * Rate comes from the delta between two readings, never from object timestamps. Receipts
 * flush in bursts at the end of a batch, so a whole pass can share one modification second:
 * on a live round 389 receipts carried the same timestamp, which made a timestamp-derived
 * rate read 23,340 per minute.
 */
export interface ProgressReading {
  at: Date;
  total: number;
  /** Per shard, when a shard count is given. */
  byShard?: Map<number, number>;
}

export interface ProgressDelta {
  added: number;
  perMinute: number;
  /** Only when an expected total is known. */
  remaining?: number;
  etaMs?: number;
}

export async function readProgress(
  receipts: ReceiptStore,
  options: { shardCount?: number; now?: Date } = {}
): Promise<ProgressReading> {
  const all = await receipts.all();
  const reading: ProgressReading = {
    at: options.now ?? new Date(),
    total: all.length,
  };
  if (options.shardCount === undefined) return reading;

  const byShard = new Map<number, number>();
  for (let index = 0; index < options.shardCount; index += 1) byShard.set(index, 0);
  for (const entry of all) {
    const index = shardIndexOf(entry.identity, options.shardCount);
    byShard.set(index, (byShard.get(index) ?? 0) + 1);
  }
  return { ...reading, byShard };
}

export function progressDelta(
  previous: ProgressReading,
  current: ProgressReading,
  expectedTotal?: number
): ProgressDelta {
  const added = current.total - previous.total;
  const elapsedMs = current.at.getTime() - previous.at.getTime();
  const perMinute = elapsedMs > 0 ? (added / elapsedMs) * 60_000 : 0;
  if (expectedTotal === undefined) return { added, perMinute };

  const remaining = Math.max(expectedTotal - current.total, 0);
  return {
    added,
    perMinute,
    remaining,
    ...(perMinute > 0 ? { etaMs: (remaining / perMinute) * 60_000 } : {}),
  };
}
