import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { validateServerEnvironment } from './environment.js';

function fixture() {
  return {
    DATABASE_URL: 'postgresql://test.neon.tech/neondb?sslmode=verify-full',
    BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
    S3_ENDPOINT: 'https://test.r2.cloudflarestorage.com',
    S3_ACCESS_KEY_ID: randomBytes(16).toString('hex'),
    S3_SECRET_ACCESS_KEY: randomBytes(32).toString('hex'),
    REDIS_URL: 'rediss://test.upstash.io:6379',
    GROQ_API_KEY: randomBytes(32).toString('hex'),
  };
}
describe('runtime configuration security', () => {
  it('reports field names without disclosing rejected credential input', () => {
    const input = fixture();
    const malformed = randomBytes(20).toString('hex');
    expect(() => validateServerEnvironment({ ...input, DATABASE_URL: malformed })).toThrow(
      'DATABASE_URL',
    );
    try {
      validateServerEnvironment({ ...input, DATABASE_URL: malformed });
    } catch (error) {
      expect(String(error)).not.toContain(malformed);
      expect(String(error)).not.toContain(input.BETTER_AUTH_SECRET);
    }
  });
  it('rejects infrastructure substitutions and plaintext database connections', () => {
    expect(() =>
      validateServerEnvironment({ ...fixture(), DATABASE_URL: 'postgresql://localhost/db' }),
    ).toThrow();
    expect(() =>
      validateServerEnvironment({ ...fixture(), REDIS_URL: 'https://test.upstash.io' }),
    ).toThrow();
    expect(() =>
      validateServerEnvironment({
        ...fixture(),
        S3_ENDPOINT: 'http://test.r2.cloudflarestorage.com',
      }),
    ).toThrow();
  });
  it('rejects half-configured email and OAuth instead of advertising unavailable flows', () => {
    expect(() =>
      validateServerEnvironment({ ...fixture(), EMAIL_FROM: 'team@example.com' }),
    ).toThrow('RESEND_API_KEY');
    expect(() =>
      validateServerEnvironment({ ...fixture(), GOOGLE_CLIENT_ID: 'test-client' }),
    ).toThrow('GOOGLE_CLIENT_ID');
  });
  it('requires HTTPS authentication in production', () => {
    expect(() => validateServerEnvironment({ ...fixture(), NODE_ENV: 'production' })).toThrow(
      'BETTER_AUTH_URL',
    );
    expect(
      validateServerEnvironment({
        ...fixture(),
        NODE_ENV: 'production',
        BETTER_AUTH_URL: 'https://app.example.com',
      }).NODE_ENV,
    ).toBe('production');
  });
});
