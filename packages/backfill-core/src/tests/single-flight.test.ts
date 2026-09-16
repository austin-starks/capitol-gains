import { createSingleFlight, type LeaseBackend, type LeaseRecord } from "../single-flight";

/** An in-memory backend, so the lease's own rules are what is under test. */
function memoryBackend(): LeaseBackend & { rows: Map<string, LeaseRecord> } {
  const rows = new Map<string, LeaseRecord>();
  return {
    rows,
    async insert(record) {
      if (rows.has(record.key)) return false;
      rows.set(record.key, { ...record });
      return true;
    },
    async read(key) {
      const row = rows.get(key);
      return row ? { ...row } : null;
    },
    async takeover(key, previous, next) {
      const row = rows.get(key);
      if (!row || row.leaseId !== previous.leaseId) return false;
      rows.set(key, { ...next });
      return true;
    },
    async markAttempted(key, leaseId, at) {
      const row = rows.get(key);
      if (!row || row.leaseId !== leaseId || row.attemptedAt !== undefined) return false;
      rows.set(key, { ...row, attemptedAt: at });
      return true;
    },
    async release(key, leaseId) {
      const row = rows.get(key);
      if (!row || row.leaseId !== leaseId) return false;
      rows.delete(key);
      return true;
    },
  };
}

describe("single flight", () => {
  const LEASE_MS = 6 * 60 * 1000;
  const ABANDONED_MS = 30 * 60 * 1000;

  function flight(backend: LeaseBackend, at: () => Date) {
    let n = 0;
    return createSingleFlight(backend, {
      leaseMs: LEASE_MS,
      abandonedAfterMs: ABANDONED_MS,
      clock: { now: at },
      newLeaseId: () => `lease-${(n += 1)}`,
    });
  }

  it("gives the work to one caller and holds the rest off", async () => {
    const backend = memoryBackend();
    const now = new Date("2026-09-16T09:00:00Z");
    const single = flight(backend, () => now);

    expect(await single.claim("page-1")).toEqual({ kind: "OWNER", leaseId: "lease-1" });
    expect(await single.claim("page-1")).toEqual({ kind: "HELD" });
  });

  it("never steals a lease that has not expired", async () => {
    const backend = memoryBackend();
    let now = new Date("2026-09-16T09:00:00Z");
    const single = flight(backend, () => now);

    await single.claim("page-1");
    now = new Date(now.getTime() + LEASE_MS - 1000);
    expect(await single.claim("page-1")).toEqual({ kind: "HELD" });
  });

  it("reclaims a lease whose owner died before dispatching a paid call", async () => {
    const backend = memoryBackend();
    let now = new Date("2026-09-16T09:00:00Z");
    const single = flight(backend, () => now);

    await single.claim("page-1");
    now = new Date(now.getTime() + LEASE_MS + 1000);
    expect(await single.claim("page-1")).toMatchObject({ kind: "OWNER" });
  });

  it("holds a dispatched attempt while its outcome could still be unknown", async () => {
    const backend = memoryBackend();
    let now = new Date("2026-09-16T09:00:00Z");
    const single = flight(backend, () => now);

    const claim = await single.claim("page-1");
    if (claim.kind !== "OWNER") throw new Error("expected to own the claim");
    expect(await single.markAttempted("page-1", claim.leaseId)).toBe(true);

    now = new Date(now.getTime() + ABANDONED_MS - 1000);
    expect(await single.claim("page-1")).toEqual({ kind: "HELD" });
  });

  it("reclaims an attempt abandoned long enough that its owner is gone, and clears the fence", async () => {
    const backend = memoryBackend();
    let now = new Date("2026-09-16T09:00:00Z");
    const single = flight(backend, () => now);

    const first = await single.claim("page-1");
    if (first.kind !== "OWNER") throw new Error("expected to own the claim");
    await single.markAttempted("page-1", first.leaseId);

    // Past the window: a successful call would have written its result and left the claim,
    // so this one belongs to a process that is never coming back. Refusing forever would
    // poison the key for every later reader.
    now = new Date(now.getTime() + ABANDONED_MS + 1000);
    const second = await single.claim("page-1");
    if (second.kind !== "OWNER") throw new Error("expected to reclaim the abandoned attempt");

    // The reclaimer starts clean, so its own failure does not re-fence the key.
    expect(backend.rows.get("page-1")?.attemptedAt).toBeUndefined();
    expect(await single.markAttempted("page-1", second.leaseId)).toBe(true);
  });
});
