import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeFileTrace } from '@vercel/nft';

const repository = fileURLToPath(new URL('../', import.meta.url));
const service = join(repository, 'apps/api');
const output = join(service, 'dist');
const runtimeModules = join(output, 'node_modules');
const workspacePackages = new Set(['shared', 'database', 'integrations']);

function inside(parent, filename) {
  const child = relative(parent, filename);
  return !isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`);
}

function bundledWorkspaceMetadata(filename, fixture) {
  for (const name of workspacePackages) {
    for (const root of [fixture, join(fixture, 'apps/api')]) {
      if (filename === join(root, 'node_modules/@fileforge', name)) return true;
    }
    if (filename === join(fixture, 'packages', name, 'package.json')) return true;
  }
  return (
    filename === join(fixture, 'package.json') ||
    filename === join(fixture, 'apps/api/package.json')
  );
}

// These features are not used by this HTTP-only API. Missing dependencies for
// any other feature fail the build instead of silently producing a broken zip.
const optionalDependencies = new Set([
  '@react-email/render', // Resend is used with text mail, not React templates.
  '@nestjs/microservices',
  '@nestjs/microservices/microservices-module.js',
  '@nestjs/websockets/socket-module.js',
  '@fastify/static', // The API uses the Express adapter.
  'class-validator', // Request bodies use Zod, not Nest ValidationPipe.
  'class-transformer',
  'class-transformer/storage',
  'class-transformer/cjs/storage',
]);

const entries = (await readdir(output)).filter((name) => name.endsWith('.mjs'));
assert(entries.includes('main.mjs'), 'Build the API before packaging its runtime');
await rm(runtimeModules, { recursive: true, force: true });
const fixture = await mkdtemp(join(tmpdir(), 'fileforge-api-runtime-'));
try {
  const fixtureService = join(fixture, 'apps/api');
  const fixtureOutput = join(fixtureService, 'dist');
  // Install the API's workspace dependency closure from the exact lockfile.
  // Only manifests and compiled code enter this staging directory; no .env,
  // provider credentials, source files, or lifecycle hooks are involved.
  const metadata = [
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'apps/api/package.json',
    ...[...workspacePackages].map((name) => `packages/${name}/package.json`),
  ];
  for (const filename of metadata) {
    const target = join(fixture, filename);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(repository, filename), target);
  }
  await mkdir(fixtureOutput, { recursive: true });
  for (const filename of entries) {
    await copyFile(join(output, filename), join(fixtureOutput, filename));
  }

  // Services traces every output entry as a file. Directory aliases from
  // pnpm's isolated layout cause NFT's EISDIR/missing-file failure there.
  // A frozen hoisted install supplies physical package directories while
  // preserving dependency versions and nested overrides selected by pnpm.
  await new Promise((accept, reject) => {
    const install = spawn(
      'pnpm',
      [
        'install',
        '--frozen-lockfile',
        '--prefer-offline',
        '--ignore-scripts',
        '--prod',
        '--node-linker=hoisted',
        '--reporter=append-only',
      ],
      { cwd: fixture, stdio: 'inherit', env: { ...process.env, CI: 'true' } },
    );
    install.once('error', reject);
    install.once('exit', (code) => {
      if (code === 0) accept();
      else reject(new Error(`Locked API runtime install failed with exit code ${code}`));
    });
  });

  function destination(filename) {
    for (const root of [join(fixtureService, 'node_modules'), join(fixture, 'node_modules')]) {
      if (inside(root, filename)) return join(runtimeModules, relative(root, filename));
    }
    if (inside(fixtureOutput, filename)) return join(output, relative(fixtureOutput, filename));
    throw new Error(
      `Unexpected runtime dependency outside node_modules: ${relative(fixture, filename)}`,
    );
  }

  const trace = await nodeFileTrace(
    entries.map((filename) => join(fixtureOutput, filename)),
    { base: fixture, processCwd: fixtureService, ts: false, mixedModules: true },
  );
  // Swagger computes its public directory at runtime. Include the assets
  // explicitly because NFT can only infer absolute-path.js itself.
  const serviceRequire = createRequire(join(fixtureService, 'package.json'));
  const swaggerRequire = createRequire(serviceRequire.resolve('@nestjs/swagger'));
  const swaggerAssets = dirname(swaggerRequire.resolve('swagger-ui-dist/absolute-path.js'));
  async function includeAssets(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filename = join(directory, entry.name);
      if (entry.isDirectory()) await includeAssets(filename);
      else trace.fileList.add(relative(fixture, filename));
    }
  }
  await includeAssets(swaggerAssets);

  const destinations = new Map();
  let bytes = 0;
  for (const filename of trace.fileList) {
    const source = resolve(fixture, filename);
    assert(inside(fixture, source), 'Runtime dependencies must stay inside the staging directory');
    if (bundledWorkspaceMetadata(source, fixture) || inside(fixtureOutput, source)) continue;
    const target = destination(source);
    const stat = await lstat(source);
    assert(stat.isFile(), 'Packaged runtime dependencies must be regular files without aliases');
    assert(inside(fixture, await realpath(source)), 'Runtime dependency source escaped staging');
    const existing = destinations.get(target);
    if (existing) {
      assert(
        (await readFile(existing)).equals(await readFile(source)),
        'Conflicting hoisted runtime dependency files',
      );
      continue;
    }
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
    destinations.set(target, source);
    bytes += stat.size;
  }

  let optionalWarnings = 0;
  let resolvedWarnings = 0;
  for (const warning of trace.warnings) {
    const dependency = warning.message.match(/^Failed to resolve dependency "([^"]+)"/)?.[1];
    const importer = warning.message.match(/ loaded from (.+)$/)?.[1];
    if (optionalDependencies.has(dependency)) {
      optionalWarnings += 1;
      continue;
    }
    assert(dependency && importer, 'Unexpected dependency tracer warning');
    const resolved = createRequire(destination(importer)).resolve(dependency);
    assert(inside(runtimeModules, await realpath(resolved)), 'Resolved dependency escaped runtime');
    resolvedWarnings += 1;
  }

  console.log(
    `API runtime packaged: ${destinations.size} regular dependency files, no aliases, ${(bytes / 1024 / 1024).toFixed(1)} MiB; ${optionalWarnings} optional and ${resolvedWarnings} resolved tracer warnings.`,
  );
} finally {
  await rm(fixture, { recursive: true, force: true });
}
