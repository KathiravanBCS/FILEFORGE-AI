import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
const mocks = vi.hoisted(() => ({ session: vi.fn(), increment: vi.fn() }));
vi.mock('@fileforge/database', () => ({
  getDatabase: vi.fn(),
  getAuth: () => ({ api: { getSession: mocks.session } }),
}));
vi.mock('@fileforge/integrations', () => ({
  createTaskQueue: vi.fn(),
  enqueueTask: vi.fn(),
  objectKey: vi.fn(),
  validateImage: vi.fn(),
  MAX_IMAGE_BYTES: 20971520,
  R2Storage: { fromEnvironment: vi.fn() },
}));
import { VerifiedUserThrottlerGuard } from './throttle.js';
import { SessionGuard } from './auth.js';
import { HealthController } from '../modules/health.js';
import type { AuthenticatedRequest } from '../common/context.js';
class ProtectedController {}
function handler() {}
class ProbeGuard extends VerifiedUserThrottlerGuard {
  tracker(request: Request) {
    return this.getTracker(request as unknown as Record<string, unknown>);
  }
}
function context(request: Request, isPublic = false): ExecutionContext {
  return {
    getClass: () => (isPublic ? HealthController : ProtectedController),
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ header: vi.fn() }) }),
  } as unknown as ExecutionContext;
}
function request(cookie = 'session=verified', headers = {}): AuthenticatedRequest {
  return { ip: '192.0.2.1', headers: { cookie, ...headers } } as unknown as AuthenticatedRequest;
}
async function guard() {
  const value = new ProbeGuard(
    [{ ttl: 60_000, limit: 120 }],
    { increment: mocks.increment },
    new Reflector(),
  );
  await value.onModuleInit();
  return value;
}

describe('Verified-user limits behind the internal API proxy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.increment.mockResolvedValue({
      totalHits: 1,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
    mocks.session.mockResolvedValue({
      user: { id: 'verified-user', email: 'user@example.test' },
      session: { id: 'verified-session' },
    });
  });
  it('verifies a protected request once and reuses only the server-owned session result', async () => {
    const value = await guard();
    const req = request('session=verified', {
      'x-user-id': 'victim',
      'x-forwarded-for': '203.0.113.99',
    });
    await value.canActivate(context(req));
    await new SessionGuard().canActivate(context(req));
    expect(mocks.session).toHaveBeenCalledTimes(1);
    expect(await value.tracker(req)).toBe('user:verified-user');
    expect(req.principal.userId).toBe('verified-user');
  });
  it('keeps distinct authenticated users behind one proxy in separate quotas', async () => {
    const value = await guard();
    mocks.session
      .mockResolvedValueOnce({
        user: { id: 'first', email: 'one@example.test' },
        session: { id: 'one' },
      })
      .mockResolvedValueOnce({
        user: { id: 'second', email: 'two@example.test' },
        session: { id: 'two' },
      })
      .mockResolvedValueOnce({
        user: { id: 'first', email: 'one@example.test' },
        session: { id: 'three' },
      });
    await value.canActivate(context(request('session=one')));
    await value.canActivate(context(request('session=two')));
    await value.canActivate(
      context(
        request('session=three', { 'x-user-id': 'forged', 'x-forwarded-for': '203.0.113.99' }),
      ),
    );
    const keys = mocks.increment.mock.calls.map((call) => call[0]);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[0]).toBe(keys[2]);
  });
  it('does not let malformed cookies or forwarded identity headers select an anonymous tracker', async () => {
    const value = await guard();
    mocks.session.mockResolvedValue(null);
    const first = request('session=made-up-one', {
      'x-user-id': 'one',
      'x-forwarded-for': '203.0.113.1',
    });
    const second = request('session=made-up-two', {
      'x-user-id': 'two',
      'x-forwarded-for': '203.0.113.2',
    });
    first.principal = { userId: 'injected', email: 'fake@example.test', sessionId: 'fake' };
    await value.canActivate(context(first));
    await value.canActivate(context(second));
    expect(await value.tracker(first)).toBe('ip:192.0.2.1');
    expect(await value.tracker(second)).toBe('ip:192.0.2.1');
    expect(mocks.increment.mock.calls[0]?.[0]).toBe(mocks.increment.mock.calls[1]?.[0]);
    await expect(new SessionGuard().canActivate(context(first))).rejects.toThrow(
      'missing or has expired',
    );
    expect(mocks.session).toHaveBeenCalledTimes(2);
  });
  it('does not consult authentication storage for public health/capability requests', async () => {
    const value = await guard();
    const req = request();
    await value.canActivate(context(req, true));
    expect(mocks.session).not.toHaveBeenCalled();
    expect(await value.tracker(req)).toBe('ip:192.0.2.1');
  });
  it('caches provider failures without treating an unverified session as authenticated', async () => {
    const value = await guard();
    const req = request();
    mocks.session.mockRejectedValueOnce(new Error('database unavailable'));
    await value.canActivate(context(req));
    expect(await value.tracker(req)).toBe('ip:192.0.2.1');
    await expect(new SessionGuard().canActivate(context(req))).rejects.toThrow(
      'temporarily unavailable',
    );
    expect(mocks.session).toHaveBeenCalledTimes(1);
  });
});
