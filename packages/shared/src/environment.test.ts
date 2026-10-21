import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { resolveApplicationOrigins, validateServerEnvironment } from './environment.js';

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
        NEXT_PUBLIC_APP_URL: 'https://app.example.com',
      }).NODE_ENV,
    ).toBe('production');
  });
});

describe('canonical deployment origins', () => {
  it('defaults local development without requiring cloud API browser routing', () => {
    expect(resolveApplicationOrigins({})).toEqual({
      authUrl: 'http://localhost:3000',
      appUrl: 'http://localhost:3000',
      origin: 'http://localhost:3000',
    });
    const environment = validateServerEnvironment({
      ...fixture(),
      NEXT_PUBLIC_API_URL: 'obsolete-untrusted-value',
    });
    expect(environment).not.toHaveProperty('NEXT_PUBLIC_API_URL');
  });
  it('requires both explicit canonical HTTPS origins in production and previews', () => {
    expect(() =>
      resolveApplicationOrigins({
        NODE_ENV: 'production',
        VERCEL_URL: 'preview.example.com',
        HOST: 'preview.example.com',
      }),
    ).toThrow('BETTER_AUTH_URL');
    expect(() =>
      resolveApplicationOrigins({
        NODE_ENV: 'production',
        BETTER_AUTH_URL: 'https://app.example.com',
      }),
    ).toThrow('NEXT_PUBLIC_APP_URL');
    expect(() =>
      resolveApplicationOrigins({
        NODE_ENV: 'production',
        NEXT_PUBLIC_APP_URL: 'https://app.example.com',
      }),
    ).toThrow('BETTER_AUTH_URL');
    expect(() =>
      resolveApplicationOrigins({
        NODE_ENV: 'production',
        BETTER_AUTH_URL: '',
        NEXT_PUBLIC_APP_URL: '',
      }),
    ).toThrow('BETTER_AUTH_URL');
  });
  it('normalizes equivalent canonical origins and does not trust arbitrary incoming hosts', () => {
    expect(
      resolveApplicationOrigins({
        NODE_ENV: 'production',
        BETTER_AUTH_URL: 'https://APP.example.com:443/',
        NEXT_PUBLIC_APP_URL: 'https://app.example.com',
        HOST: 'attacker.example.com',
      }),
    ).toEqual({
      authUrl: 'https://app.example.com',
      appUrl: 'https://app.example.com',
      origin: 'https://app.example.com',
    });
  });
  it('rejects disagreement between the web and auth origins', () => {
    expect(() =>
      resolveApplicationOrigins({
        BETTER_AUTH_URL: 'https://app.example.com',
        NEXT_PUBLIC_APP_URL: 'https://other.example.com',
      }),
    ).toThrow('NEXT_PUBLIC_APP_URL');
    expect(() =>
      validateServerEnvironment({
        ...fixture(),
        BETTER_AUTH_URL: 'https://app.example.com',
        NEXT_PUBLIC_APP_URL: 'https://other.example.com',
      }),
    ).toThrow('NEXT_PUBLIC_APP_URL');
  });
  it.each([
    'https://*.vercel.app',
    'https://app.example.com/api/auth',
    'https://app.example.com?redirect=example',
    'https://app.example.com/#fragment',
    'https://credential:secret@app.example.com',
    'javascript:alert(1)',
    'file:///tmp/app',
  ])('rejects an unsafe canonical URL without exposing its input', (value) => {
    expect(() => resolveApplicationOrigins({ BETTER_AUTH_URL: value })).toThrow('BETTER_AUTH_URL');
    try {
      resolveApplicationOrigins({ BETTER_AUTH_URL: value });
    } catch (error) {
      expect(String(error)).not.toContain(value);
    }
  });
});
