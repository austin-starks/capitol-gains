# @austin-starks/disclosure-lake

Published-table integrity checks for the congressional trading disclosure
lake. Pure functions over filing, trade, and event rows — no S3, no Mongo,
no environment — so every check tests with hand-built rows.

## What it checks

- **index_completeness**: every House Clerk / Senate eFD index identity has a published filing row.
- **publication_parity**: a round's receipts equal the published filing rows (catches a half-finished reduce).
- **orphan_trades / orphan_event_sources / invalid_contributor_row_ids**: every pointer resolves.
- **dated_after_filing / date_out_of_range / invalid_amount_range / duplicate_trade_key / resolved_without_ticker**: impossible field values.
- **extraction_health**: failed share per filing year, and regressions since the last pass.
- **freshness / manifest_health**: newest filing date against today; manifests present and never the frozen `{year}-all.parquet` fallback.

## Use

```ts
import { auditPoliticalIntegrity } from "@austin-starks/disclosure-lake";

const report = auditPoliticalIntegrity({ now: new Date(), filings, trades, events });
if (!report.passed) throw new Error(integrityHeadline(report));
```

Row types are structural minimums (`LakeFiling`, `LakeTrade`, `LakeTradeEvent`);
any richer row shape (e.g. a Parquet-mapped table row) is assignable as long as
it carries the checked fields.
