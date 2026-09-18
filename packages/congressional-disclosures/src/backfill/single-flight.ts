import type { Clock } from "./ports";
import { systemClock } from "./ports";

/**
 * A cross-process lease that collapses concurrent misses on the same paid work, so N
 * machines that all need one expensive result pay for it once.
 *
 * The hard part is not the happy path, it is what happens when the owner dies. A claim is
 * fenced once its paid attempt is dispatched, because at that moment the outcome is unknown
 * and a blind retry may pay twice. Fencing forever is the trap: a successful attempt writes
 * its result and leaves the in-flight state, so a claim still in flight with an attempt
 * recorded and a lease long expired belongs to a process that is never coming back. Refusing
 * to reclaim it poisons that key permanently, and every later reader fails.
 *
 * Measured on a production backfill, 2026-09-16: 613 of 703 failed items failed this way,
 * each re-failing on every repair run, because one shared page was fenced by a machine that
 * had already exited. Paying twice for one page cost $0.004; never reading it again cost
 * every item that contained it.
 *
 * So an attempt is reclaimable, but only `abandonedAfterMs` past its lease — long enough
 * that a live call cannot still be running, short enough that a round can repair itself.
 */
export interface LeaseRecord {
  key: string;
  leaseId: string;
  expiresAt: Date;
  attemptedAt?: Date;
}

export interface LeaseBackend {
  /** Create the claim, or return null when one already exists. */
  insert(record: LeaseRecord): Promise<boolean>;
  read(key: string): Promise<LeaseRecord | null>;
  /** Replace an expired claim, clearing any attempt marker. Compare-and-set on `key`. */
  takeover(key: string, previous: LeaseRecord, next: LeaseRecord): Promise<boolean>;
  /** Fence retries before the first paid call. */
  markAttempted(key: string, leaseId: string, at: Date): Promise<boolean>;
  release(key: string, leaseId: string): Promise<boolean>;
}

export type Claim =
  | { kind: "OWNER"; leaseId: string }
  | { kind: "HELD" };

export interface SingleFlightOptions {
  leaseMs?: number;
  /** How far past its lease an unfinished paid attempt is treated as abandoned. */
  abandonedAfterMs?: number;
  clock?: Clock;
  newLeaseId?: () => string;
}

export const DEFAULT_LEASE_MS = 6 * 60 * 1000;

/**
 * Long enough that a call which could still be running is never stolen, short enough that a
 * repair run does not inherit a dead machine's fence. Keep it well above the provider timeout.
 */
export const DEFAULT_ABANDONED_AFTER_MS = 30 * 60 * 1000;

export function createSingleFlight(backend: LeaseBackend, options: SingleFlightOptions = {}) {
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const abandonedAfterMs = options.abandonedAfterMs ?? DEFAULT_ABANDONED_AFTER_MS;
  const clock = options.clock ?? systemClock;
  const newLeaseId = options.newLeaseId ?? (() => globalThis.crypto.randomUUID());

  return {
    async claim(key: string): Promise<Claim> {
      const now = clock.now();
      const leaseId = newLeaseId();
      const expiresAt = new Date(now.getTime() + leaseMs);

      if (await backend.insert({ key, leaseId, expiresAt })) {
        return { kind: "OWNER", leaseId };
      }

      const existing = await backend.read(key);
      if (!existing || existing.expiresAt > now) return { kind: "HELD" };

      const attempted = existing.attemptedAt;
      const reclaimable =
        attempted === undefined || now.getTime() - attempted.getTime() >= abandonedAfterMs;
      if (!reclaimable) return { kind: "HELD" };

      // Clearing the attempt marker matters: without it the reclaimer's own failure would
      // re-fence the key for another full window.
      const took = await backend.takeover(key, existing, { key, leaseId, expiresAt });
      return took ? { kind: "OWNER", leaseId } : { kind: "HELD" };
    },

    markAttempted(key: string, leaseId: string): Promise<boolean> {
      return backend.markAttempted(key, leaseId, clock.now());
    },

    release(key: string, leaseId: string): Promise<boolean> {
      return backend.release(key, leaseId);
    },
  };
}
