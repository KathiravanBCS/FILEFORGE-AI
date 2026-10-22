import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ send: vi.fn(), findUser: vi.fn() }));
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: mocks.send };
  },
}));
vi.mock('./client.js', () => ({
  getDatabase: () => ({ user: { findFirst: mocks.findUser } }),
}));

const origin = 'https://auth.example.com';
const recipient = 'private-recipient@example.com';
const sender = 'private-sender@example.com';
const privateToken = 'private-verification-token';
const verificationUrl = `${origin}/api/auth/verify-email?token=${privateToken}`;
let errorLog: ReturnType<typeof vi.spyOn>;

function user(emailVerified = false) {
  return {
    id: 'existing-user',
    name: 'Private user',
    email: recipient,
    emailVerified,
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
async function authInstance() {
  const { getAuth } = await import('./auth.js');
  const auth = getAuth();
  await auth.$context;
  return auth;
}
function request(path: string, body: Record<string, string>) {
  return new Request(`${origin}/api/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(body),
  });
}
function expectSanitizedLog(providerStatus?: number) {
  expect(errorLog).toHaveBeenCalledTimes(1);
  const entry = JSON.parse(String(errorLog.mock.calls[0]?.[0]));
  expect(entry).toEqual({
    event: 'transactional_email_failed',
    provider: 'resend',
    ...(providerStatus !== undefined ? { providerStatus } : {}),
  });
  const serialized = JSON.stringify(errorLog.mock.calls);
  for (const privateValue of [
    recipient,
    sender,
    privateToken,
    verificationUrl,
    'private-provider-error',
  ]) {
    expect(serialized).not.toContain(privateValue);
  }
}

beforeEach(() => {
  vi.resetModules();
  mocks.send.mockReset();
  mocks.findUser.mockReset();
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('BETTER_AUTH_SECRET', randomBytes(48).toString('base64url'));
  vi.stubEnv('BETTER_AUTH_URL', origin);
  vi.stubEnv('NEXT_PUBLIC_APP_URL', origin);
  vi.stubEnv('RESEND_API_KEY', randomBytes(32).toString('hex'));
  vi.stubEnv('EMAIL_FROM', sender);
  for (const name of [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'MICROSOFT_CLIENT_ID',
    'MICROSOFT_CLIENT_SECRET',
  ])
    vi.stubEnv(name, '');
  mocks.findUser.mockResolvedValue(user());
  mocks.send.mockResolvedValue({
    data: { id: 'mock-provider-message-id' },
    error: null,
    headers: null,
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('transactional email provider failures', () => {
  it.each([403, 429])(
    'rejects provider status %s and logs only its numeric status',
    async (statusCode) => {
      mocks.send.mockResolvedValue({
        data: null,
        error: {
          name: 'validation_error',
          statusCode,
          message: `private-provider-error ${recipient} ${verificationUrl}`,
        },
        headers: null,
      });
      const auth = await authInstance();
      await expect(
        auth.options.emailVerification.sendVerificationEmail!({
          user: { email: recipient },
          url: verificationUrl,
        }),
      ).rejects.toMatchObject({ statusCode: 503 });
      expectSanitizedLog(statusCode);
    },
  );
  it('turns transport rejection into a safe service-unavailable error', async () => {
    mocks.send.mockRejectedValue(
      new Error(`private-provider-error ${sender} ${recipient} ${verificationUrl}`),
    );
    const auth = await authInstance();
    await expect(
      auth.options.emailVerification.sendVerificationEmail!({
        user: { email: recipient },
        url: verificationUrl,
      }),
    ).rejects.toMatchObject({
      statusCode: 503,
      body: { message: 'The email provider is unavailable. Please try again later.' },
    });
    expectSanitizedLog();
  });
  it('does not serialize a malformed provider status into logs', async () => {
    mocks.send.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', statusCode: 999, message: 'private-provider-error' },
      headers: null,
    });
    const auth = await authInstance();
    await expect(
      auth.options.emailVerification.sendVerificationEmail!({
        user: { email: recipient },
        url: verificationUrl,
      }),
    ).rejects.toMatchObject({ statusCode: 503 });
    expectSanitizedLog();
  });
  it('accepts a successful provider response without claiming inbox delivery or logging recipient data', async () => {
    const auth = await authInstance();
    await expect(
      auth.options.emailVerification.sendVerificationEmail!({
        user: { email: recipient },
        url: verificationUrl,
      }),
    ).resolves.toBeUndefined();
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(errorLog).not.toHaveBeenCalled();
  });
});

describe('Better Auth verification resend behavior with mocked providers', () => {
  it('propagates a provider rejection through the explicit verification endpoint', async () => {
    mocks.send.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', statusCode: 403, message: 'private-provider-error' },
      headers: null,
    });
    const auth = await authInstance();
    const response = await auth.handler(
      request('send-verification-email', { email: recipient, callbackURL: `${origin}/login` }),
    );
    expect(response.status).toBe(503);
    const result = await response.json();
    expect(result).toMatchObject({
      message: expect.stringContaining('The email provider rejected this message.'),
    });
    expect(JSON.stringify(result)).not.toContain('private-provider-error');
    expectSanitizedLog(403);
  });
  it.each(['unknown', 'already verified'])(
    'preserves a generic no-send response for an %s address',
    async (state) => {
      mocks.findUser.mockResolvedValue(state === 'unknown' ? null : user(true));
      const auth = await authInstance();
      const response = await auth.handler(request('send-verification-email', { email: recipient }));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: true });
      expect(mocks.send).not.toHaveBeenCalled();
      expect(errorLog).not.toHaveBeenCalled();
    },
  );
  it('keeps duplicate signup enumeration-safe and does not silently resend email', async () => {
    const auth = await authInstance();
    const response = await auth.handler(
      request('sign-up/email', {
        name: 'Registration probe',
        email: recipient,
        password: randomBytes(24).toString('base64url'),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ token: null });
    expect(mocks.findUser).toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
