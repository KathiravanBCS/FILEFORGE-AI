import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

async function checkRuntime(entrypoint) {
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
    console.log(
      'Compiled API smoke passed: health 200, anonymous workspace 401, CSRF 403, Swagger HTML/JSON/CSS 200.',
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
    // native Node with type stripping disabled rejects unbundled workspace TS.
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
    const code = await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          '--no-experimental-strip-types',
          fileURLToPath(import.meta.url),
          '--child',
          join(directory, 'main.mjs'),
        ],
        {
          cwd: directory,
          env: {
            PATH: process.env.PATH,
            SystemRoot: process.env.SystemRoot,
            NODE_ENV: 'production',
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
