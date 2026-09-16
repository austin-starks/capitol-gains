# @austin-starks/backfill-core

Resumable, sharded backfills for work that is expensive, rate-limited and long-running.

Built while extracting ~9,800 congressional trading disclosures through OCR and language
models, where a dropped machine cost real money and a silent pipeline cost an afternoon.
Every piece here exists because its absence broke something.

```bash
npm install @austin-starks/backfill-core
```

## Ports, not vendors

Nothing in this package names a vendor in a type. A backfill runs against five interfaces:

| Port | What it is |
|---|---|
| `DataStore` | content-addressed blob storage |
| `LanguageModel` | one method: `complete(request)` |
| `OcrEngine` | `read(pageImage, label)` |
| `TableWriter` | columnar output |
| `Clock` | injectable time, so leases are testable |

The S3 adapter covers AWS, Tigris, Cloudflare R2, Backblaze B2 and MinIO — they differ by
`endpoint`, not by type. Credentials come from the AWS SDK's standard chain, so this package
never reads `process.env` and never holds a secret.

```ts
import { S3DataStore } from "@austin-starks/backfill-core";

const store = new S3DataStore({ bucket: "my-bucket" });                    // AWS
const tigris = new S3DataStore({ bucket: "my-bucket",
  endpoint: "https://fly.storage.tigris.dev" });                           // same class
```

## Sharding assigns by identity, never position

```ts
import { parseShard, shardOwns } from "@austin-starks/backfill-core";

const shard = parseShard(process.argv[2]!);   // "3/16"
const mine = items.filter((item) => shardOwns(shard, item.id));
```

A restarted machine re-lists its input, often in a different order. If assignment moved with
position, the restart would process a different slice — doing some work twice and never
doing the rest. A stable hash of identity makes the slice the same every time.

## Receipts make a round resumable, and re-shardable

```ts
import { createReceiptStore, pendingForShard } from "@austin-starks/backfill-core";

const receipts = createReceiptStore({ store, root: "receipts", roundId: "backfill-2026-09-16" });
const finished = await receipts.finished();
const todo = pendingForShard(items, (item) => item.id, shard, finished);

for (const item of todo) {
  await receipts.write(item.id, await process(item));
}
```

One object per finished item, keyed by the item's identity and **not** its shard. Two
consequences that matter more than they look:

- A killed machine costs only its in-flight work. Restart it and it resumes.
- **The shard count can change between runs.** Sixteen machines can become thirty-two and
  only the unfinished work is redivided — nothing finished is redone.

Receipts are also the only honest progress signal. A pipeline that batches is silent between
flushes, so count receipts in the store; logs roll over and lie by omission.

## The single-flight lease, and the trap inside it

```ts
import { createSingleFlight } from "@austin-starks/backfill-core";

const single = createSingleFlight(backend);
const claim = await single.claim(pageKey);
if (claim.kind === "OWNER") {
  await single.markAttempted(pageKey, claim.leaseId);   // fence retries before paying
  await callTheExpensiveProvider();
}
```

The lease collapses concurrent misses so N machines pay once for the same expensive result.
The happy path is easy. What matters is the owner dying.

A claim is fenced the moment its paid call is dispatched, because from then on the outcome is
unknown and a blind retry may pay twice. **Fencing forever is the trap.** A successful call
writes its result and leaves the in-flight state, so a claim still in flight, with an attempt
recorded and a lease long expired, belongs to a process that is never coming back. Refusing to
reclaim it poisons that key permanently and every later reader fails.

Measured on a production backfill, 2026-09-16: **613 of 703 failed items failed exactly this
way**, each one re-failing on every repair run, because a single shared page had been fenced by
a machine that had already exited. Paying twice for one page costs a fraction of a cent. Never
reading it again costs every item that contains it.

So an attempt is reclaimable — but only well past its lease (`DEFAULT_ABANDONED_AFTER_MS`,
30 minutes against a 6 minute lease). Long enough that a live call is never stolen, short
enough that a round can repair itself. The takeover clears the attempt marker, so the
reclaimer's own failure does not re-fence the key.

## Batch size is an observability knob

Batching is usually a cost decision — packing ten items into one model request is ten times
cheaper than one each. Keep it. But an oversized batch writes nothing until all of it
finishes: at 250 items per pass a backfill produced no output for over an hour, and a single
bad item blocked the other 249. At 25 the cost model is identical and progress is visible
within minutes. Tune the size; leave the batching alone.

## License

MIT
