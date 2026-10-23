import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  findUser: vi.fn(),
  findAccounts: vi.fn(),
  createSession: vi.fn(),
  findSession: vi.fn(),
}));
// Exercise the real Better Auth handler, password hashing, Prisma adapter, cookie
// signatures and session validation. Only PostgreSQL delegates are replaced.
vi.mock('./client.js', () => ({
  getDatabase: () => ({
    user: { findFirst: database.findUser },
    account: { findMany: database.findAccounts },
    session: { create: database.createSession, findFirst: database.findSession },
  }),
}));

type FixtureSession = {
  id: string;
  token: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};
const fixtureUser = {
  id: 'signed-session-user',
  name: 'Session fixture',
  email: 'session-fixture@example.com',
  emailVerified: true,
  image: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};
let sessions: Map<string, FixtureSession>;
let passwordHash: string;
let fixtureIndex = 0;
let fixtureAddress: string;

async function instance() {
  const { getAuth } = await import('./auth.js');
  const auth = getAuth();
  await auth.$context;
  return auth;
}
async function issueCookie(origin = 'https://session.example.com', secure = true) {
  vi.stubEnv('NODE_ENV', secure ? 'production' : 'development');
  vi.stubEnv('BETTER_AUTH_URL', origin);
  vi.stubEnv('NEXT_PUBLIC_APP_URL', origin);
  const auth = await instance();
  const password = randomBytes(24).toString('base64url');
  passwordHash = await (await auth.$context).password.hash(password);
  const response = await auth.handler(
    new Request(`${origin}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
        'X-Forwarded-For': fixtureAddress,
      },
      body: JSON.stringify({ email: fixtureUser.email, password }),
    }),
  );
  expect(response.status).toBe(200);
  const prefix = secure ? '__Secure-better-auth.session_token=' : 'better-auth.session_token=';
  const setCookie = response.headers.getSetCookie().find((value) => value.startsWith(prefix));
  // Assert only booleans so a failed test cannot dump a signed session value.
  expect(Boolean(setCookie)).toBe(true);
  expect(/;\s*Secure(?:;|$)/i.test(setCookie!)).toBe(secure);
  const cookie = setCookie!.split(';')[0]!;
  const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
  expect(session?.user.id).toBe(fixtureUser.id);
  return cookie;
}

beforeEach(() => {
  vi.resetModules();
  sessions = new Map();
  passwordHash = '';
  fixtureAddress = `198.51.100.${++fixtureIndex}`;
  database.findAccounts.mockReset().mockImplementation(async () => [
    {
      id: 'credential-fixture',
      userId: fixtureUser.id,
      accountId: fixtureUser.id,
      providerId: 'credential',
      password: passwordHash,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]);
  database.findUser.mockReset().mockImplementation(async () => ({
    ...fixtureUser,
    accounts: [
      {
        id: 'credential-fixture',
        userId: fixtureUser.id,
        accountId: fixtureUser.id,
        providerId: 'credential',
        password: passwordHash,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  }));
  database.createSession
    .mockReset()
    .mockImplementation(async ({ data }: { data: FixtureSession }) => {
      sessions.set(data.token, { ...data });
      return { ...data };
    });
  database.findSession
    .mockReset()
    .mockImplementation(async ({ where }: { where: { token?: { equals?: string } } }) => {
      const row = where.token?.equals ? sessions.get(where.token.equals) : undefined;
      return row ? { ...row, user: { ...fixtureUser } } : null;
    });
  vi.stubEnv('BETTER_AUTH_SECRET', randomBytes(48).toString('base64url'));
  for (const name of [
    'VERCEL',
    'RESEND_API_KEY',
    'EMAIL_FROM',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'MICROSOFT_CLIENT_ID',
    'MICROSOFT_CLIENT_SECRET',
  ])
    vi.stubEnv(name, '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('shared signed-session cookies across web and API runtimes', () => {
  it.each([undefined, 'development'])(
    'validates a production web cookie when the HTTPS API NODE_ENV is %s',
    async (mode) => {
      const cookie = await issueCookie();
      vi.stubEnv('NODE_ENV', mode);
      vi.resetModules();
      const api = await instance();
      database.findSession.mockClear();
      const session = await api.api.getSession({ headers: new Headers({ cookie }) });
      expect(session?.user.id).toBe(fixtureUser.id);
      expect(database.findSession).toHaveBeenCalledTimes(1);
    },
  );
  it('rejects invalid signatures and revoked sessions instead of trusting the cookie name', async () => {
    const cookie = await issueCookie();
    database.findSession.mockClear();
    const auth = await instance();
    expect(
      await auth.api.getSession({ headers: new Headers({ cookie: `${cookie}invalid` }) }),
    ).toBeNull();
    expect(database.findSession).not.toHaveBeenCalled();
    sessions.clear();
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
    expect(database.findSession).toHaveBeenCalledTimes(1);
  });
  it('rejects a correctly named cookie signed with a different service secret', async () => {
    const cookie = await issueCookie();
    vi.stubEnv('BETTER_AUTH_SECRET', randomBytes(48).toString('base64url'));
    vi.resetModules();
    const api = await instance();
    database.findSession.mockClear();
    expect(await api.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
    expect(database.findSession).not.toHaveBeenCalled();
  });
  it('keeps signed HTTP localhost sessions working during development', async () => {
    const cookie = await issueCookie('http://localhost:3000', false);
    const auth = await instance();
    expect((await auth.api.getSession({ headers: new Headers({ cookie }) }))?.user.id).toBe(
      fixtureUser.id,
    );
  });
});
