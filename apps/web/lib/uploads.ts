'use client';
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from '@fileforge/shared';
import { api } from './api';
interface UploadReservation {
  file: { id: string };
  upload: {
    url: string;
    method: 'PUT';
    headers: { 'Content-Type': string };
    expiresIn: number;
  };
}
/** Only metadata passes through web/API functions; image bytes go directly to private R2. */
export async function uploadBusinessCard(file: File): Promise<{ id: string }> {
  if (
    !ALLOWED_IMAGE_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_TYPES)[number]) ||
    file.size === 0 ||
    file.size > MAX_UPLOAD_BYTES
  ) {
    throw new Error('Use a nonempty JPG, PNG, or WebP image, up to 20 MB.');
  }
  const reservation = await api<UploadReservation>('/files/uploads', {
    method: 'POST',
    body: JSON.stringify({ originalName: file.name, mimeType: file.type, size: file.size }),
  });
  let url: URL;
  try {
    url = new URL(reservation.upload.url);
  } catch {
    throw new Error('The upload service returned an invalid destination.');
  }
  if (
    url.protocol !== 'https:' ||
    !url.hostname.endsWith('.r2.cloudflarestorage.com') ||
    url.username ||
    url.password ||
    reservation.upload.method !== 'PUT' ||
    reservation.upload.headers?.['Content-Type'] !== file.type ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      reservation.file?.id || '',
    )
  ) {
    throw new Error('The upload service returned an invalid destination.');
  }
  let uploaded: Response;
  try {
    uploaded = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
      credentials: 'omit',
      redirect: 'error',
      mode: 'cors',
    });
  } catch {
    // Browsers intentionally hide whether cross-origin fetch failed due to CORS or connectivity.
    // Do not expose the signed upload URL or preserve an exception containing its query string.
    throw new Error(
      'Your browser could not upload the image to private storage. Check your connection and retry. If it continues, ask your administrator to check upload access for this website.',
    );
  }
  if (!uploaded.ok) {
    throw new Error(`The image upload failed (${uploaded.status}). Please try again.`);
  }
  // Completion checks actual stored bytes and signatures before the file becomes scannable.
  return api<{ id: string }>(`/files/${reservation.file.id}/complete`, { method: 'POST' });
}
