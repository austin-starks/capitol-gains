import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";

import type { DataStore, PutOptions, StoredObject } from "../ports";

/**
 * A `DataStore` on any S3-compatible service.
 *
 * There is no vendor in this file's types. AWS S3, Tigris, Cloudflare R2, Backblaze B2 and
 * MinIO differ only by `endpoint` and `region`, and credentials come from the AWS SDK's
 * standard chain — environment, shared config, SSO, instance role — so nothing here reads
 * `process.env` or holds a secret.
 *
 * ```ts
 * // AWS
 * new S3DataStore({ bucket: "my-bucket" });
 * // Tigris, R2, MinIO: same class, different endpoint
 * new S3DataStore({ bucket: "my-bucket", endpoint: "https://fly.storage.tigris.dev" });
 * ```
 */
export interface S3DataStoreConfig {
  bucket: string;
  /** Omit for AWS. Any S3-compatible service sets its own endpoint here. */
  endpoint?: string;
  region?: string;
  /** Prefixed to every key, so one bucket can hold several independent datasets. */
  keyPrefix?: string;
  /** Escape hatch for anything the SDK supports and this config does not name. */
  clientConfig?: S3ClientConfig;
}

const MAX_KEYS_PER_PAGE = 1000;

export class S3DataStore implements DataStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly keyPrefix: string;

  constructor(config: S3DataStoreConfig) {
    this.bucket = config.bucket;
    this.keyPrefix = config.keyPrefix ? `${config.keyPrefix.replace(/\/+$/, "")}/` : "";
    this.client = new S3Client({
      ...(config.region ? { region: config.region } : { region: "auto" }),
      ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: false } : {}),
      ...config.clientConfig,
    });
  }

  private resolve(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: this.resolve(key) })
    );
    if (!response.Body) throw new Error(`empty body for ${key}`);
    return Buffer.from(await response.Body.transformToByteArray());
  }

  async put(key: string, body: Buffer, options: PutOptions = {}): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.resolve(key),
        Body: body,
        ...(options.contentType ? { ContentType: options.contentType } : {}),
        ...(options.cacheControl ? { CacheControl: options.cacheControl } : {}),
      })
    );
  }

  /**
   * `If-None-Match: *` makes the write conditional on the key being absent, so two machines
   * racing on the same content-addressed key cannot both pay to store it. A service without
   * conditional writes falls back to a head-then-put, which is racy but never wrong for
   * content-addressed bodies: both writers would be storing identical bytes.
   */
  async putIfAbsent(key: string, body: Buffer, options: PutOptions = {}): Promise<boolean> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: this.resolve(key),
          Body: body,
          IfNoneMatch: "*",
          ...(options.contentType ? { ContentType: options.contentType } : {}),
          ...(options.cacheControl ? { CacheControl: options.cacheControl } : {}),
        })
      );
      return true;
    } catch (error) {
      if (isPreconditionFailed(error)) return false;
      if (!isUnsupportedConditional(error)) throw error;
      if (await this.exists(key)) return false;
      await this.put(key, body, options);
      return true;
    }
  }

  async list(prefix: string, limit?: number): Promise<StoredObject[]> {
    const objects: StoredObject[] = [];
    let continuationToken: string | undefined;
    const resolved = this.resolve(prefix);
    do {
      const remaining = limit === undefined ? MAX_KEYS_PER_PAGE : limit - objects.length;
      if (remaining <= 0) break;
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: resolved,
          MaxKeys: Math.min(remaining, MAX_KEYS_PER_PAGE),
          ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
        })
      );
      for (const item of response.Contents ?? []) {
        if (!item.Key) continue;
        objects.push({
          key: item.Key.slice(this.keyPrefix.length),
          size: item.Size ?? 0,
          ...(item.LastModified ? { lastModified: item.LastModified } : {}),
        });
      }
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);
    return objects;
  }

  async head(key: string): Promise<StoredObject | null> {
    try {
      const response = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.resolve(key) })
      );
      return {
        key,
        size: response.ContentLength ?? 0,
        ...(response.LastModified ? { lastModified: response.LastModified } : {}),
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.head(key)) !== null;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: this.resolve(key) })
    );
  }
}

function statusOf(error: unknown): number | undefined {
  return (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
}

function isNotFound(error: unknown): boolean {
  return statusOf(error) === 404 || (error as { name?: string })?.name === "NotFound";
}

function isPreconditionFailed(error: unknown): boolean {
  return statusOf(error) === 412 || (error as { name?: string })?.name === "PreconditionFailed";
}

function isUnsupportedConditional(error: unknown): boolean {
  return statusOf(error) === 400 || statusOf(error) === 501;
}
