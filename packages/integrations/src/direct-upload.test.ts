import { describe, expect, it, vi } from 'vitest';
import {
  CopyObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { ReadableStream } from 'node:stream/web';
import { MAX_IMAGE_BYTES } from './images.js';
import { objectKey, quarantineKey, R2Storage } from './storage.js';

const identity = { organizationId: 'org-a', fileId: 'image-a', extension: 'png' };
const staging = quarantineKey(identity);
const final = objectKey(identity);
const etag = '"version-a"';

describe('direct-to-R2 upload capabilities', () => {
  it('never grants PUT capability to a final downloadable object', async () => {
    const storage = new R2Storage({ send: vi.fn() } as unknown as S3Client, 'private');
    await expect(storage.signedUpload(final, 'image/png', 512)).rejects.toThrow('quarantine');
    await expect(storage.signedDownload(staging, 'image.png')).rejects.toThrow('object key');
    await expect(storage.signedUpload(staging, 'image/png', MAX_IMAGE_BYTES + 1)).rejects.toThrow(
      '20 MiB',
    );
    await expect(storage.signedUpload(staging, 'image/png', 512, 3600)).rejects.toThrow(
      'five minutes',
    );
  });

  it('binds a short-lived PUT signature to exact content size and MIME type', async () => {
    const client = new S3Client({
      endpoint: 'https://account.r2.cloudflarestorage.com',
      region: 'auto',
      credentials: { accessKeyId: 'test-key', secretAccessKey: 'test-secret' },
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
    try {
      const url = new URL(
        await new R2Storage(client, 'private').signedUpload(staging, 'image/png', 512),
      );
      const headers = url.searchParams.get('X-Amz-SignedHeaders')?.split(';');
      expect(headers).toEqual(expect.arrayContaining(['content-type', 'content-length', 'host']));
      expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
      expect(url.pathname).toContain('/quarantine/org-a/image-a.png');
    } finally {
      client.destroy();
    }
  });
});

describe('quarantine verification and promotion', () => {
  it('reads authoritative size, type, and ETag from storage instead of trusting the client', async () => {
    const send = vi
      .fn()
      .mockResolvedValue({ ContentLength: 512, ContentType: 'image/png', ETag: etag });
    const storage = new R2Storage({ send } as unknown as S3Client, 'private');
    expect(await storage.inspectObject(staging)).toEqual({
      size: 512,
      contentType: 'image/png',
      etag,
    });
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(HeadObjectCommand);
    expect(send.mock.calls[0]?.[0].input).toMatchObject({ Bucket: 'private', Key: staging });
  });

  it('retrieves a small signature prefix conditionally against the inspected ETag', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const send = vi.fn().mockResolvedValue({
      ContentLength: bytes.length,
      Body: {
        transformToWebStream: () =>
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          }),
      },
    });
    const storage = new R2Storage({ send } as unknown as S3Client, 'private');
    expect(await storage.getPrefix(staging, etag)).toEqual(Buffer.from(bytes));
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(GetObjectCommand);
    expect(send.mock.calls[0]?.[0].input).toMatchObject({
      Key: staging,
      IfMatch: etag,
      Range: 'bytes=0-4095',
    });
  });

  it('cancels a provider response that ignores the requested range', async () => {
    const cancelled = vi.fn();
    const body = {
      transformToWebStream: () => new ReadableStream<Uint8Array>({ cancel: cancelled }),
    };
    const storage = new R2Storage(
      {
        send: vi.fn().mockResolvedValue({ ContentLength: 1_000_000, Body: body }),
      } as unknown as S3Client,
      'private',
    );
    await expect(storage.getPrefix(staging, etag)).rejects.toThrow('size limit');
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it('copies exactly the validated version into the same workspace and retains staging until DB commit', async () => {
    const send = vi.fn().mockResolvedValue({});
    const storage = new R2Storage({ send } as unknown as S3Client, 'private');
    await storage.promoteQuarantined(staging, final, etag);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(CopyObjectCommand);
    expect(send.mock.calls[0]?.[0].input).toMatchObject({
      Key: final,
      CopySource: `private/${staging}`,
      CopySourceIfMatch: etag,
      MetadataDirective: 'COPY',
    });
  });

  it('refuses cross-tenant promotion and propagates changed-object preconditions', async () => {
    const send = vi.fn().mockRejectedValue(new Error('PreconditionFailed'));
    const storage = new R2Storage({ send } as unknown as S3Client, 'private');
    await expect(
      storage.promoteQuarantined(
        staging,
        objectKey({ ...identity, organizationId: 'victim-org' }),
        etag,
      ),
    ).rejects.toThrow('identity');
    expect(send).not.toHaveBeenCalled();
    await expect(storage.promoteQuarantined(staging, final, etag)).rejects.toThrow(
      'PreconditionFailed',
    );
  });
});
