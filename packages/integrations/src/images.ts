import { fileTypeFromBuffer } from 'file-type';

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_SCAN_IMAGES = 2;
export type ImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp';

/** Detect the actual signature; caller-supplied extensions and MIME types are untrusted. */
export async function validateImage(buffer: Uint8Array) {
  if (!buffer.byteLength || buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error('Business-card images must be nonempty and no larger than 20 MiB.');
  }
  const detected = await fileTypeFromBuffer(buffer).catch(() => undefined);
  if (!detected || !['image/jpeg', 'image/png', 'image/webp'].includes(detected.mime)) {
    throw new Error('Only JPEG, PNG, and WebP image signatures are accepted.');
  }
  return {
    mimeType: detected.mime as ImageMimeType,
    extension: detected.ext as 'jpg' | 'png' | 'webp',
    size: buffer.byteLength,
  };
}
