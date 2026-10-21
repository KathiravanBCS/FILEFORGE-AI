import {
  DeleteObjectCommand,
  CopyObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { MAX_IMAGE_BYTES, type ImageMimeType } from './images.js';

const safeSegment = /^[a-zA-Z0-9_-]{1,128}$/;
export function objectKey(input: { organizationId: string; fileId: string; extension: string }) {
  if (
    !safeSegment.test(input.organizationId) ||
    !safeSegment.test(input.fileId) ||
    !/^[a-z0-9]{1,8}$/.test(input.extension)
  ) {
    throw new Error('Invalid object-key component.');
  }
  return `workspaces/${input.organizationId}/${input.fileId}.${input.extension}`;
}

export function assertObjectKey(key: string) {
  if (!/^workspaces\/[a-zA-Z0-9_-]{1,128}\/[a-zA-Z0-9_-]{1,128}\.[a-z0-9]{1,8}$/.test(key)) {
    throw new Error('Invalid private-storage object key.');
  }
}

/** Quarantine objects are never eligible for signed downloads or background scans. */
export function quarantineKey(input: Parameters<typeof objectKey>[0]) {
  return objectKey(input).replace(/^workspaces\//, 'quarantine/');
}

export function assertQuarantineKey(key: string) {
  if (!/^quarantine\/[a-zA-Z0-9_-]{1,128}\/[a-zA-Z0-9_-]{1,128}\.[a-z0-9]{1,8}$/.test(key)) {
    throw new Error('Invalid quarantine object key.');
  }
}

function assertStorageKey(key: string) {
  if (key.startsWith('quarantine/')) assertQuarantineKey(key);
  else assertObjectKey(key);
}

function assertETag(etag: string) {
  if (!etag || etag.length > 1024 || /[^\x21-\x7e]/.test(etag)) {
    throw new Error('A valid storage ETag is required for conditional validation.');
  }
}

async function objectBytes(
  response: GetObjectCommandOutput,
  maximumBytes: number,
): Promise<Buffer> {
  if (!response.Body) throw new Error('Stored object is empty.');
  if (response.ContentLength && response.ContentLength > maximumBytes) {
    await response.Body.transformToWebStream().cancel();
    throw new Error('Stored object exceeds the processing size limit.');
  }
  const reader = response.Body.transformToWebStream().getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel();
        throw new Error('Stored object exceeds the processing size limit.');
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length);
}

/** Object ownership must be established through a tenant-scoped database lookup before use. */
export class R2Storage {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  static fromEnvironment(env: NodeJS.ProcessEnv = process.env) {
    if (env.STORAGE_PROVIDER && env.STORAGE_PROVIDER !== 'r2')
      throw new Error('Only R2 storage is supported.');
    const { S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = env;
    if (!S3_ENDPOINT || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY)
      throw new Error('R2 credentials are not configured.');
    const endpoint = new URL(S3_ENDPOINT);
    if (
      endpoint.protocol !== 'https:' ||
      !endpoint.hostname.endsWith('.r2.cloudflarestorage.com') ||
      endpoint.username ||
      endpoint.password ||
      endpoint.port ||
      endpoint.pathname !== '/'
    ) {
      throw new Error('S3_ENDPOINT must be an HTTPS Cloudflare R2 account endpoint.');
    }
    return new R2Storage(
      new S3Client({
        endpoint: endpoint.toString(),
        region: env.S3_REGION || 'auto',
        credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
        maxAttempts: 3,
        requestHandler: { connectionTimeout: 5_000, requestTimeout: 15_000 },
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      }),
      env.S3_BUCKET || 'file-processing',
    );
  }

  async put(input: { key: string; body: Buffer; contentType: string }) {
    assertObjectKey(input.key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
      }),
    );
  }

  async get(key: string, maximumBytes = MAX_IMAGE_BYTES, expectedETag?: string): Promise<Buffer> {
    assertStorageKey(key);
    if (expectedETag !== undefined) assertETag(expectedETag);
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key, IfMatch: expectedETag }),
    );
    return objectBytes(response, maximumBytes);
  }

  /** Efficient signature sniffing; HEAD establishes total size and ETag binds this read to it. */
  async getPrefix(key: string, expectedETag: string, maximumBytes = 4096): Promise<Buffer> {
    assertStorageKey(key);
    assertETag(expectedETag);
    if (!Number.isInteger(maximumBytes) || maximumBytes < 32 || maximumBytes > 16_384)
      throw new Error('Validation prefix must be between 32 and 16384 bytes.');
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        IfMatch: expectedETag,
        Range: `bytes=0-${maximumBytes - 1}`,
      }),
    );
    return objectBytes(response, maximumBytes);
  }

  async inspectObject(key: string): Promise<{ size: number; contentType: string; etag: string }> {
    assertStorageKey(key);
    const response = await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (
      !Number.isSafeInteger(response.ContentLength) ||
      response.ContentLength === undefined ||
      response.ContentLength < 0 ||
      !response.ETag
    )
      throw new Error('Stored object metadata is incomplete.');
    assertETag(response.ETag);
    return {
      size: response.ContentLength,
      contentType: response.ContentType || 'application/octet-stream',
      etag: response.ETag,
    };
  }

  /** Sign an exact-size browser PUT into quarantine, never into a final workspace object. */
  async signedUpload(
    key: string,
    contentType: ImageMimeType,
    expectedSize: number,
    expiresSeconds = 300,
  ) {
    assertQuarantineKey(key);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType))
      throw new Error('Only JPEG, PNG, and WebP uploads are supported.');
    if (!Number.isInteger(expectedSize) || expectedSize < 1 || expectedSize > MAX_IMAGE_BYTES)
      throw new Error('Upload size must be between one byte and 20 MiB.');
    if (!Number.isInteger(expiresSeconds) || expiresSeconds < 1 || expiresSeconds > 300)
      throw new Error('Upload links must expire within five minutes.');
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: expectedSize,
      }),
      { expiresIn: expiresSeconds, signableHeaders: new Set(['content-type', 'content-length']) },
    );
  }

  /** Conditional copy prevents a reused PUT URL from changing bytes after validation. */
  async promoteQuarantined(stagingKey: string, finalKey: string, expectedETag: string) {
    assertQuarantineKey(stagingKey);
    assertObjectKey(finalKey);
    assertETag(expectedETag);
    if (stagingKey.slice('quarantine/'.length) !== finalKey.slice('workspaces/'.length))
      throw new Error('Quarantine promotion must preserve workspace and file identity.');
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: finalKey,
        CopySource: [this.bucket, ...stagingKey.split('/')].map(encodeURIComponent).join('/'),
        CopySourceIfMatch: expectedETag,
        MetadataDirective: 'COPY',
      }),
    );
    // Delete staging only after the caller commits uploaded status to PostgreSQL.
  }

  async delete(key: string) {
    assertStorageKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async signedDownload(key: string, filename: string, expiresSeconds = 120) {
    assertObjectKey(key);
    if (!Number.isInteger(expiresSeconds) || expiresSeconds < 1 || expiresSeconds > 300)
      throw new Error('Download links must expire within five minutes.');
    const safeFilename = filename.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 150) || 'download';
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${safeFilename}"`,
      }),
      { expiresIn: expiresSeconds },
    );
  }

  async head() {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }
  close() {
    this.client.destroy();
  }
}
