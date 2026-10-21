import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({ email: false, handler: vi.fn(), getAuth: vi.fn() }));
vi.mock('../../packages/database/src/index.ts', () => ({
  authCapabilities: () => ({ email: boundary.email }),
  getAuth: () => {
    boundary.getAuth();
    return { handler: boundary.handler };
  },
}));
import { POST } from '../../apps/web/app/api/auth/[...all]/route.js';

const request = (path: string) =>
  new Request(`https://app.example.test/api/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'person@example.test' }),
  });

describe('authentication delivery prerequisites', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    boundary.email = false;
    boundary.handler.mockImplementation(async () => Response.json({ delegated: true }));
  });
  afterEach(() => vi.unstubAllEnvs());

  it('blocks direct production signup before account creation when email cannot be delivered', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const result = await POST(request('sign-up/email'));
    expect(result.status).toBe(503);
    expect(await result.json()).toMatchObject({
      message: expect.stringContaining('transactional email'),
    });
    expect(boundary.getAuth).not.toHaveBeenCalled();
  });

  it('permits development signup through the authoritative authentication handler', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const input = request('sign-up/email');
    const result = await POST(input);
    expect(result.status).toBe(200);
    expect(boundary.handler).toHaveBeenCalledWith(input);
  });

  it('delegates production signup when the required email delivery is configured', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    boundary.email = true;
    const input = request('sign-up/email');
    await POST(input);
    expect(boundary.handler).toHaveBeenCalledWith(input);
  });

  it.each(['request-password-reset', 'send-verification-email'])(
    'does not acknowledge unavailable email delivery for %s',
    async (path) => {
      vi.stubEnv('NODE_ENV', 'development');
      expect((await POST(request(path))).status).toBe(503);
      expect(boundary.handler).not.toHaveBeenCalled();
    },
  );
});
