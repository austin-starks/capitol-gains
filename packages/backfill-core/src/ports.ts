/**
 * The ports a backfill runs against. Every one is an interface, so the pipeline
 * never names a vendor: S3, Tigris, R2 and MinIO are the same `DataStore` with a
 * different endpoint, and a Postgres or filesystem implementation is equally valid.
 *
 * Each port is deliberately the *narrowest* surface the pipeline uses rather than a
 * mirror of some client's API. The model port has one method because the extraction
 * path only ever needed one.
 */

/** An object in a `DataStore`, as a listing reports it. */
export interface StoredObject {
  key: string;
  size: number;
  lastModified?: Date;
}

export interface PutOptions {
  contentType?: string;
  cacheControl?: string;
}

/**
 * Content-addressed blob storage.
 *
 * `putIfAbsent` is what makes a round idempotent: bodies are keyed by their own
 * digest, so a re-run writes the same key and the store reports that it already
 * existed rather than paying to store it twice.
 */
export interface DataStore {
  get(key: string): Promise<Buffer>;
  put(key: string, body: Buffer, options?: PutOptions): Promise<void>;
  /** True when this call created the object, false when an identical one was already there. */
  putIfAbsent(key: string, body: Buffer, options?: PutOptions): Promise<boolean>;
  list(prefix: string, limit?: number): Promise<StoredObject[]>;
  head(key: string): Promise<StoredObject | null>;
  exists(key: string): Promise<boolean>;
}

export interface CompletionRequest {
  model: string;
  /** Free-form provider payload: messages, attachments, response schema. */
  body: Record<string, unknown>;
  /** Replay key. A provider that honours it must not bill a repeat twice. */
  idempotencyKey?: string;
  timeoutMs?: number;
}

export interface CompletionResult {
  /** The provider's verbatim response. */
  payload: Record<string, unknown>;
  /**
   * True when the answer was cut off at the output token limit. A truncated answer is
   * an answer: it must not be retried under the same idempotency key, because a keyed
   * provider replays the stored failure instead of producing a new one.
   */
  truncated: boolean;
  costUsd?: number;
}

/** Any chat or structured-output model. One method, because that is all a read needs. */
export interface LanguageModel {
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

export interface OcrPage {
  /** The engine's verbatim response, kept so later passes can re-read it without paying again. */
  payload: Record<string, unknown>;
  markdown: string;
}

export interface OcrEngine {
  read(page: Buffer, label: string): Promise<OcrPage>;
}

/** Columnar output. Parquet today; a table in any warehouse is the same shape. */
export interface TableWriter {
  write(table: string, partition: string, rows: ReadonlyArray<Record<string, unknown>>): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
