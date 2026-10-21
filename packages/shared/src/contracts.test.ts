import { describe, expect, it } from 'vitest';
import {
  assertPermission,
  assertTenant,
  can,
  contactSchema,
  extractedContactSchema,
  paginationSchema,
  preferencesSchema,
  scanSubmissionSchema,
} from './index.js';

describe('workspace authorization policies', () => {
  it('prevents cross-tenant resource access even for an owner', () => {
    expect(() => assertTenant('tenant-a', 'tenant-b')).toThrow('Resource not found');
    expect(() => assertTenant('', '')).toThrow();
    expect(() => assertTenant('tenant-a', 'tenant-a')).not.toThrow();
  });
  it('keeps viewers read-only and member management restricted', () => {
    expect(can('viewer', 'read')).toBe(true);
    expect(() => assertPermission('viewer', 'write')).toThrow();
    expect(can('member', 'write')).toBe(true);
    expect(can('member', 'members')).toBe(false);
    expect(can('owner', 'members')).toBe(true);
    expect(can('admin', 'manage')).toBe(true);
    expect(can('unknown', 'read')).toBe(false);
  });
});
describe('validated request and AI contracts', () => {
  it('represents missing extraction fields without fabrication', () => {
    expect(contactSchema.parse({})).toMatchObject({
      fullName: null,
      company: null,
      emails: [],
      phones: [],
      websites: [],
    });
  });
  it('requires an explicit structured shape from the AI provider', () => {
    expect(extractedContactSchema.safeParse({}).success).toBe(false);
    expect(extractedContactSchema.safeParse(contactSchema.parse({})).success).toBe(true);
  });
  it('rejects invalid emails, unexpected fields and enormous output', () => {
    expect(contactSchema.safeParse({ emails: [{ email: 'incorrect' }] }).success).toBe(false);
    expect(contactSchema.safeParse({ privileged: true }).success).toBe(false);
    expect(contactSchema.safeParse({ websites: ['javascript:alert(1)'] }).success).toBe(false);
    expect(contactSchema.safeParse({ socialLinks: [{ url: 'data:text/html,evil' }] }).success).toBe(
      false,
    );
    expect(contactSchema.safeParse({ fullName: 'x'.repeat(2001) }).success).toBe(false);
  });
  it('bounds pagination and prevents arbitrary sort input', () => {
    expect(paginationSchema.parse({ page: '2', pageSize: '25' })).toMatchObject({
      page: 2,
      pageSize: 25,
    });
    expect(paginationSchema.safeParse({ pageSize: 10000 }).success).toBe(false);
    expect(paginationSchema.safeParse({ sort: 'password' }).success).toBe(false);
  });
  it('validates a front/back scan and rejects arbitrary resource keys', () => {
    expect(scanSubmissionSchema.safeParse({ fileIds: ['../../private'] }).success).toBe(false);
    expect(scanSubmissionSchema.safeParse({ fileIds: [] }).success).toBe(false);
    expect(
      scanSubmissionSchema.safeParse({ fileIds: ['9c76bbe3-6236-4735-98d8-c0782d5b3705'] }).success,
    ).toBe(true);
  });
  it('constrains theme values and supplies deterministic defaults', () => {
    expect(preferencesSchema.parse({})).toMatchObject({
      colorScheme: 'auto',
      primaryColor: 'blue',
      density: 'comfortable',
    });
    expect(preferencesSchema.safeParse({ primaryColor: 'javascript:evil' }).success).toBe(false);
    expect(preferencesSchema.safeParse({ timeZone: 'Invalid/Zone' }).success).toBe(false);
  });
});
