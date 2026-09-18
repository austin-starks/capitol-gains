<div align="center">

# Capitol Gains

**Congressional trading disclosures, extracted at scale.**

Members of the US Congress must file a Periodic Transaction Report within 45 days of a trade.
Those reports are public — and largely unusable: tens of thousands of PDFs, many of them
photographs of paper, spread across two chambers with different formats and no common schema.

Capitol Gains turns them into rows you can query.

[![npm](https://img.shields.io/npm/v/@austin-starks/backfill-core?label=%40austin-starks%2Fbackfill-core)](https://www.npmjs.com/package/@austin-starks/backfill-core)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](./package.json)

![Six scenes: a trade becomes a PDF, a third of them are photographs, OCR repeats one date down 73 rows at high confidence, two reads and a reconcile, an encrypted filing whose crops come back blank, and the rows that come out](./graphic/out/architecture.gif)

<sub>From a filed PDF to a queryable row, each scene showing the failure it has to survive. Source in [`graphic/`](./graphic) — `npm run render` rebuilds it.</sub>

</div>

---

## Two packages, one boundary

| Package | What it knows |
|---|---|
| [`@austin-starks/backfill-core`](./packages/backfill-core) | how to run a resumable, sharded backfill against **any** storage, model and OCR backend. Knows nothing about Congress. |
| [`@austin-starks/disclosure-lake`](./packages/disclosure-lake) | published-table integrity checks over filing, trade, and event rows — pure functions, tested without S3 or Mongo. Knows nothing about S3 or Mongo. |

The split is the point. The framework had to exist for the pipeline to be testable, and it
turned out to be the more reusable half.

## No vendors in the type system

A backfill runs against five interfaces. Swap any one without touching the pipeline:

```
DataStore       get · put · putIfAbsent · list · head · exists
LanguageModel   complete(request)
OcrEngine       read(pageImage, label)
TableWriter     write(table, partition, rows)
Clock           now()
```

`S3DataStore` covers AWS, Tigris, Cloudflare R2, Backblaze B2 and MinIO — they differ by
`endpoint`, not by type. Credentials come from the AWS SDK's standard chain, so **no package
here reads `process.env` and none holds a secret**.

```ts
const aws     = new S3DataStore({ bucket: "disclosures" });
const tigris  = new S3DataStore({ bucket: "disclosures", endpoint: "https://fly.storage.tigris.dev" });
const minio   = new S3DataStore({ bucket: "disclosures", endpoint: "http://localhost:9000" });
```

Want Postgres instead of object storage? Implement `DataStore` and `TableWriter`. The pipeline
cannot tell the difference.

## How a round works

```
        ┌──────────── list every filing the chambers publish ────────────┐
        │                                                               │
   shard 0/16 ─┐                                                        │
   shard 1/16 ─┤  each machine takes the slice whose identity hashes     │
      ...      ├─ to its index, minus whatever already has a receipt ────┤
   shard 15/16 ┘                                                        │
        │                                                               │
        ▼                                                               │
   ┌─────────────────── one pass, batchSize items ──────────────────┐   │
   │  fetch (cache first) → OCR → read → reconcile → receipt        │   │
   └────────────────────────────────────────────────────────────────┘   │
        │                          repeat until nothing is pending ─────┘
        ▼
   reduce: read every receipt of the round, publish each year once
```

Three properties make this survivable:

**Receipts key on identity, not on shard.** One object per finished filing. A machine that dies
costs only its in-flight work, and **the shard count can change between runs** — sixteen
machines become thirty-two and only the unfinished work is redivided.

**Sharding hashes identity, never position.** A restarted machine re-lists its input, often in a
different order. Position-based assignment would make it process a different slice: some work
twice, the rest never.

**Progress is read from the store.** Not from logs, which roll over, and not from machine state,
which lies — a cloud provider will report a host as running long after the process inside it
died.

## Reading a filing that is a photograph

Roughly a third of House PTRs are scans, and OCR on a dense table of near-identical dates is
not merely noisy — it is *confidently* wrong. A generative OCR engine will read one date and
repeat it down a column of seventy-three rows at 0.92–0.999 word confidence, and every
page-level sanity check passes, because the page does keep its letters and its dated lines.

So no value is taken from the OCR text alone:

```
   Read A ──── the OCR text, alone ─────────┐
                                            ├──▶ agree?  ──▶ accept
   Read B ──── the filed page images ───────┘      │
                                                   └─ disagree ─▶ Read C:
                                                      both reads, plus the
                                                      document itself, plus
                                                      row-level crops of the
                                                      cells in dispute
```

The reconciling read decides from the page, not from either summary. Measured on a filing whose
OCR gave `04/21/21` for all 73 rows: the published dates came back spread across `04/01`–`04/22`
exactly as printed.

**Those crops need a decrypted PDF.** Every electronic House PTR sampled is RC4-encrypted, and
`pdf-lib` copies pages out of an encrypted document as blank pages without raising anything — so
a crop, a split or a merge silently produces an empty page, and the model correctly reports no
rows. Decrypt with PDFium first, then copy. It is the single most expensive thing to learn late
in this pipeline.

## The lease, and the trap inside it

When N machines miss cache on the same expensive page, a single-flight lease makes one of them
pay and the rest reuse the result. The happy path is easy. What matters is the owner dying.

A claim is fenced the moment its paid call is dispatched — from then on the outcome is unknown
and a blind retry may pay twice. **Fencing forever is the trap.** A successful call writes its
result and leaves the in-flight state, so a claim still in flight, with an attempt recorded and
a lease long expired, belongs to a process that is never coming back. Refuse to reclaim it and
that key is poisoned permanently: every later reader fails.

> Measured 2026-09-16: **613 of 703 failed filings** failed exactly this way, each one
> re-failing on every repair run, because one shared page had been fenced by a machine that had
> already exited. Paying twice for one page costs $0.004. Never reading it again costs every
> filing that contains it.

`backfill-core` reclaims an abandoned attempt 30 minutes past its lease — long enough that a
live call is never stolen, short enough that a round repairs itself.

## Install

```bash
npm install @austin-starks/backfill-core
```

## Repository layout

```
packages/backfill-core/     the framework: ports, sharding, receipts, lease, rounds, progress
packages/disclosure-lake/   the pipeline: House index, Senate EFD, PTR extraction
graphic/                    Remotion source for the architecture animation
```

## Development

```bash
npm install
npm run build        # every workspace
npm test             # every workspace
npm run typecheck
```

Strict TypeScript everywhere: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.

## The data

The extracted disclosures are published as a dataset rather than committed here. Filings are
public records from the [House Clerk](https://disclosures-clerk.house.gov/) and the
[Senate EFD](https://efdsearch.senate.gov/); this project only reads and structures them.

## License

MIT
