import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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

  async get(key: string, maximumBytes = 20 * 1024 * 1024): Promise<Buffer> {
    assertObjectKey(key);
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!response.Body) throw new Error('Stored object is empty.');
    if (response.ContentLength && response.ContentLength > maximumBytes)
      throw new Error('Stored object exceeds the processing size limit.');
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

  async delete(key: string) {
    assertObjectKey(key);
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
