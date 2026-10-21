import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { AuthenticatedRequest } from '../common/context.js';
const mocks = vi.hoisted(() => ({ getSession: vi.fn(), findFirst: vi.fn() }));
vi.mock('@fileforge/database', () => ({
  getAuth: () => ({ api: { getSession: mocks.getSession } }),
  getDatabase: () => ({ member: { findFirst: mocks.findFirst } }),
}));
import { SessionGuard, WorkspaceGuard, assertManage, assertWrite } from './auth.js';
function context(request: Partial<AuthenticatedRequest>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}
describe('API authorization', () => {
  beforeEach(() => vi.clearAllMocks());
  it('rejects missing cookies without accepting a frontend user-id header', async () => {
    await expect(
      new SessionGuard().canActivate(context({ headers: { 'x-user-id': 'victim' } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(mocks.getSession).not.toHaveBeenCalled();
  });
  it('rejects expired or revoked sessions', async () => {
    mocks.getSession.mockResolvedValue(null);
    await expect(
      new SessionGuard().canActivate(context({ headers: { cookie: 'session=expired' } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('takes identity only from verified Better Auth session', async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: 'actual', email: 'actual@example.test' },
      session: { id: 'verified' },
    });
    const request = {
      headers: { cookie: 'session=verified', 'x-user-id': 'victim' },
    } as unknown as AuthenticatedRequest;
    await new SessionGuard().canActivate(context(request));
    expect(request.principal.userId).toBe('actual');
  });
  it('scopes membership lookup to authenticated user and requested tenant', async () => {
    mocks.findFirst.mockResolvedValue(null);
    const request = {
      headers: { 'x-workspace-id': 'other-tenant' },
      principal: { userId: 'member-of-first-tenant' },
    } as unknown as AuthenticatedRequest;
    await expect(new WorkspaceGuard().canActivate(context(request))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { organizationId: 'other-tenant', userId: 'member-of-first-tenant' },
    });
  });
  it('does not grant write or member administration to viewers', () => {
    const request = { workspace: { id: 'tenant', role: 'viewer' } } as AuthenticatedRequest;
    expect(() => assertWrite(request)).toThrow(ForbiddenException);
    expect(() => assertManage(request)).toThrow(ForbiddenException);
  });
  it('allows members to write but restricts administration', () => {
    const request = { workspace: { id: 'tenant', role: 'member' } } as AuthenticatedRequest;
    expect(() => assertWrite(request)).not.toThrow();
    expect(() => assertManage(request)).toThrow(ForbiddenException);
  });
});
