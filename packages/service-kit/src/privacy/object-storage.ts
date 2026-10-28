import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { z } from 'zod';
import { ConfigError } from '../config/config';

/**
 * Private object storage for exports (users LLD §3). S3 with SSE-KMS in AWS; a local directory in
 * development and tests, with download links signed by this service.
 */
export interface ObjectStorage {
  put(key: string, body: Uint8Array | string, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** Removes every object whose key starts with `prefix` (which must end with "/"). */
  deletePrefix(prefix: string): Promise<number>;
  /** A link anyone holding it can use to download `key` until it expires. */
  presignGet(
    key: string,
    options: { expiresInSeconds: number; filename: string },
  ): Promise<{ url: string; expiresAt: Date }>;
}

export const objectStorageEnvSchema = z.object({
  OBJECT_STORAGE: z.enum(['local', 's3']).default('local'),
  /** Local backend: where objects are kept. Shared by every service on one machine. */
  OBJECT_STORAGE_DIR: z.string().min(1).default('.data/object-store'),
  /** Local backend: the route that serves signed downloads (profile-service, through the gateway). */
  OBJECT_STORAGE_PUBLIC_URL: z.url().default('http://localhost:8080/v1/me/export-files'),
  S3_BUCKET: z.string().min(3).optional(),
  /** KMS key for SSE-KMS; the bucket default key is used when unset. */
  S3_KMS_KEY_ID: z.string().min(1).optional(),
  AWS_REGION: z.string().min(1).default('ap-south-1'),
});
export type ObjectStorageConfig = z.infer<typeof objectStorageEnvSchema>;

function assertPrefix(prefix: string): void {
  // A bare or unterminated prefix could match far more than one user's or one export's objects.
  if (!prefix.endsWith('/') || prefix.split('/').filter(Boolean).length < 2) {
    throw new Error(`Refusing to delete prefix "${prefix}"`);
  }
}

function assertKey(key: string): void {
  if (!key || key.startsWith('/') || key.split('/').some((part) => part === '..' || part === '')) {
    throw new Error('Invalid object key');
  }
}

/** Content-Disposition for a download; the filename is ours, but quote it safely anyway. */
function attachment(filename: string): string {
  return `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`;
}

export class S3ObjectStorage implements ObjectStorage {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    private readonly kmsKeyId?: string,
  ) {}

  async put(key: string, body: Uint8Array | string, contentType: string): Promise<void> {
    assertKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ServerSideEncryption: 'aws:kms',
        ...(this.kmsKeyId ? { SSEKMSKeyId: this.kmsKeyId } : {}),
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    assertKey(key);
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error(`Object ${key} has no body`);
    return Buffer.from(await res.Body.transformToByteArray());
  }

  async deletePrefix(prefix: string): Promise<number> {
    assertPrefix(prefix);
    let deleted = 0;
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      const keys = (page.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
      if (keys.length > 0) {
        await this.client.send(
          new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys, Quiet: true } }),
        );
        deleted += keys.length;
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return deleted;
  }

  async presignGet(
    key: string,
    options: { expiresInSeconds: number; filename: string },
  ): Promise<{ url: string; expiresAt: Date }> {
    assertKey(key);
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: attachment(options.filename),
      }),
      { expiresIn: options.expiresInSeconds },
    );
    return { url, expiresAt: new Date(Date.now() + options.expiresInSeconds * 1000) };
  }
}

/**
 * Objects as files under one directory. Downloads go through `publicUrl` (a route of the service
 * that owns the files) with an HMAC signature and expiry, like a pre-signed S3 URL.
 */
export class LocalObjectStorage implements ObjectStorage {
  private readonly root: string;

  constructor(
    dir: string,
    private readonly publicUrl: string,
    private readonly signingKey: string,
    private readonly now: () => number = Date.now,
  ) {
    this.root = resolve(dir);
  }

  private path(key: string): string {
    assertKey(key);
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root + sep)) throw new Error('Invalid object key');
    return path;
  }

  /**
   * The content type is not kept: downloads are always served as attachments. Files are readable
   * by the service's own user only, since they hold personal data.
   */
  async put(key: string, body: Uint8Array | string, _contentType?: string): Promise<void> {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, body, { mode: 0o600 });
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }

  async deletePrefix(prefix: string): Promise<number> {
    assertPrefix(prefix);
    const dir = this.path(prefix.slice(0, -1));
    const existed = await stat(dir).then(
      () => true,
      () => false,
    );
    await rm(dir, { recursive: true, force: true });
    return existed ? 1 : 0;
  }

  private signature(key: string, expires: number, filename: string): string {
    return createHmac('sha256', this.signingKey)
      .update(`${key}\n${expires}\n${filename}`)
      .digest('base64url');
  }

  async presignGet(
    key: string,
    options: { expiresInSeconds: number; filename: string },
  ): Promise<{ url: string; expiresAt: Date }> {
    assertKey(key);
    const expires = Math.floor(this.now() / 1000) + options.expiresInSeconds;
    const url = new URL(this.publicUrl);
    url.search = new URLSearchParams({
      key,
      expires: String(expires),
      filename: options.filename,
      signature: this.signature(key, expires, options.filename),
    }).toString();
    return { url: url.toString(), expiresAt: new Date(expires * 1000) };
  }

  /**
   * Checks a link made by presignGet. Returns the key and filename to serve, or null when the
   * link is malformed, tampered with or expired.
   */
  verifyDownload(params: URLSearchParams): { key: string; filename: string } | null {
    const key = params.get('key');
    const filename = params.get('filename');
    const expires = Number(params.get('expires'));
    const signature = params.get('signature');
    if (!key || !filename || !signature || !Number.isInteger(expires)) return null;
    if (expires * 1000 < this.now()) return null;
    const expected = Buffer.from(this.signature(key, expires, filename));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      assertKey(key);
    } catch {
      return null;
    }
    return { key, filename };
  }

  contentDisposition(filename: string): string {
    return attachment(filename);
  }
}

/**
 * Builds the configured backend. Production must use S3: local files would be lost with the pod
 * and the signing key is shared with internal tokens.
 */
export function createObjectStorage(
  config: ObjectStorageConfig & { NODE_ENV: string; INTERNAL_TOKEN_SECRET: string },
): ObjectStorage {
  if (config.OBJECT_STORAGE === 's3') {
    if (!config.S3_BUCKET) throw new ConfigError('S3_BUCKET is required when OBJECT_STORAGE=s3');
    return new S3ObjectStorage(
      new S3Client({ region: config.AWS_REGION }),
      config.S3_BUCKET,
      config.S3_KMS_KEY_ID,
    );
  }
  if (config.NODE_ENV === 'production') {
    throw new ConfigError('OBJECT_STORAGE=local is not allowed in production');
  }
  return new LocalObjectStorage(
    config.OBJECT_STORAGE_DIR,
    config.OBJECT_STORAGE_PUBLIC_URL,
    // A separate key per purpose, derived so no new secret has to be distributed.
    createHmac('sha256', config.INTERNAL_TOKEN_SECRET).update('aura:local-downloads').digest('hex'),
  );
}
