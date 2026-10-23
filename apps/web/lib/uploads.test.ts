import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_UPLOAD_BYTES } from '@fileforge/shared';
import { api } from './api';
import { uploadBusinessCard } from './uploads';
vi.mock('./api', () => ({ api: vi.fn() }));
const apiMock = vi.mocked(api);
const id = '00000000-0000-4000-8000-000000000001';
const signed = {
  file: { id },
  upload: {
    url: 'https://example-account.r2.cloudflarestorage.com/private/cards/id?signature=test',
    method: 'PUT',
    headers: { 'Content-Type': 'image/png' },
    expiresIn: 300,
  },
};
const file = () => new File([new Uint8Array([137, 80, 78, 71])], 'card.png', { type: 'image/png' });
beforeEach(() => {
  apiMock.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});
describe('direct private R2 browser uploads', () => {
  it('sends only metadata through the API, PUTs bytes without cookies, then confirms stored content before returning a scan file ID', async () => {
    const image = file();
    apiMock.mockResolvedValueOnce(signed).mockResolvedValueOnce({ id, status: 'uploaded' });
    const transfer = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', transfer);
    expect(await uploadBusinessCard(image)).toEqual({ id, status: 'uploaded' });
    expect(apiMock).toHaveBeenNthCalledWith(1, '/files/uploads', {
      method: 'POST',
      body: JSON.stringify({ originalName: 'card.png', mimeType: 'image/png', size: image.size }),
    });
    expect(transfer).toHaveBeenCalledWith(new URL(signed.upload.url), {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: image,
      credentials: 'omit',
      redirect: 'error',
      mode: 'cors',
    });
    expect(apiMock).toHaveBeenNthCalledWith(2, `/files/${id}/complete`, { method: 'POST' });
    expect(apiMock.mock.invocationCallOrder[0]).toBeLessThan(transfer.mock.invocationCallOrder[0]!);
    expect(transfer.mock.invocationCallOrder[0]).toBeLessThan(apiMock.mock.invocationCallOrder[1]!);
  });
  it('never completes a file when private storage rejects its upload', async () => {
    apiMock.mockResolvedValueOnce(signed);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 403 })),
    );
    await expect(uploadBusinessCard(file())).rejects.toThrow('image upload failed (403)');
    expect(apiMock).toHaveBeenCalledTimes(1);
  });
  it('turns a browser-blocked R2 PUT into safe connection/access guidance without completing the pending reservation', async () => {
    apiMock.mockResolvedValueOnce(signed);
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new TypeError(`Failed to fetch ${signed.upload.url}`)),
    );
    let failure: unknown;
    try {
      await uploadBusinessCard(file());
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    const message = (failure as Error).message;
    expect(message).toContain('Check your connection and retry');
    expect(message).toContain('administrator to check upload access');
    expect(message).not.toContain(signed.upload.url);
    expect(message).not.toContain('signature=');
    expect((failure as Error).cause).toBeUndefined();
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).not.toHaveBeenCalledWith(`/files/${id}/complete`, expect.anything());
  });
  it('does not treat an uploaded but unverified file as successful', async () => {
    apiMock
      .mockResolvedValueOnce(signed)
      .mockRejectedValueOnce(new Error('The image signature does not match its declared type.'));
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 })),
    );
    await expect(uploadBusinessCard(file())).rejects.toThrow('image signature');
    expect(apiMock).toHaveBeenCalledTimes(2);
  });
  it.each([
    { name: 'large.png', type: 'image/png', size: MAX_UPLOAD_BYTES + 1 },
    { name: 'empty.png', type: 'image/png', size: 0 },
    { name: 'document.svg', type: 'image/svg+xml', size: 20 },
  ])('rejects invalid image metadata before reserving storage: $name', async (metadata) => {
    await expect(uploadBusinessCard(metadata as File)).rejects.toThrow('up to 20 MB');
    expect(apiMock).not.toHaveBeenCalled();
  });
  it.each([
    'http://example-account.r2.cloudflarestorage.com/insecure',
    'https://evil.example/card',
    'https://example-account.r2.cloudflarestorage.com.evil.example/card',
  ])('refuses unsafe upload destinations without transferring card bytes: %s', async (url) => {
    apiMock.mockResolvedValueOnce({ ...signed, upload: { ...signed.upload, url } });
    const transfer = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', transfer);
    await expect(uploadBusinessCard(file())).rejects.toThrow('invalid destination');
    expect(transfer).not.toHaveBeenCalled();
    expect(apiMock).toHaveBeenCalledTimes(1);
  });
  it('rejects a response with an unexpected signed content type or an unsafe file ID', async () => {
    const transfer = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', transfer);
    apiMock.mockResolvedValueOnce({
      ...signed,
      upload: { ...signed.upload, headers: { 'Content-Type': 'image/jpeg' } },
    });
    await expect(uploadBusinessCard(file())).rejects.toThrow('invalid destination');
    apiMock.mockResolvedValueOnce({ ...signed, file: { id: '../../auth' } });
    await expect(uploadBusinessCard(file())).rejects.toThrow('invalid destination');
    expect(transfer).not.toHaveBeenCalled();
  });
});
