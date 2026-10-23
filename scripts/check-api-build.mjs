import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { cp, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

async function checkRuntime(entrypoint) {
  // Exercise the real compiled Better Auth verifier against a database fixture.
  // No production database, session, password or provider credentials are used.
  const token = 'compiled-session-fixture';
  const now = new Date();
  const user = {
    id: 'compiled-user',
    name: 'Compiled check',
    email: 'compiled@example.test',
    emailVerified: true,
    image: null,
    createdAt: now,
    updatedAt: now,
  };
  let sessionReads = 0;
  globalThis.fileforgeDatabase = {
    session: {
      findFirst: async ({ where }) => {
        sessionReads++;
        return (where.token?.equals ?? where.token) === token
          ? {
              id: 'compiled-session',
              token,
              userId: user.id,
              user,
              createdAt: now,
              updatedAt: now,
              expiresAt: new Date(now.getTime() + 7 * 86400_000),
            }
          : null;
      },
    },
    user: { findFirst: async () => user },
    member: {
      findMany: async ({ where }) => {
        assert.equal(where.userId, user.id, 'Workspace reads must use the verified user');
        return [
          {
            role: 'owner',
            organization: {
              id: 'compiled-workspace',
              name: 'Compiled workspace',
              slug: 'compiled',
            },
          },
        ];
      },
    },
    userPreferences: {
      findUnique: async ({ where }) => {
        assert.equal(where.userId, user.id, 'Preference reads must use the verified user');
        return null;
      },
    },
  };
  const signedCookie = (value, secret = process.env.BETTER_AUTH_SECRET) => {
    const signature = createHmac('sha256', secret).update(value).digest('base64');
    return `__Secure-better-auth.session_token=${encodeURIComponent(`${value}.${signature}`)}`;
  };
  const originalListen = http.Server.prototype.listen;
  let server;
  let found;
  const serverFound = new Promise((resolve) => {
    found = resolve;
  });
  http.Server.prototype.listen = function () {
    found(this);
    return this;
  };
  let timer;
  try {
    await Promise.race([
      import(pathToFileURL(entrypoint).href),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('API import did not complete')), 10_000);
      }),
    ]);
    clearTimeout(timer);
    server = await Promise.race([
      serverFound,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('API did not create a server')), 10_000);
      }),
    ]);
    clearTimeout(timer);
    http.Server.prototype.listen = originalListen;
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      originalListen.call(server, 0, '127.0.0.1', resolve);
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const health = await fetch(`${base}/api/v1/health`, { signal: AbortSignal.timeout(5000) });
    assert.equal(health.status, 200, 'Compiled API health must return 200');
    const protectedResponse = await fetch(`${base}/api/v1/workspaces`, {
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(protectedResponse.status, 401, 'Anonymous workspace requests must return 401');
    for (const [cookie, status] of [
      [signedCookie(token), 200],
      [signedCookie(token, 'incorrect-signing-secret-for-this-fixture'), 401],
      [signedCookie('revoked-session-fixture'), 401],
    ]) {
      const response = await fetch(`${base}/api/v1/preferences`, {
        headers: { cookie },
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(
        response.status,
        status,
        'Compiled API must validate secure session signatures and stored sessions',
      );
      await response.arrayBuffer();
    }
    const authenticated = await fetch(`${base}/api/v1/workspaces`, {
      headers: { cookie: signedCookie(token) },
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(authenticated.status, 200, 'A verified HTTPS session must load its workspaces');
    assert.equal((await authenticated.json()).data[0]?.id, 'compiled-workspace');
    assert(sessionReads >= 3, 'Authentication must validate sessions against the database');
    const csrf = await fetch(`${base}/api/v1/workspaces`, {
      method: 'POST',
      headers: { Origin: 'https://untrusted.example.com' },
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(csrf.status, 403, 'Untrusted mutation origins must return 403');
    for (const [path, contentType] of [
      ['/api/docs', 'text/html'],
      ['/api/docs-json', 'application/json'],
      ['/api/docs/swagger-ui.css', 'text/css'],
    ]) {
      const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 200, `Packaged API ${path} must return 200`);
      assert(
        response.headers.get('content-type')?.startsWith(contentType),
        `Packaged API ${path} must serve ${contentType}`,
      );
      await response.arrayBuffer();
    }
    let throttled = false;
    for (let request = 0; request < 120; request++) {
      const response = await fetch(`${base}/api/v1/workspaces`, {
        signal: AbortSignal.timeout(5000),
      });
      await response.arrayBuffer();
      if (response.status === 429) {
        assert(
          Number(response.headers.get('retry-after')) > 0,
          'Rate limits must include a retry delay',
        );
        throttled = true;
        break;
      }
      assert.equal(response.status, 401, 'Anonymous requests must remain protected');
    }
    assert(throttled, 'The compiled rate limiter must reject excessive requests with 429');
    console.log(
      `Compiled API smoke passed (NODE_ENV=${process.env.NODE_ENV ?? 'unset'}): authenticated preferences/workspaces 200, invalid/revoked sessions 401, health 200, anonymous workspace 401, CSRF 403, rate limit 429, Swagger HTML/JSON/CSS 200.`,
    );
  } finally {
    clearTimeout(timer);
    http.Server.prototype.listen = originalListen;
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
  }
}

async function checkBuild() {
  const directory = await mkdtemp(join(tmpdir(), 'fileforge-api-build-'));
  try {
    // Vercel can place the handler outside the service package's ESM scope.
    // Explicit CommonJS scope here catches accidental .js ESM output, while
    // disabling require(esm) matches Vercel's stricter module loader, and
    // disabling type stripping rejects unbundled workspace TypeScript.
    await cp(new URL('../apps/api/dist/', import.meta.url), directory, {
      recursive: true,
      verbatimSymlinks: true,
    });
    async function checkFiles(folder) {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        const filename = join(folder, entry.name);
        assert(!entry.isSymbolicLink(), 'Vercel Services output must not contain symbolic links');
        if (entry.isDirectory()) await checkFiles(filename);
      }
    }
    await checkFiles(directory);
    await writeFile(join(directory, 'package.json'), '{"type":"commonjs"}\n');
    const authSecret = randomBytes(32).toString('hex');
    for (const nodeEnv of ['production', undefined]) {
      const code = await new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            '--no-experimental-strip-types',
            '--no-experimental-require-module',
            fileURLToPath(import.meta.url),
            '--child',
            join(directory, 'main.mjs'),
          ],
          {
            cwd: directory,
            env: {
              PATH: process.env.PATH,
              SystemRoot: process.env.SystemRoot,
              ...(nodeEnv ? { NODE_ENV: nodeEnv } : {}),
              BETTER_AUTH_SECRET: authSecret,
              VERCEL: '1',
              PORT: '45678',
              NEXT_PUBLIC_APP_URL: 'https://fileforge.example.com',
              BETTER_AUTH_URL: 'https://fileforge.example.com',
            },
            stdio: 'inherit',
            timeout: 30_000,
          },
        );
        child.once('error', reject);
        child.once('exit', resolve);
      });
      assert.equal(code, 0, 'Compiled API must start using native Node in an isolated package');
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

try {
  if (process.argv[2] === '--child') await checkRuntime(process.argv[3]);
  else await checkBuild();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
