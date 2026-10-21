import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  PayloadTooLargeException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiCookieAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { getAuth, getDatabase } from '@fileforge/database';
import type { Prisma } from '@fileforge/database';
import {
  bulkIdsSchema,
  contactInputSchema,
  defaultPreferences,
  exportRequestSchema,
  paginationSchema,
  preferencesSchema,
  scanSubmissionSchema,
  workspaceSchema,
} from '@fileforge/shared';
import {
  createTaskQueue,
  enqueueTask,
  objectKey,
  R2Storage,
  validateImage,
  MAX_IMAGE_BYTES,
} from '@fileforge/integrations';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedRequest } from '../common/context.js';
import { SessionGuard, WorkspaceGuard, assertManage, assertWrite } from '../guards/auth.js';
import { found, parse } from '../common/validation.js';
import { publicFileFields, fileRetentionExpiry, uploadName } from '../common/files.js';

const contactRelations = { emails: true, phones: true, socialLinks: true } as const;
const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
const reviewInput = z
  .object({
    data: contactInputSchema,
    status: z.enum(['draft', 'approved']).default('approved'),
    scanId: z.uuid().optional(),
  })
  .strict();
let queue: ReturnType<typeof createTaskQueue> | undefined;
function taskQueue() {
  return (queue ??= createTaskQueue());
}
export async function closeApiQueue(): Promise<void> {
  await queue?.close();
}
export async function checkApiQueue(): Promise<void> {
  await taskQueue().getJobCounts('waiting');
}
function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
function contactWhere(
  organizationId: string,
  options: {
    search?: string;
    status?: string;
    ids?: string[];
    company?: string;
    jobTitle?: string;
  },
): Prisma.ContactWhereInput {
  return {
    organizationId,
    deletedAt: null,
    ...(options.ids ? { id: { in: options.ids } } : {}),
    ...(options.status ? { status: options.status } : {}),
    ...(options.company ? { company: { contains: options.company, mode: 'insensitive' } } : {}),
    ...(options.jobTitle ? { jobTitle: { contains: options.jobTitle, mode: 'insensitive' } } : {}),
    ...(options.search
      ? {
          OR: [
            { fullName: { contains: options.search, mode: 'insensitive' } },
            { company: { contains: options.search, mode: 'insensitive' } },
            { emails: { some: { email: { contains: options.search, mode: 'insensitive' } } } },
          ],
        }
      : {}),
  };
}

@ApiTags('Account')
@ApiCookieAuth()
@UseGuards(SessionGuard)
@Controller('api/v1')
export class AccountController {
  @Get('workspaces')
  async workspaces(@Req() request: AuthenticatedRequest) {
    const members = await getDatabase().member.findMany({
      where: { userId: request.principal.userId },
      include: { organization: true },
      orderBy: { createdAt: 'asc' },
    });
    return {
      data: members.map(({ organization, role }) => ({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        role,
      })),
    };
  }

  @Post('workspaces')
  async createWorkspace(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const data = parse(workspaceSchema, body);
    const db = getDatabase();
    if (await db.organization.findUnique({ where: { slug: data.slug } }))
      throw new ConflictException('This workspace slug is already in use.');
    return db.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          id: randomUUID(),
          ...data,
          members: {
            create: { id: randomUUID(), userId: request.principal.userId, role: 'owner' },
          },
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: request.principal.userId,
          action: 'workspace.created',
          resourceType: 'organization',
          resourceId: organization.id,
        },
      });
      return { ...organization, role: 'owner' };
    });
  }

  @Get('preferences')
  async preferences(@Req() request: AuthenticatedRequest) {
    const record = await getDatabase().userPreferences.findUnique({
      where: { userId: request.principal.userId },
    });
    if (!record) return defaultPreferences;
    return preferencesSchema.parse({
      colorScheme: record.colorScheme,
      primaryColor: record.primaryColor,
      density: record.density,
      radius: record.radius,
      reducedMotion: record.reducedMotion,
      language: record.language,
      timeZone: record.timeZone,
      tablePreferences: record.tablePreferences,
      dashboardPreferences: record.dashboardPreferences,
    });
  }

  @Patch('preferences')
  async updatePreferences(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const input = parse(preferencesSchema.partial(), body);
    const { tablePreferences, dashboardPreferences, ...scalars } = input;
    const data = {
      ...scalars,
      ...(tablePreferences === undefined ? {} : { tablePreferences: json(tablePreferences) }),
      ...(dashboardPreferences === undefined
        ? {}
        : { dashboardPreferences: json(dashboardPreferences) }),
    };
    await getDatabase().userPreferences.upsert({
      where: { userId: request.principal.userId },
      create: { userId: request.principal.userId, ...data },
      update: data,
    });
    return this.preferences(request);
  }

  @Get('invitations/:id')
  async invitationDetail(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return found(
      await getDatabase().invitation.findFirst({
        where: {
          id,
          email: { equals: request.principal.email, mode: 'insensitive' },
          status: 'pending',
          expiresAt: { gt: new Date() },
        },
        select: {
          id: true,
          role: true,
          expiresAt: true,
          organization: { select: { id: true, name: true } },
        },
      }),
    );
  }

  @Post('invitations/:id/accept')
  acceptInvitation(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return getAuth().api.acceptInvitation({
      headers: new Headers({ cookie: request.headers.cookie ?? '' }),
      body: { invitationId: id },
    });
  }

  @Get('me')
  me(@Req() request: AuthenticatedRequest) {
    return getDatabase().user.findUniqueOrThrow({
      where: { id: request.principal.userId },
      select: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        image: true,
        createdAt: true,
      },
    });
  }
}

@ApiTags('Workspace')
@ApiCookieAuth()
@ApiHeader({ name: 'x-workspace-id', required: true })
@UseGuards(SessionGuard, WorkspaceGuard)
@Controller('api/v1')
export class WorkspaceController {
  @Get('dashboard')
  async dashboard(@Req() request: AuthenticatedRequest) {
    const db = getDatabase();
    const organizationId = request.workspace.id;
    const [
      totalFiles,
      totalScans,
      totalContacts,
      processingJobs,
      successfulJobs,
      failedJobs,
      recentActivity,
      usage,
    ] = await Promise.all([
      db.file.count({ where: { organizationId, deletedAt: null, status: 'uploaded' } }),
      db.businessCardScan.count({ where: { organizationId } }),
      db.contact.count({ where: { organizationId, deletedAt: null } }),
      db.processingJob.count({
        where: { organizationId, status: { in: ['queued', 'processing'] } },
      }),
      db.processingJob.count({
        where: { organizationId, status: { in: ['completed', 'review'] } },
      }),
      db.processingJob.count({ where: { organizationId, status: 'failed' } }),
      db.auditLog.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { id: true, action: true, resourceType: true, createdAt: true },
      }),
      db.usageRecord.aggregate({
        where: { organizationId },
        _sum: { inputTokens: true, outputTokens: true, quantity: true },
      }),
    ]);
    return {
      totalFiles,
      totalScans,
      totalContacts,
      processingJobs,
      successfulJobs,
      failedJobs,
      counts: {
        files: totalFiles,
        scans: totalScans,
        contacts: totalContacts,
        processing: processingJobs,
        completed: successfulJobs,
        failed: failedJobs,
      },
      recentActivity,
      usage: usage._sum,
    };
  }

  @Get('contacts')
  async contacts(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    const options = parse(paginationSchema, query);
    const where = contactWhere(request.workspace.id, options);
    const [data, total] = await getDatabase().$transaction([
      getDatabase().contact.findMany({
        where,
        include: contactRelations,
        orderBy: [{ [options.sort]: options.direction }, { id: 'asc' }],
        skip: (options.page - 1) * options.pageSize,
        take: options.pageSize,
      }),
      getDatabase().contact.count({ where }),
    ]);
    return { data, total, page: options.page, pageSize: options.pageSize };
  }

  @Get('contacts/:id')
  async contact(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return found(
      await getDatabase().contact.findFirst({
        where: { id, organizationId: request.workspace.id, deletedAt: null },
        include: contactRelations,
      }),
    );
  }

  @Post('contacts')
  async createContact(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    assertWrite(request);
    const input = parse(reviewInput, body);
    const db = getDatabase();
    return db.$transaction(
      async (tx) => {
        if (input.scanId) {
          const scan = found(
            await tx.businessCardScan.findFirst({
              where: { id: input.scanId, organizationId: request.workspace.id },
              include: { job: true },
            }),
          );
          if (!['review', 'completed'].includes(scan.job.status))
            throw new ConflictException('This scan is not ready for review.');
          if (
            await tx.contact.findFirst({
              where: {
                scanId: input.scanId,
                organizationId: request.workspace.id,
                deletedAt: null,
              },
            })
          )
            throw new ConflictException(
              'This scan already has a contact. Edit the existing contact instead.',
            );
          if (input.status === 'approved') {
            await tx.businessCardScan.update({
              where: { id: scan.id },
              data: { reviewedAt: new Date() },
            });
            await tx.processingJob.update({
              where: { id: scan.jobId },
              data: { status: 'completed', progress: 100, completedAt: new Date() },
            });
          }
        }
        const { emails, phones, socialLinks, ...scalars } = input.data;
        const result = await tx.contact.create({
          data: {
            organizationId: request.workspace.id,
            createdById: request.principal.userId,
            scanId: input.scanId,
            ...scalars,
            status: input.status,
            emails: { create: emails },
            phones: { create: phones },
            socialLinks: { create: socialLinks },
          },
          include: contactRelations,
        });
        await tx.auditLog.create({
          data: {
            organizationId: request.workspace.id,
            actorId: request.principal.userId,
            action: 'contact.created',
            resourceType: 'contact',
            resourceId: result.id,
          },
        });
        return result;
      },
      { isolationLevel: 'Serializable' },
    );
  }

  @Patch('contacts/:id')
  async updateContact(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    assertWrite(request);
    const input = parse(reviewInput.omit({ scanId: true }), body);
    return getDatabase().$transaction(async (tx) => {
      const existing = found(
        await tx.contact.findFirst({
          where: { id, organizationId: request.workspace.id, deletedAt: null },
        }),
      );
      const { emails, phones, socialLinks, ...scalars } = input.data;
      const result = await tx.contact.update({
        where: { id: existing.id },
        data: {
          ...scalars,
          status: input.status,
          emails: { deleteMany: {}, create: emails },
          phones: { deleteMany: {}, create: phones },
          socialLinks: { deleteMany: {}, create: socialLinks },
        },
        include: contactRelations,
      });
      if (existing.scanId && input.status === 'approved') {
        const scan = found(
          await tx.businessCardScan.findFirst({
            where: { id: existing.scanId, organizationId: request.workspace.id },
          }),
        );
        await tx.businessCardScan.update({
          where: { id: scan.id },
          data: { reviewedAt: new Date() },
        });
        await tx.processingJob.update({
          where: { id: scan.jobId },
          data: { status: 'completed', progress: 100, completedAt: new Date() },
        });
      }
      await tx.auditLog.create({
        data: {
          organizationId: request.workspace.id,
          actorId: request.principal.userId,
          action: 'contact.updated',
          resourceType: 'contact',
          resourceId: existing.id,
        },
      });
      return result;
    });
  }

  @Post('contacts/bulk-delete')
  async bulkDelete(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    assertWrite(request);
    const { ids } = parse(bulkIdsSchema, body);
    return getDatabase().$transaction(async (tx) => {
      const count = await tx.contact.count({
        where: { organizationId: request.workspace.id, id: { in: ids }, deletedAt: null },
      });
      if (count !== new Set(ids).size)
        throw new BadRequestException('Some selected contacts are unavailable in this workspace.');
      const result = await tx.contact.updateMany({
        where: { organizationId: request.workspace.id, id: { in: ids }, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          organizationId: request.workspace.id,
          actorId: request.principal.userId,
          action: 'contact.bulk_deleted',
          resourceType: 'contact',
          metadata: { count: result.count },
        },
      });
      return { deleted: result.count };
    });
  }

  @Delete('contacts/:id')
  @HttpCode(HttpStatus.OK)
  async deleteContact(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.bulkDelete(request, { ids: [id] });
  }

  @Post('files/upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } }))
  async upload(
    @Req() request: AuthenticatedRequest,
    @UploadedFile() file?: { buffer: Buffer; originalname: string },
  ) {
    assertWrite(request);
    if (process.env.VERCEL === '1')
      throw new PayloadTooLargeException(
        'Use direct R2 upload initialization and completion on this deployment.',
      );
    if (!file?.buffer) throw new BadRequestException('Choose an image to upload.');
    let image;
    try {
      image = await validateImage(file.buffer);
    } catch {
      throw new BadRequestException('Upload a valid JPG, PNG, or WebP image up to 20 MB.');
    }
    const id = randomUUID();
    const key = objectKey({
      organizationId: request.workspace.id,
      fileId: id,
      extension: image.extension,
    });
    const originalName = uploadName(file.originalname, image.extension);
    const storage = R2Storage.fromEnvironment();
    try {
      await storage.put({ key, body: file.buffer, contentType: image.mimeType });
    } catch {
      throw new ServiceUnavailableException(
        'Private storage is unavailable. The file was not uploaded.',
      );
    }
    try {
      return await getDatabase().$transaction(async (tx) => {
        const record = await tx.file.create({
          data: {
            id,
            organizationId: request.workspace.id,
            uploadedById: request.principal.userId,
            originalName,
            objectKey: key,
            mimeType: image.mimeType,
            size: image.size,
            expiresAt: fileRetentionExpiry(),
          },
          select: publicFileFields,
        });
        await tx.auditLog.create({
          data: {
            organizationId: request.workspace.id,
            actorId: request.principal.userId,
            action: 'file.uploaded',
            resourceType: 'file',
            resourceId: id,
          },
        });
        return record;
      });
    } catch (error) {
      await storage.delete(key).catch(() => undefined);
      throw error;
    }
  }

  @Get('files')
  async files(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    const { page, pageSize } = parse(listQuery, query);
    const where = { organizationId: request.workspace.id, deletedAt: null };
    const [data, total] = await Promise.all([
      getDatabase().file.findMany({
        where,
        select: publicFileFields,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      getDatabase().file.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }

  @Get('files/:id/download')
  async fileDownload(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    const file = found(
      await getDatabase().file.findFirst({
        where: { id, organizationId: request.workspace.id, deletedAt: null, status: 'uploaded' },
      }),
    );
    if (file.expiresAt && file.expiresAt <= new Date())
      throw new ConflictException('This file has expired.');
    return {
      url: await R2Storage.fromEnvironment().signedDownload(file.objectKey, file.originalName),
    };
  }

  @Post('scans')
  async createScan(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    assertWrite(request);
    const { fileIds } = parse(scanSubmissionSchema, body);
    if (new Set(fileIds).size !== fileIds.length)
      throw new BadRequestException('Each image must be unique.');
    const scan = await getDatabase().$transaction(async (tx) => {
      const count = await tx.file.count({
        where: {
          id: { in: fileIds },
          organizationId: request.workspace.id,
          deletedAt: null,
          status: 'uploaded',
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      });
      if (count !== fileIds.length)
        throw new BadRequestException('One or more images are unavailable in this workspace.');
      const job = await tx.processingJob.create({
        data: {
          organizationId: request.workspace.id,
          createdById: request.principal.userId,
          type: 'scan',
        },
      });
      const record = await tx.businessCardScan.create({
        data: {
          organizationId: request.workspace.id,
          createdById: request.principal.userId,
          jobId: job.id,
          images: { create: fileIds.map((fileId, position) => ({ fileId, position })) },
        },
        include: {
          job: true,
          images: { include: { file: { select: publicFileFields } }, orderBy: { position: 'asc' } },
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: request.workspace.id,
          actorId: request.principal.userId,
          action: 'scan.created',
          resourceType: 'scan',
          resourceId: record.id,
        },
      });
      return record;
    });
    await this.enqueue(scan.jobId, request.workspace.id, 'scan');
    return scan;
  }

  @Get('scans')
  async scans(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    const { page, pageSize } = parse(listQuery, query);
    const where = { organizationId: request.workspace.id };
    const [data, total] = await Promise.all([
      getDatabase().businessCardScan.findMany({
        where,
        include: {
          job: true,
          images: { include: { file: { select: publicFileFields } }, orderBy: { position: 'asc' } },
          contacts: {
            where: { deletedAt: null },
            select: { id: true, fullName: true, status: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      getDatabase().businessCardScan.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }

  @Get('scans/:id')
  async scan(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return found(
      await getDatabase().businessCardScan.findFirst({
        where: { id, organizationId: request.workspace.id },
        include: {
          job: true,
          images: { include: { file: { select: publicFileFields } }, orderBy: { position: 'asc' } },
          contacts: { where: { deletedAt: null }, include: contactRelations },
        },
      }),
    );
  }

  @Post('scans/:id/rescan')
  async rescan(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    assertWrite(request);
    const original = await this.scan(request, id);
    return this.createScan(request, { fileIds: original.images.map((image) => image.fileId) });
  }

  @Post('scans/:id/retry')
  async retryScan(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    assertWrite(request);
    const scan = await this.scan(request, id);
    if (!['failed', 'cancelled'].includes(scan.job.status))
      throw new ConflictException('Only failed or cancelled scans can be retried.');
    try {
      const oldJob = await taskQueue().getJob(scan.jobId);
      if (oldJob) await oldJob.remove();
    } catch {
      throw new ServiceUnavailableException(
        'The processing queue is unavailable or the previous attempt is still active.',
      );
    }
    const updated = await getDatabase().processingJob.updateMany({
      where: {
        id: scan.jobId,
        organizationId: request.workspace.id,
        status: { in: ['failed', 'cancelled'] },
      },
      data: { status: 'queued', progress: 0, error: null, completedAt: null, startedAt: null },
    });
    if (updated.count !== 1)
      throw new ConflictException('This scan changed. Refresh and try again.');
    await this.enqueue(scan.jobId, request.workspace.id, 'scan');
    return this.scan(request, id);
  }

  @Post('scans/:id/cancel')
  async cancelScan(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    assertWrite(request);
    const scan = await this.scan(request, id);
    const updated = await getDatabase().processingJob.updateMany({
      where: {
        id: scan.jobId,
        organizationId: request.workspace.id,
        status: { in: ['queued', 'processing'] },
      },
      data: { status: 'cancelled', completedAt: new Date() },
    });
    if (updated.count !== 1)
      throw new ConflictException('Only queued or processing scans can be cancelled.');
    return this.scan(request, id);
  }

  @Get('jobs')
  async jobs(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    const { page, pageSize } = parse(listQuery, query);
    const where = { organizationId: request.workspace.id };
    const [data, total] = await Promise.all([
      getDatabase().processingJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      getDatabase().processingJob.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }

  @Get('jobs/:id')
  async job(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return found(
      await getDatabase().processingJob.findFirst({
        where: { id, organizationId: request.workspace.id },
      }),
    );
  }

  @Post('exports')
  async createExport(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    assertWrite(request);
    const filters = parse(exportRequestSchema, body);
    const where = contactWhere(request.workspace.id, filters);
    if (filters.ids && (await getDatabase().contact.count({ where })) !== new Set(filters.ids).size)
      throw new BadRequestException('Some selected contacts are unavailable in this workspace.');
    const record = await getDatabase().$transaction(async (tx) => {
      const job = await tx.processingJob.create({
        data: {
          organizationId: request.workspace.id,
          createdById: request.principal.userId,
          type: 'export',
        },
      });
      return tx.exportRecord.create({
        data: {
          organizationId: request.workspace.id,
          createdById: request.principal.userId,
          jobId: job.id,
          filters: json(filters),
        },
        include: { job: true },
      });
    });
    await this.enqueue(record.jobId, request.workspace.id, 'export');
    return record;
  }

  @Get('exports')
  async exports(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    const { page, pageSize } = parse(listQuery, query);
    const where = { organizationId: request.workspace.id };
    const [records, total] = await Promise.all([
      getDatabase().exportRecord.findMany({
        where,
        include: { job: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      getDatabase().exportRecord.count({ where }),
    ]);
    const data = records.map(({ objectKey: _key, ...record }) => record);
    return { data, total, page, pageSize };
  }

  @Get('exports/:id/download')
  async exportDownload(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    const record = found(
      await getDatabase().exportRecord.findFirst({
        where: { id, organizationId: request.workspace.id },
        include: { job: true },
      }),
    );
    if (record.job.status !== 'completed' || !record.objectKey)
      throw new ConflictException('This export is not ready to download.');
    if (record.expiresAt && record.expiresAt <= new Date())
      throw new ConflictException('This export has expired. Create a new one.');
    return {
      url: await R2Storage.fromEnvironment().signedDownload(
        record.objectKey,
        record.fileName ?? 'contacts.xlsx',
      ),
    };
  }

  @Patch('workspaces/:id')
  async updateWorkspace(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    assertManage(request);
    if (id !== request.workspace.id)
      throw new BadRequestException('Select the workspace you want to update.');
    const data = parse(workspaceSchema.partial(), body);
    return getDatabase().$transaction(async (tx) => {
      const record = await tx.organization.update({ where: { id: request.workspace.id }, data });
      await tx.auditLog.create({
        data: {
          organizationId: request.workspace.id,
          actorId: request.principal.userId,
          action: 'workspace.updated',
          resourceType: 'organization',
          resourceId: id,
        },
      });
      return record;
    });
  }

  @Patch('members/:id')
  async updateMemberRole(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    assertManage(request);
    const { role } = parse(
      z.object({ role: z.enum(['owner', 'admin', 'member', 'viewer']) }).strict(),
      body,
    );
    return getDatabase().$transaction(
      async (tx) => {
        const member = found(
          await tx.member.findFirst({ where: { id, organizationId: request.workspace.id } }),
        );
        if (
          request.workspace.role !== 'owner' &&
          (['owner', 'admin'].includes(member.role) || ['owner', 'admin'].includes(role))
        )
          throw new BadRequestException('Only owners can change owner or admin roles.');
        if (
          member.role === 'owner' &&
          role !== 'owner' &&
          (await tx.member.count({
            where: { organizationId: request.workspace.id, role: 'owner' },
          })) <= 1
        )
          throw new ConflictException('A workspace must retain at least one owner.');
        const result = await tx.member.update({
          where: { id: member.id },
          data: { role },
          select: { id: true, role: true },
        });
        await tx.auditLog.create({
          data: {
            organizationId: request.workspace.id,
            actorId: request.principal.userId,
            action: 'member.role_changed',
            resourceType: 'member',
            resourceId: id,
            metadata: { role },
          },
        });
        return result;
      },
      { isolationLevel: 'Serializable' },
    );
  }

  @Delete('members/:id')
  async removeMember(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    assertManage(request);
    return getDatabase().$transaction(
      async (tx) => {
        const member = found(
          await tx.member.findFirst({ where: { id, organizationId: request.workspace.id } }),
        );
        if (request.workspace.role !== 'owner' && ['owner', 'admin'].includes(member.role))
          throw new BadRequestException('Only owners can remove owners or admins.');
        if (
          member.role === 'owner' &&
          (await tx.member.count({
            where: { organizationId: request.workspace.id, role: 'owner' },
          })) <= 1
        )
          throw new ConflictException('A workspace must retain at least one owner.');
        await tx.member.delete({ where: { id: member.id } });
        await tx.auditLog.create({
          data: {
            organizationId: request.workspace.id,
            actorId: request.principal.userId,
            action: 'member.removed',
            resourceType: 'member',
            resourceId: id,
          },
        });
        return { removed: true };
      },
      { isolationLevel: 'Serializable' },
    );
  }

  @Get('members')
  async members(@Req() request: AuthenticatedRequest) {
    return {
      data: await getDatabase().member.findMany({
        where: { organizationId: request.workspace.id },
        select: {
          id: true,
          role: true,
          createdAt: true,
          user: { select: { id: true, name: true, email: true, image: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
    };
  }

  @Get('invitations')
  async invitations(@Req() request: AuthenticatedRequest) {
    assertManage(request);
    return {
      data: await getDatabase().invitation.findMany({
        where: { organizationId: request.workspace.id },
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
          expiresAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    };
  }

  @Post('invitations/:id/cancel')
  async cancelInvitation(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    assertManage(request);
    const result = await getDatabase().invitation.updateMany({
      where: { id, organizationId: request.workspace.id, status: 'pending' },
      data: { status: 'canceled' },
    });
    if (result.count !== 1) throw new BadRequestException('This invitation is no longer pending.');
    return { cancelled: true };
  }

  @Post('invitations')
  async invite(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    assertManage(request);
    if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM)
      throw new ServiceUnavailableException(
        'Invitation delivery requires transactional email configuration.',
      );
    const input = parse(
      z.object({ email: z.email(), role: z.enum(['admin', 'member', 'viewer']) }).strict(),
      body,
    );
    if (input.role === 'admin' && request.workspace.role !== 'owner')
      throw new BadRequestException('Only owners can invite admins.');
    const headers = new Headers({ cookie: request.headers.cookie ?? '' });
    return getAuth().api.createInvitation({
      headers,
      body: { organizationId: request.workspace.id, email: input.email, role: input.role },
    });
  }

  @Post('cleanup')
  async cleanup(@Req() request: AuthenticatedRequest) {
    assertManage(request);
    const job = await getDatabase().processingJob.create({
      data: {
        organizationId: request.workspace.id,
        createdById: request.principal.userId,
        type: 'cleanup',
      },
    });
    await this.enqueue(job.id, request.workspace.id, 'cleanup');
    return job;
  }

  @Post('exports/:id/retry')
  async retryExport(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    assertWrite(request);
    const record = found(
      await getDatabase().exportRecord.findFirst({
        where: { id, organizationId: request.workspace.id },
        include: { job: true },
      }),
    );
    if (record.job.status !== 'failed')
      throw new ConflictException('Only failed exports can be retried.');
    try {
      const previous = await taskQueue().getJob(record.jobId);
      if (previous) await previous.remove();
    } catch {
      throw new ServiceUnavailableException(
        'The export queue is unavailable or the job is active.',
      );
    }
    const changed = await getDatabase().processingJob.updateMany({
      where: { id: record.jobId, organizationId: request.workspace.id, status: 'failed' },
      data: { status: 'queued', error: null, progress: 0, startedAt: null, completedAt: null },
    });
    if (changed.count !== 1)
      throw new ConflictException('The export changed. Refresh and try again.');
    await this.enqueue(record.jobId, request.workspace.id, 'export');
    return { id: record.id, status: 'queued' };
  }

  @Get('usage')
  async usage(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    const { page, pageSize } = parse(listQuery, query);
    const where = { organizationId: request.workspace.id };
    const [data, total, summary] = await Promise.all([
      getDatabase().usageRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      getDatabase().usageRecord.count({ where }),
      getDatabase().usageRecord.aggregate({
        where,
        _sum: { quantity: true, inputTokens: true, outputTokens: true, estimatedCost: true },
      }),
    ]);
    return { data, total, page, pageSize, summary: summary._sum };
  }

  private async enqueue(
    jobId: string,
    organizationId: string,
    type: 'scan' | 'export' | 'cleanup',
  ) {
    try {
      await enqueueTask(taskQueue(), { jobId, organizationId, type });
    } catch {
      await getDatabase().processingJob.updateMany({
        where: { id: jobId, organizationId, status: 'queued' },
        data: {
          status: 'failed',
          error: 'The processing queue is unavailable. Retry when the connection is restored.',
        },
      });
      throw new ServiceUnavailableException(
        'The job was saved, but the processing queue is unavailable. Retry it from scan history.',
      );
    }
  }
}
