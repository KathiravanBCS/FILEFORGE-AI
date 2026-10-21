import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
// These configuration tests must not open real database/provider connections.
vi.mock('./client.js', () => ({ getDatabase: vi.fn(() => ({})) }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('Better Auth canonical origin initialization', () => {
  it('keeps module import lazy when deployment configuration is not yet available', async () => {
    vi.stubEnv('BETTER_AUTH_SECRET', '');
    vi.stubEnv('BETTER_AUTH_URL', '');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    const auth = await import('./auth.js');
    expect(auth.getAuth).toBeTypeOf('function');
    expect(() => auth.getAuth()).toThrow('BETTER_AUTH_SECRET');
  });
  it('fails closed when production origin configuration is missing', async () => {
    vi.stubEnv('BETTER_AUTH_SECRET', randomBytes(48).toString('base64url'));
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('BETTER_AUTH_URL', '');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    const auth = await import('./auth.js');
    expect(() => auth.getAuth()).toThrow('Invalid application origin configuration');
  });
  it('rejects mismatched canonical origins before initializing the auth adapter', async () => {
    vi.stubEnv('BETTER_AUTH_SECRET', randomBytes(48).toString('base64url'));
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('BETTER_AUTH_URL', 'https://app.example.com');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://preview.example.com');
    const auth = await import('./auth.js');
    expect(() => auth.getAuth()).toThrow('NEXT_PUBLIC_APP_URL');
  });
});
