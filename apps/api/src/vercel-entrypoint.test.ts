import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('..', import.meta.url));

// This matches @vercel/node's loader: listen is captured without invoking its
// callback, the entrypoint import must finish, and only then is the server bound.
const interception = `
import http from 'node:http';
const originalListen = http.Server.prototype.listen;
let server;
let captured;
const serverFound = new Promise(resolve => { captured = resolve; });
http.Server.prototype.listen = function () { server = this; captured(); return this; };
let timer;
try {
  await Promise.race([
    import('./src/main.ts'),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Entrypoint import waited on intercepted listen')), 5000); })
  ]);
  clearTimeout(timer);
  if (!server) await Promise.race([serverFound, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Entrypoint did not create a server')), 5000); })]);
  clearTimeout(timer);
  http.Server.prototype.listen = originalListen;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    originalListen.call(server, 0, '127.0.0.1', resolve);
  });
  const url = 'http://127.0.0.1:' + server.address().port;
  const health = await fetch(url + '/api/v1/health');
  const protectedResponse = await fetch(url + '/api/v1/contacts');
  console.log(JSON.stringify({ test: 'vercel-entrypoint-interception', health: health.status, protected: protectedResponse.status }));
  await new Promise(resolve => server.close(resolve));
  process.exit(health.status === 200 && protectedResponse.status === 401 ? 0 : 1);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
`;

it('imports under Vercel listen interception before serving real HTTP requests', async () => {
  const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-'], {
      cwd: directory,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        VERCEL: '1',
        PORT: '45678',
        API_PORT: '45679',
        NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
        BETTER_AUTH_URL: 'http://localhost:3000',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += String(chunk);
    });
    child.once('error', reject);
    child.once('exit', (code) => resolve({ code, output }));
    child.stdin.end(interception);
  });
  expect(result.output).toContain('vercel-entrypoint-interception');
  expect(result.output).toContain('"health":200,"protected":401');
  expect(result.code, result.output).toBe(0);
}, 15_000);

it('fails initialization with safe stage diagnostics instead of swallowing invalid production configuration', async () => {
  const privateValue = 'private-origin-value-must-not-be-logged';
  const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
      cwd: directory,
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'production',
        VERCEL: '1',
        PORT: '45678',
        BETTER_AUTH_URL: 'https://canonical.example.test',
        NEXT_PUBLIC_APP_URL: `https://canonical.example.test/${privateValue}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += String(chunk);
    });
    const timer = setTimeout(() => child.kill('SIGTERM'), 10_000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
  expect(result.code, result.output).toBe(1);
  expect(result.output).toContain('"event":"api_startup_failed"');
  expect(result.output).toContain('"stage":"origin"');
  expect(result.output).toContain('"invalidEnvironmentFields":["NEXT_PUBLIC_APP_URL"]');
  expect(result.output).toContain('API startup failed at origin');
  expect(result.output).not.toContain(privateValue);
}, 15_000);
