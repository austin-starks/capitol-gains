import {
  auditPoliticalIntegrity,
  duplicateTradeKeys,
  extractionHealthRegressions,
  failedShareByFilingYear,
  freshnessLagDays,
  integrityHeadline,
  invalidAmountRanges,
  invalidContributorRowIds,
  missingIndexedFilings,
  orphanEventSources,
  orphanTrades,
  parsePreviousPoliticalIntegrity,
  publicationParityGaps,
  resolvedWithoutTicker,
  shouldSendIntegrityRecovery,
  tradesDatedAfterFiling,
  tradesOutsideDateRange,
  unhealthyManifestYears,
} from "./integrity";
import type { LakeFiling, LakeTrade, LakeTradeEvent } from "./integrity";

const NOW = new Date("2026-09-16T23:30:00.000Z");

function filing(docId: string, overrides: Partial<LakeFiling> = {}): LakeFiling {
  return {
    chamber: "house",
    docId,
    filingDate: "2026-09-14",
    extractionStatus: "ok",
    ...overrides,
  };
}

function trade(docId: string, rowIndex: number, overrides: Partial<LakeTrade> = {}): LakeTrade {
  return {
    chamber: "house",
    docId,
    rowIndex,
    filingDate: "2026-09-14",
    transactionDate: "2026-09-01",
    notificationDate: "2026-09-01",
    amountLow: 1001,
    amountHigh: 15000,
    resolutionStatus: "printed",
    resolvedTicker: null,
    ...overrides,
  };
}

function event(sourceDocId: string, overrides: Partial<LakeTradeEvent> = {}): LakeTradeEvent {
  return {
    eventId: `house:${sourceDocId}:0`,
    chamber: "house",
    sourceDocId,
    contributorRowIds: JSON.stringify([`${sourceDocId}:0`]),
    ...overrides,
  };
}

const HEALTHY = {
  now: NOW,
  filings: [filing("20000001")],
  trades: [trade("20000001", 0)],
  events: [event("20000001")],
  indexed: [{ chamber: "house" as const, docId: "20000001" }],
  shardKeys: { political_filings: { 2026: ["political_filings/2026/run.parquet"] } },
};

describe("lake integrity", () => {
  it("index completeness names the silent House absences measured in production", () => {
    expect(
      missingIndexedFilings(
        [
          { chamber: "house", docId: "20150001" },
          { chamber: "house", docId: "20150002" },
          { chamber: "house", docId: "20260001" },
        ],
        [filing("20260001")]
      )
    ).toEqual(["house:20150001", "house:20150002"]);
  });

  it("publication parity flags a half-finished reduce", () => {
    expect(
      publicationParityGaps(
        [
          { chamber: "house", docId: "1" },
          { chamber: "house", docId: "2" },
        ],
        [filing("1")]
      )
    ).toEqual({
      missingFromFilings: ["house:2"],
      missingFromReceipts: [],
    });
  });

  it("orphan trades reject a row whose filing failed extraction", () => {
    expect(
      orphanTrades(
        [trade("20013832", 0)],
        [filing("20013832", { extractionStatus: "failed" })]
      )
    ).toEqual(["house:20013832#0"]);
  });

  it("orphan event sources reject a sourceDocId that is not an ok filing", () => {
    expect(orphanEventSources([event("missing")], [filing("20000001")])).toEqual([
      "house:missing:0 source=house:missing",
    ]);
  });

  it("invalid contributorRowIds reject a pointer that is not docId:rowIndex or has no trade", () => {
    expect(
      invalidContributorRowIds(
        [
          event("20000001", { contributorRowIds: "not-json" }),
          event("20000001", { eventId: "house:20000001:1", contributorRowIds: '["20000001:9"]' }),
        ],
        [trade("20000001", 0)]
      )
    ).toEqual(["house:20000001:0: not JSON", "house:20000001:1: missing trade 20000001:9"]);
  });

  it("dated after filing catches a transaction printed after its filing date", () => {
    expect(
      tradesDatedAfterFiling([
        trade("20013832", 0, { filingDate: "2020-01-02", transactionDate: "2020-12-24" }),
        trade("20013832", 1, { filingDate: "2020-01-02", transactionDate: "2019-12-20" }),
      ])
    ).toEqual(["20013832#0 2020-12-24 > 2020-01-02"]);
  });

  it("date out of range catches an impossible year like 2119", () => {
    expect(
      tradesOutsideDateRange([trade("20000001", 0, { transactionDate: "2119-01-01" })], NOW)
    ).toEqual(["20000001#0 transactionDate=2119-01-01"]);
  });

  it("invalid amount ranges catch a reversed or negative bound", () => {
    expect(
      invalidAmountRanges([
        trade("20000001", 0, { amountLow: 15000, amountHigh: 1001 }),
        trade("20000001", 1, { amountLow: -5, amountHigh: 1000 }),
      ])
    ).toEqual(["20000001#0 15000..1001", "20000001#1 -5..1000"]);
  });

  it("duplicate trade keys catch a repeated (docId, rowIndex)", () => {
    expect(duplicateTradeKeys([trade("20000001", 0), trade("20000001", 0)])).toEqual(["house:20000001:0 x2"]);
  });

  it("resolved without ticker catches resolutionStatus=resolved with a null ticker", () => {
    expect(
      resolvedWithoutTicker([trade("20000001", 0, { resolutionStatus: "resolved", resolvedTicker: null })])
    ).toEqual(["20000001#0"]);
  });

  it("extraction health reports a year that regressed and does not invent a first-pass threshold", () => {
    const current = failedShareByFilingYear([
      filing("ok", { filingDate: "2025-01-01" }),
      filing("bad", { filingDate: "2025-01-02", extractionStatus: "failed" }),
    ]);
    expect(current[2025] ?? Number.NaN).toBeCloseTo(0.5);
    expect(extractionHealthRegressions(current, undefined)).toEqual([]);
    expect(extractionHealthRegressions(current, { 2025: 0.1 })).toEqual(["2025: 50.00% failed, was 10.00%"]);
    expect(extractionHealthRegressions(current, { 2025: 0.5 })).toEqual([]);
  });

  it("freshness alerts at four days behind today", () => {
    expect(freshnessLagDays([filing("20000001", { filingDate: "2026-09-12" })], NOW)).toBe(4);
    expect(freshnessLagDays([filing("20000001", { filingDate: "2026-09-14" })], NOW)).toBe(2);
  });

  it("manifest health rejects the frozen {year}-all.parquet fallback", () => {
    expect(
      unhealthyManifestYears({
        political_filings: {
          2024: ["political_filings/2024-all.parquet"],
          2025: ["political_filings/2025/run.parquet"],
          2026: [],
        },
      })
    ).toEqual(["political_filings/2024: reads political_filings/2024-all.parquet", "political_filings/2026: no shard keys"]);
  });

  it("auditPoliticalIntegrity passes a healthy lake and fails production defects together", () => {
    expect(auditPoliticalIntegrity(HEALTHY).passed).toBe(true);
    const report = auditPoliticalIntegrity({
      ...HEALTHY,
      filings: [filing("20013832", { filingDate: "2020-01-02" })],
      trades: [
        trade("20013832", 0, { filingDate: "2020-01-02", transactionDate: "2020-12-24" }),
        trade("ghost", 0),
      ],
      events: [event("ghost")],
      indexed: [
        { chamber: "house", docId: "20013832" },
        { chamber: "house", docId: "20150001" },
      ],
      receipts: [{ chamber: "house", docId: "20013832" }],
    });
    expect(report.passed).toBe(false);
    expect(report.findings.map((item) => item.check)).toEqual(
      expect.arrayContaining(["index_completeness", "dated_after_filing", "orphan_trades"])
    );
    expect(integrityHeadline(report)).toMatch(/integrity check\(s\) failed/);
  });

  it("parses the previous pass summary and only recovers after a failing pass goes green", () => {
    expect(parsePreviousPoliticalIntegrity(null)).toEqual({ failed: false, failedShareByYear: {} });
    expect(
      parsePreviousPoliticalIntegrity(
        JSON.stringify({ integrity: { passed: false, failedShareByYear: { 2025: 0.2 } } })
      )
    ).toEqual({ failed: true, failedShareByYear: { 2025: 0.2 } });
    const passed = auditPoliticalIntegrity(HEALTHY);
    expect(shouldSendIntegrityRecovery(true, passed)).toBe(true);
    expect(shouldSendIntegrityRecovery(false, passed)).toBe(false);
    expect(shouldSendIntegrityRecovery(true, auditPoliticalIntegrity({ ...HEALTHY, indexed: [{ chamber: "house", docId: "missing" }] }))).toBe(
      false
    );
  });
});
