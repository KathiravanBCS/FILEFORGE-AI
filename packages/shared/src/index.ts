import { z } from 'zod';

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_SCAN_IMAGES = 2;
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const roleSchema = z.enum(['owner', 'admin', 'member', 'viewer']);
export type WorkspaceRole = z.infer<typeof roleSchema>;
export type Permission = 'read' | 'write' | 'manage' | 'members';
export const can = (role: string, permission: Permission): boolean => {
  if (!roleSchema.safeParse(role).success) return false;
  if (permission === 'read') return true;
  if (permission === 'write') return role !== 'viewer';
  return role === 'owner' || role === 'admin';
};
export class AuthorizationError extends Error {
  readonly status = 403;
  constructor(message = 'You do not have permission to perform this action.') {
    super(message);
    this.name = 'AuthorizationError';
  }
}
export function assertPermission(role: string, permission: Permission): void {
  if (!can(role, permission)) throw new AuthorizationError();
}
export function assertTenant(expectedOrganizationId: string, actualOrganizationId: string): void {
  if (!expectedOrganizationId || expectedOrganizationId !== actualOrganizationId)
    throw new AuthorizationError('Resource not found in this workspace.');
}

const httpUrl = z.url({ protocol: /^https?$/ }).max(2048);
const optionalText = z.string().max(2000).nullable().default(null);
export const contactSchema = z
  .object({
    fullName: optionalText,
    firstName: optionalText,
    lastName: optionalText,
    jobTitle: optionalText,
    company: optionalText,
    department: optionalText,
    address: optionalText,
    city: optionalText,
    state: optionalText,
    country: optionalText,
    postalCode: optionalText,
    notes: z.string().max(10000).nullable().default(null),
    emails: z
      .array(
        z.object({ email: z.email().max(320), label: z.string().max(80).nullable().default(null) }),
      )
      .max(20)
      .default([]),
    phones: z
      .array(
        z.object({
          number: z.string().min(1).max(80),
          label: z.string().max(80).nullable().default(null),
        }),
      )
      .max(20)
      .default([]),
    websites: z.array(httpUrl).max(20).default([]),
    socialLinks: z
      .array(z.object({ url: httpUrl, label: z.string().max(80).nullable().default(null) }))
      .max(20)
      .default([]),
  })
  .strict();
/** Provider output must include every field, using null/[] for missing data. */
export const extractedContactSchema = contactSchema
  .extend({
    fullName: contactSchema.shape.fullName.removeDefault(),
    firstName: contactSchema.shape.firstName.removeDefault(),
    lastName: contactSchema.shape.lastName.removeDefault(),
    jobTitle: contactSchema.shape.jobTitle.removeDefault(),
    company: contactSchema.shape.company.removeDefault(),
    department: contactSchema.shape.department.removeDefault(),
    address: contactSchema.shape.address.removeDefault(),
    city: contactSchema.shape.city.removeDefault(),
    state: contactSchema.shape.state.removeDefault(),
    country: contactSchema.shape.country.removeDefault(),
    postalCode: contactSchema.shape.postalCode.removeDefault(),
    notes: contactSchema.shape.notes.removeDefault(),
    emails: z
      .array(z.object({ email: z.email().max(320), label: z.string().max(80).nullable() }).strict())
      .max(20),
    phones: z
      .array(
        z
          .object({ number: z.string().min(1).max(80), label: z.string().max(80).nullable() })
          .strict(),
      )
      .max(20),
    websites: contactSchema.shape.websites.removeDefault(),
    socialLinks: z
      .array(z.object({ url: httpUrl, label: z.string().max(80).nullable() }).strict())
      .max(20),
  })
  .strict();
export type ExtractedContactData = z.infer<typeof extractedContactSchema>;
export const contactInputSchema = contactSchema;
export type ContactData = z.infer<typeof contactSchema>;
export const contactStatusSchema = z.enum(['draft', 'approved']);
export const jobStatusSchema = z.enum([
  'queued',
  'processing',
  'review',
  'completed',
  'failed',
  'cancelled',
]);
export type JobStatus = z.infer<typeof jobStatusSchema>;
export const accentColors = [
  'blue',
  'cyan',
  'teal',
  'green',
  'violet',
  'grape',
  'orange',
  'pink',
  'red',
] as const;
export const preferencesSchema = z
  .object({
    colorScheme: z.enum(['light', 'dark', 'auto']).default('auto'),
    primaryColor: z.enum(accentColors).default('blue'),
    density: z.enum(['comfortable', 'compact']).default('comfortable'),
    radius: z.enum(['sm', 'md', 'lg']).default('md'),
    reducedMotion: z.boolean().default(false),
    language: z.string().min(2).max(20).default('en'),
    timeZone: z
      .string()
      .min(1)
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, 'Use a valid IANA time zone.')
      .default('UTC'),
    tablePreferences: z.record(z.string(), z.unknown()).default({}),
    dashboardPreferences: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export type UserPreferencesData = z.infer<typeof preferencesSchema>;
export const defaultPreferences: UserPreferencesData = preferencesSchema.parse({});
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).default(''),
  sort: z.enum(['fullName', 'company', 'jobTitle', 'createdAt', 'status']).default('createdAt'),
  direction: z.enum(['asc', 'desc']).default('desc'),
  status: contactStatusSchema.optional(),
  company: z.string().trim().max(200).optional(),
  jobTitle: z.string().trim().max(200).optional(),
});
export const scanSubmissionSchema = z
  .object({ fileIds: z.array(z.uuid()).min(1).max(MAX_SCAN_IMAGES) })
  .strict();
export const bulkIdsSchema = z.object({ ids: z.array(z.uuid()).min(1).max(100) }).strict();
export const exportRequestSchema = z
  .object({
    ids: z.array(z.uuid()).min(1).max(1000).optional(),
    search: z.string().max(200).optional(),
    company: z.string().trim().max(200).optional(),
    jobTitle: z.string().trim().max(200).optional(),
    status: contactStatusSchema.optional(),
  })
  .strict();
export const workspaceSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    slug: z
      .string()
      .min(2)
      .max(100)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  })
  .strict();
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export * from './environment.js';
