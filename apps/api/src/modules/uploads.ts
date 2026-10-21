import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { getDatabase } from '@fileforge/database';
import { ALLOWED_IMAGE_TYPES } from '@fileforge/shared';
import {
  MAX_IMAGE_BYTES,
  objectKey,
  quarantineKey,
  R2Storage,
  validateImage,
} from '@fileforge/integrations';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedRequest } from '../common/context.js';
import { SessionGuard, WorkspaceGuard, assertWrite } from '../guards/auth.js';
import {
  fileMetadata,
  fileRetentionExpiry,
  publicFileFields,
  uploadName,
} from '../common/files.js';
import { found, parse } from '../common/validation.js';

const uploadSchema = z
  .object({
    originalName: z.string().trim().min(1).max(200),
    mimeType: z.enum(ALLOWED_IMAGE_TYPES),
    size: z.number().int().min(1).max(MAX_IMAGE_BYTES),
  })
  .strict();
const extensions: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

@ApiTags('Direct uploads')
@ApiCookieAuth()
@ApiHeader({ name: 'x-workspace-id', required: true })
@UseGuards(SessionGuard, WorkspaceGuard)
@Controller('api/v1/files')
export class DirectUploadsController {
  @Post('uploads')
  async initiate(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    assertWrite(request);
    const input = parse(uploadSchema, body);
    const id = randomUUID();
    const extension = extensions[input.mimeType]!;
    const coordinates = { organizationId: request.workspace.id, fileId: id, extension };
    const stage = quarantineKey(coordinates);
    let url: string;
    try {
      url = await R2Storage.fromEnvironment().signedUpload(stage, input.mimeType, input.size, 300);
    } catch {
      throw new ServiceUnavailableException(
        'Private storage is unavailable. The upload was not initialized.',
      );
    }
    const file = await getDatabase().file.create({
      data: {
        id,
        organizationId: request.workspace.id,
        uploadedById: request.principal.userId,
        originalName: uploadName(input.originalName, extension),
        objectKey: objectKey(coordinates),
        mimeType: input.mimeType,
        size: input.size,
        status: 'pending',
        expiresAt: new Date(Date.now() + 15 * 60_000),
      },
      select: publicFileFields,
    });
    return {
      file,
      upload: {
        url,
        method: 'PUT' as const,
        headers: { 'Content-Type': input.mimeType },
        expiresIn: 300,
      },
    };
  }

  @Post(':id/complete')
  async complete(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    assertWrite(request);
    const db = getDatabase();
    const where = {
      id,
      organizationId: request.workspace.id,
      uploadedById: request.principal.userId,
      deletedAt: null,
    };
    const file = found(await db.file.findFirst({ where }));
    if (file.status === 'uploaded') return fileMetadata(file);
    if (file.status !== 'pending')
      throw new ConflictException(
        'This upload is already being verified or is no longer available.',
      );
    if (!file.expiresAt || file.expiresAt <= new Date())
      throw new ConflictException('This upload has expired. Start a new upload.');
    let storage: R2Storage;
    try {
      storage = R2Storage.fromEnvironment();
    } catch {
      throw new ServiceUnavailableException(
        'Private storage is unavailable. Retry when storage configuration is restored.',
      );
    }
    const claimed = await db.file.updateMany({
      where: { ...where, status: 'pending', expiresAt: { gt: new Date() } },
      data: { status: 'validating' },
    });
    if (claimed.count !== 1) throw new ConflictException('This upload is already being verified.');
    const extension = extensions[file.mimeType];
    if (!extension) {
      await db.file.updateMany({
        where: { ...where, status: 'validating' },
        data: { status: 'rejected' },
      });
      throw new BadRequestException('This image format is not supported.');
    }
    const stage = quarantineKey({
      organizationId: request.workspace.id,
      fileId: file.id,
      extension,
    });
    try {
      if (
        file.objectKey !==
        objectKey({ organizationId: request.workspace.id, fileId: file.id, extension })
      )
        throw new BadRequestException(
          'The upload storage metadata is invalid. Start a new upload.',
        );
      const metadata = await storage.inspectObject(stage);
      if (
        metadata.size !== file.size ||
        metadata.size < 1 ||
        metadata.size > MAX_IMAGE_BYTES ||
        metadata.contentType !== file.mimeType
      ) {
        throw new BadRequestException(
          'The uploaded image does not match its declared type or size. Start a new upload.',
        );
      }
      const prefix = await storage.getPrefix(stage, metadata.etag);
      let signature;
      try {
        signature = await validateImage(prefix);
      } catch {
        throw new BadRequestException('Upload a valid JPG, PNG, or WebP image.');
      }
      if (signature.mimeType !== file.mimeType)
        throw new BadRequestException(
          'The image signature does not match the declared image type.',
        );
      // CopySourceIfMatch freezes the exact bytes whose size and signature were
      // inspected. The client can only overwrite its separate quarantine key.
      await storage.promoteQuarantined(stage, file.objectKey, metadata.etag);
      const record = await db.$transaction(async (tx) => {
        const updated = await tx.file.updateMany({
          where: { ...where, status: 'validating', expiresAt: { gt: new Date() } },
          data: { status: 'uploaded', expiresAt: fileRetentionExpiry() },
        });
        if (updated.count !== 1) throw new ConflictException('This upload is no longer available.');
        const ready = found(
          await tx.file.findFirst({
            where: { ...where, status: 'uploaded' },
            select: publicFileFields,
          }),
        );
        await tx.auditLog.create({
          data: {
            organizationId: request.workspace.id,
            actorId: request.principal.userId,
            action: 'file.uploaded',
            resourceType: 'file',
            resourceId: file.id,
          },
        });
        return ready;
      });
      await storage.delete(stage).catch(() => undefined);
      return record;
    } catch (error) {
      const rejected = error instanceof BadRequestException;
      await db.file.updateMany({
        where: { ...where, status: 'validating' },
        data: { status: rejected ? 'rejected' : 'pending' },
      });
      if (rejected) await storage.delete(stage).catch(() => undefined);
      // Leave an uncommitted final copy private until a verified retry or retention
      // cleanup. A database commit can succeed even when its response is lost;
      // deleting the final object here could remove a successfully published file.
      if (rejected || error instanceof ConflictException) throw error;
      throw new ServiceUnavailableException(
        'The image could not be verified. Retry completion after the storage connection is restored.',
      );
    }
  }
}
