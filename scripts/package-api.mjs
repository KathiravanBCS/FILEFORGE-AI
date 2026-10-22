import assert from 'node:assert/strict';
import { copyFile, lstat, mkdir, readdir, realpath, rm, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
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

// Vercel Services mounts dist at the function root. Flatten both pnpm's real
// package tree and the service's package aliases into that same runtime root.
function destination(filename) {
  for (const root of [join(service, 'node_modules'), join(repository, 'node_modules')]) {
    if (inside(root, filename)) return join(runtimeModules, relative(root, filename));
  }
  if (inside(output, filename)) return filename;
  throw new Error(
    `Unexpected runtime dependency outside node_modules: ${relative(repository, filename)}`,
  );
}

function bundledWorkspaceMetadata(filename) {
  for (const name of workspacePackages) {
    if (filename === join(service, 'node_modules/@fileforge', name)) return true;
    if (filename === join(repository, 'packages', name, 'package.json')) return true;
  }
  return filename === join(service, 'package.json');
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

await rm(runtimeModules, { recursive: true, force: true });
const entries = (await readdir(output))
  .filter((name) => name.endsWith('.mjs'))
  .map((name) => join(output, name));
assert(entries.includes(join(output, 'main.mjs')), 'Build the API before packaging its runtime');
const trace = await nodeFileTrace(entries, {
  base: repository,
  processCwd: service,
  ts: false,
  mixedModules: true,
});

// Swagger obtains its public directory through a runtime function. NFT sees
// absolute-path.js but cannot infer the files Express serves from that folder.
const serviceRequire = createRequire(join(service, 'package.json'));
const swaggerRequire = createRequire(serviceRequire.resolve('@nestjs/swagger'));
const swaggerAssets = dirname(swaggerRequire.resolve('swagger-ui-dist/absolute-path.js'));
async function includeAssets(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = join(directory, entry.name);
    if (entry.isDirectory()) await includeAssets(filename);
    else trace.fileList.add(relative(repository, filename));
  }
}
await includeAssets(swaggerAssets);

const links = new Map();
let copied = 0;
let bytes = 0;
for (const filename of trace.fileList) {
  const source = resolve(repository, filename);
  assert(inside(repository, source), 'Runtime dependencies must stay inside the repository');
  if (bundledWorkspaceMetadata(source)) continue;
  const target = destination(source);
  if (target === source) continue;
  const stat = await lstat(source);
  if (stat.isSymbolicLink()) {
    const resolved = await realpath(source);
    const linkedTarget = destination(resolved);
    const existing = links.get(target);
    assert(!existing || existing === linkedTarget, 'Conflicting runtime package aliases');
    links.set(target, linkedTarget);
  } else {
    assert(stat.isFile(), 'Only dependency files and package aliases may be copied');
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
    copied += 1;
    bytes += stat.size;
  }
}

// Create aliases after copying files, so a host symlink can never redirect a
// write outside dist. Real targets, including pnpm peer packages, stay local.
for (const [alias, target] of links) {
  assert(inside(runtimeModules, target), 'Package aliases must stay inside the runtime');
  await lstat(target);
  await mkdir(dirname(alias), { recursive: true });
  await symlink(relative(dirname(alias), target), alias);
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
  // NFT can warn about Nest's .ts.js fallback even when its actual .js module
  // resolves. Require resolution must succeed in the packaged dependency tree.
  const resolved = createRequire(destination(importer)).resolve(dependency);
  assert(inside(runtimeModules, await realpath(resolved)), 'Resolved dependency escaped runtime');
  resolvedWarnings += 1;
}

console.log(
  `API runtime packaged: ${copied} dependency files, ${links.size} local aliases, ${(bytes / 1024 / 1024).toFixed(1)} MiB; ${optionalWarnings} optional and ${resolvedWarnings} resolved tracer warnings.`,
);
