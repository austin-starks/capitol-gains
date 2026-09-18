import type { ReceiptStore } from "./receipts";
import { pendingForShard } from "./receipts";
import type { Shard } from "./shard";

/**
 * A round: repeated passes over one shard's slice until nothing is left.
 *
 * Passes exist because batching is a cost decision. Packing many items into one provider
 * request is far cheaper than one request each, so the batch stays — but an oversized batch
 * writes nothing until all of it finishes. At 250 items per pass a production backfill
 * produced no output for over an hour and one bad item blocked the other 249; at 25 the cost
 * was identical and progress appeared within minutes. `batchSize` is the observability knob.
 */
export interface PassSummary {
  pass: number;
  processed: number;
  deferred: number;
  failures: string[];
}

export interface RoundSummary {
  passes: PassSummary[];
  complete: boolean;
}

export interface RunRoundConfig<T> {
  shard: Shard;
  receipts: ReceiptStore;
  /** Everything the round could do, re-listed each pass so new work is picked up. */
  list(): Promise<readonly T[]>;
  identityOf(item: T): string;
  /** Process one batch. Return a receipt body per item that finished. */
  process(batch: readonly T[]): Promise<Array<{ identity: string; body: Buffer }>>;
  batchSize: number;
  maxPasses?: number;
  onPass?(summary: PassSummary): void;
}

export const DEFAULT_MAX_PASSES = 100;

export async function runRound<T>(config: RunRoundConfig<T>): Promise<RoundSummary> {
  const maxPasses = config.maxPasses ?? DEFAULT_MAX_PASSES;
  const passes: PassSummary[] = [];

  for (let pass = 1; pass <= maxPasses; pass += 1) {
    // Re-read the finished set every pass. Another machine may have finished work in this
    // shard's slice — after a re-shard, that is the normal case, not an anomaly.
    const [items, finished] = await Promise.all([config.list(), config.receipts.finished()]);
    const pending = pendingForShard(items, config.identityOf, config.shard, finished);
    if (pending.length === 0) {
      return { passes, complete: true };
    }

    const batch = pending.slice(0, config.batchSize);
    const failures: string[] = [];
    let processed = 0;

    try {
      const results = await config.process(batch);
      for (const result of results) {
        await config.receipts.write(result.identity, result.body);
        processed += 1;
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }

    const summary: PassSummary = {
      pass,
      processed,
      deferred: pending.length - processed,
      failures,
    };
    passes.push(summary);
    config.onPass?.(summary);

    // A pass that finishes nothing will not finish anything next time either: the input is
    // unchanged and so is the failure. Stopping beats burning the remaining passes.
    if (processed === 0) {
      return { passes, complete: false };
    }
  }

  return { passes, complete: false };
}
