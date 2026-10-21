import { describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { S3Client } from '@aws-sdk/client-s3';
import Groq from 'groq-sdk';
import { ReadableStream } from 'node:stream/web';
import { GroqExtractor, parseExtraction, ProviderError } from './ai.js';
import { safeCell, createContactsWorkbook } from './excel.js';
import { validateImage, MAX_IMAGE_BYTES } from './images.js';
import { objectKey, R2Storage } from './storage.js';
import { redisConnection, RETRY_OPTIONS, taskSchema, workerConcurrency } from './queues.js';

const contact = {
  fullName: 'Ada Lovelace',
  firstName: 'Ada',
  lastName: 'Lovelace',
  company: '=HYPERLINK("https://evil.test")',
  jobTitle: null,
  department: null,
  address: null,
  city: null,
  state: null,
  country: null,
  postalCode: '00123',
  notes: null,
  emails: [{ email: 'ada@example.test', label: null }],
  phones: [],
  websites: [],
  socialLinks: [],
};

describe('untrusted business-card input', () => {
  it('rejects forged MIME types and oversized files before provider submission', async () => {
    await expect(validateImage(Buffer.from('<script>bad</script>'))).rejects.toThrow('signatures');
    await expect(validateImage(Buffer.alloc(MAX_IMAGE_BYTES + 1))).rejects.toThrow('20 MiB');
    await expect(validateImage(Buffer.alloc(0))).rejects.toThrow('nonempty');
  });
  it('detects PNG signatures independently of the client filename', async () => {
    const image = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/wSUAAAAASUVORK5CYII=',
      'base64',
    );
    expect(await validateImage(image)).toMatchObject({
      mimeType: 'image/png',
      extension: 'png',
      size: image.length,
    });
  });
  it('rejects invalid and incomplete AI responses instead of fabricating a contact', () => {
    expect(() => parseExtraction('not-json')).toThrow(ProviderError);
    expect(() => parseExtraction(null)).toThrow(ProviderError);
    expect(() => parseExtraction('{}')).toThrow(ProviderError);
    expect(() =>
      parseExtraction(JSON.stringify({ ...contact, emails: [{ email: 'invented' }] })),
    ).toThrow(ProviderError);
    expect(parseExtraction(JSON.stringify(contact))).toMatchObject({ fullName: 'Ada Lovelace' });
  });
  it('sends the explicitly configured model and validates structured extraction and usage', async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(contact) } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });
    const client = { chat: { completions: { create } } } as unknown as Groq;
    const extractor = new GroqExtractor(client, 'explicit-vision-model', { input: 1, output: 2 });
    const image = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/wSUAAAAASUVORK5CYII=',
      'base64',
    );
    const result = await extractor.extract([{ data: image, mimeType: 'image/png' }]);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'explicit-vision-model',
        response_format: { type: 'json_object' },
      }),
    );
    expect(result).toMatchObject({
      contact: { fullName: 'Ada Lovelace' },
      model: 'explicit-vision-model',
      usage: { inputTokens: 100, outputTokens: 50, estimatedCost: 0.0002 },
    });
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('private R2 storage boundaries', () => {
  it('rejects path traversal and absolute paths before invoking storage', async () => {
    expect(() =>
      objectKey({ organizationId: '../other', fileId: 'file', extension: 'png' }),
    ).toThrow();
    const client = { send: vi.fn(), destroy: vi.fn() } as unknown as S3Client;
    const storage = new R2Storage(client, 'private');
    await expect(storage.get('workspaces/a/../../secret.png')).rejects.toThrow('object key');
    await expect(
      storage.put({ key: '/etc/passwd', body: Buffer.from('x'), contentType: 'text/plain' }),
    ).rejects.toThrow();
    expect(client.send).not.toHaveBeenCalled();
  });
  it('only accepts R2 HTTPS endpoints and short-lived downloads', async () => {
    expect(() =>
      R2Storage.fromEnvironment({
        S3_ENDPOINT: 'http://account.r2.cloudflarestorage.com',
        S3_ACCESS_KEY_ID: 'test',
        S3_SECRET_ACCESS_KEY: 'test',
      }),
    ).toThrow('HTTPS');
    expect(() =>
      R2Storage.fromEnvironment({
        S3_ENDPOINT: 'https://arbitrary.example.test',
        S3_ACCESS_KEY_ID: 'test',
        S3_SECRET_ACCESS_KEY: 'test',
      }),
    ).toThrow('HTTPS');
    const storage = new R2Storage({ send: vi.fn() } as unknown as S3Client, 'private');
    await expect(storage.signedDownload('workspaces/a/file.png', 'file.png', 3600)).rejects.toThrow(
      'five minutes',
    );
  });
  it('bounds a streaming object even when storage omits its content length', async () => {
    const body = {
      transformToWebStream: () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(8));
            controller.enqueue(new Uint8Array(8));
            controller.close();
          },
        }),
    };
    const client = { send: vi.fn().mockResolvedValue({ Body: body }) } as unknown as S3Client;
    await expect(new R2Storage(client, 'private').get('workspaces/a/file.png', 10)).rejects.toThrow(
      'size limit',
    );
  });
});

describe('queue operational safeguards', () => {
  it('forces TLS even for a managed Upstash redis URL and rejects REST/local services', () => {
    const config = redisConnection({ REDIS_URL: 'redis://default:test@tenant.upstash.io:6379' });
    expect(config).toMatchObject({
      tls: { servername: 'tenant.upstash.io' },
      maxRetriesPerRequest: 1,
    });
    expect(
      redisConnection({ REDIS_URL: 'rediss://default:test@tenant.upstash.io:6379' }, 'worker'),
    ).toMatchObject({ maxRetriesPerRequest: null });
    expect(() => redisConnection({ REDIS_URL: 'https://tenant.upstash.io' })).toThrow('REST');
    expect(() => redisConnection({ REDIS_URL: 'rediss://localhost:6379' })).toThrow('Upstash');
  });
  it('bounds retries, concurrency, failed-job retention and payload privileges', () => {
    expect(RETRY_OPTIONS).toMatchObject({
      attempts: 3,
      backoff: { type: 'exponential' },
      removeOnFail: { count: 500 },
    });
    expect(() => workerConcurrency('100')).toThrow();
    expect(() =>
      taskSchema.parse({ jobId: '123', organizationId: 'a', type: 'scan', objectKey: 'private' }),
    ).toThrow();
  });
});

describe('Excel exports', () => {
  it('neutralizes formulas including leading whitespace without changing ordinary text', () => {
    for (const formula of ['=1+1', '+SUM(A1)', '-2+3', '@SUM(A1)', '\t =cmd'])
      expect(safeCell(formula)).toBe(`'${formula}`);
    expect(safeCell('Ada Lovelace')).toBe('Ada Lovelace');
  });
  it('writes a real XLSX workbook and preserves textual postal codes and cell safety', async () => {
    const bytes = await createContactsWorkbook([contact]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as never);
    const sheet = workbook.getWorksheet('Contacts');
    expect(sheet?.rowCount).toBe(2);
    expect(sheet?.getCell('B2').value).toBe(`'${contact.company}`);
    expect(sheet?.getCell('L2').value).toBe('00123');
    expect(sheet?.getRow(1).font.bold).toBe(true);
  });
});
