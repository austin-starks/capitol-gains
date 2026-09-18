import type { DataStore } from "./ports";
import { shardOwns, type Shard } from "./shard";

/**
 * A round's receipts: one object per finished item, keyed by the item's identity.
 *
 * This is what makes a backfill resumable and safely parallel. A machine restarted on the
 * same round skips anything that already has a receipt, so a killed machine costs only its
 * in-flight work. Because the key is the item's identity and never its shard, the shard
 * count can change between runs — 16 machines can become 32 without reprocessing what the
 * first 16 finished.
 *
 * Receipts are also the only trustworthy progress signal. A pipeline that batches its work
 * is silent between flushes, so counting receipts in the store beats reading logs, which
 * roll over and lie by omission.
 */
export interface ReceiptStore {
  /** Identities already finished in this round. */
  finished(): Promise<Set<string>>;
  write(identity: string, body: Buffer): Promise<void>;
  read(identity: string): Promise<Buffer>;
  /** Every receipt of the round, for the stage that publishes them. */
  all(): Promise<Array<{ identity: string; key: string }>>;
  /**
   * Forget an item, so the round does it again.
   *
   * This is the whole of repair. A receipt is what makes the round skip an item, so a receipt
   * recording a *failure* is indistinguishable from one recording success as far as the next
   * pass is concerned — it will skip both. Re-running a pipeline without dropping the receipt
   * does nothing at all, which is a genuinely confusing way to waste a machine.
   */
  drop(identity: string): Promise<void>;
}

const ROUND_ID = /^[A-Za-z0-9._-]{1,64}$/;

export function roundPrefix(root: string, roundId: string): string {
  if (!ROUND_ID.test(roundId)) {
    throw new Error(`a round id is 1 to 64 letters, digits, dots, dashes or underscores; got ${JSON.stringify(roundId)}`);
  }
  return `${root.replace(/\/+$/, "")}/${roundId}/`;
}

export function createReceiptStore(config: {
  store: DataStore;
  root: string;
  roundId: string;
}): ReceiptStore {
  const prefix = roundPrefix(config.root, config.roundId);
  const keyFor = (identity: string): string => `${prefix}${encodeURIComponent(identity)}.json`;
  const identityFrom = (key: string): string | null => {
    if (!key.startsWith(prefix) || !key.endsWith(".json")) return null;
    const encoded = key.slice(prefix.length, -".json".length);
    return encoded.includes("/") ? null : decodeURIComponent(encoded);
  };

  return {
    async finished() {
      const objects = await config.store.list(prefix);
      const identities = new Set<string>();
      for (const object of objects) {
        const identity = identityFrom(object.key);
        if (identity !== null) identities.add(identity);
      }
      return identities;
    },
    async write(identity, body) {
      await config.store.put(keyFor(identity), body, {
        contentType: "application/json",
        cacheControl: "private, no-cache",
      });
    },
    read(identity) {
      return config.store.get(keyFor(identity));
    },
    async all() {
      const objects = await config.store.list(prefix);
      return objects.flatMap((object) => {
        const identity = identityFrom(object.key);
        return identity === null ? [] : [{ identity, key: object.key }];
      });
    },
    async drop(identity) {
      await config.store.delete(keyFor(identity));
    },
  };
}

/**
 * Drop the receipts of every item a predicate rejects, so the next run redoes exactly those.
 *
 * Pass `dryRun` first. Repair deletes durable state, and "which items are broken" is a claim
 * worth reading before acting on: on a production round the obvious guess — that the failures
 * were all one cause — was wrong, and 87% of them shared a cause nobody had suspected.
 */
export async function repairRound(config: {
  receipts: ReceiptStore;
  /** True to keep the receipt, false to drop it and redo the item. */
  keep(identity: string, body: Buffer): Promise<boolean> | boolean;
  dryRun?: boolean;
  concurrency?: number;
}): Promise<{ inspected: number; dropped: string[]; dryRun: boolean }> {
  const dryRun = config.dryRun ?? true;
  const all = await config.receipts.all();
  const dropped: string[] = [];

  for (const entry of all) {
    const body = await config.receipts.read(entry.identity);
    if (await config.keep(entry.identity, body)) continue;
    dropped.push(entry.identity);
    if (!dryRun) await config.receipts.drop(entry.identity);
  }

  return { inspected: all.length, dropped, dryRun };
}

/** The items this shard still has to do: its slice, minus what the round already finished. */
export function pendingForShard<T>(
  items: readonly T[],
  identityOf: (item: T) => string,
  shard: Shard,
  finished: ReadonlySet<string>
): T[] {
  return items.filter((item) => {
    const identity = identityOf(item);
    return shardOwns(shard, identity) && !finished.has(identity);
  });
}
