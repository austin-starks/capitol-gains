# congressional-disclosures

U.S. congressional trading disclosures, end to end: a resumable sharded
backfill runtime plus integrity checks over the published filing, trade,
and event tables.

Built while extracting ~10,800 House and Senate disclosures through OCR
and language models, where a dropped machine cost real money and a silent
pipeline cost an afternoon. Every piece here exists because its absence
broke something.

```bash
npm install congressional-disclosures
```

## Two modules, one boundary

```ts
import { runRound, repairRound, createSingleFlight } from "congressional-disclosures";
import { auditPoliticalIntegrity } from "congressional-disclosures";
```

- **Backfill runtime** (`src/backfill`): sharded, resumable extraction
  against any storage, model, and OCR backend. Work splits by stable hash
  across machines with no coordinator; per-filing content-addressed
  receipts record ok/failed so later passes skip what's done;
  single-flight leases keep two machines off the same filing and reclaim
  abandoned attempts; repair drops receipts by reason and re-runs only
  those. Nothing here names Congress.
- **Integrity checks** (`src/integrity.ts`): pure functions over published
  filing, trade, and event rows — index completeness, publication parity,
  orphan pointers, impossible values, per-year extraction health,
  freshness, manifest health. No S3, no Mongo; every check tests with
  hand-built rows. Row types are structural minimums, so any richer table
  row carrying the checked fields is assignable.

## Ports, not vendors

A backfill runs against five interfaces — `DataStore`, `LanguageModel`,
`OcrEngine`, `TableWriter`, `Clock` (injectable time, so leases are
testable). The S3 adapter covers AWS, Tigris, Cloudflare R2, Backblaze B2
and MinIO — they differ by `endpoint`, not by type. Credentials come from
the AWS SDK's standard chain, so this package never reads `process.env`
and never holds a secret.
