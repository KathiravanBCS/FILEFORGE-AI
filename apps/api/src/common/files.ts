import { basename } from 'node:path';
import { z } from 'zod';

export const publicFileFields = {
  id: true,
  originalName: true,
  mimeType: true,
  size: true,
  status: true,
  createdAt: true,
} as const;

export function fileMetadata(file: {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  status: string;
  createdAt: Date;
}) {
  return {
    id: file.id,
    originalName: file.originalName,
    mimeType: file.mimeType,
    size: file.size,
    status: file.status,
    createdAt: file.createdAt,
  };
}

export function uploadName(name: string, extension: string) {
  return (
    basename(name.replaceAll('\\', '/'))
      .replace(/[\x00-\x1f\x7f]/g, '')
      .slice(0, 200) || `business-card.${extension}`
  );
}

export function fileRetentionExpiry() {
  const days = z.coerce
    .number()
    .int()
    .min(1)
    .max(3650)
    .parse(process.env.FILE_RETENTION_DAYS ?? 30);
  return new Date(Date.now() + days * 86_400_000);
}
