import { afterEach, describe, expect, it, vi } from 'vitest';
import { authCapabilities, requireAuthSecret } from './auth.js';
afterEach(() => vi.unstubAllEnvs());
describe('authentication configuration', () => {
  it('refuses an absent or weak session signing secret', () => {
    vi.stubEnv('BETTER_AUTH_SECRET', '');
    expect(() => requireAuthSecret()).toThrow('at least 32');
    vi.stubEnv('BETTER_AUTH_SECRET', 'weak');
    expect(() => requireAuthSecret()).toThrow();
    vi.stubEnv('BETTER_AUTH_SECRET', 'a'.repeat(64));
    expect(requireAuthSecret()).toHaveLength(64);
  });
  it('only enables providers with complete credentials', () => {
    for (const name of [
      'RESEND_API_KEY',
      'EMAIL_FROM',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'MICROSOFT_CLIENT_ID',
      'MICROSOFT_CLIENT_SECRET',
    ])
      vi.stubEnv(name, '');
    expect(authCapabilities()).toEqual({ email: false, google: false, microsoft: false });
    vi.stubEnv('RESEND_API_KEY', 'test-only');
    expect(authCapabilities().email).toBe(false);
    vi.stubEnv('EMAIL_FROM', 'test@example.com');
    expect(authCapabilities().email).toBe(true);
  });
});
