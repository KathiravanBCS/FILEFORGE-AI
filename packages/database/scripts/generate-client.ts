/**
 * Generate the real Prisma client through Prisma's version-pinned WASM APIs.
 * The standard CLI initializes an unrelated native schema engine before generate,
 * which fails in restricted-egress cloud environments. This invokes the same
 * official in-process TypeScript generator without downloading a native engine.
 * Registry package integrity and TLS verification remain enabled.
 */
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// CommonJS entry points avoid an upstream named-export interop issue on Node 24.
const { getGenerators, loadSchemaContext } =
  require('@prisma/internals') as typeof import('@prisma/internals');
const { PrismaClientTsGenerator } =
  require('@prisma/client-generator-ts') as typeof import('@prisma/client-generator-ts');

const schemaPath = fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url));
const context = await loadSchemaContext({
  schemaPath: { cliProvidedPath: schemaPath },
  printLoadMessage: true,
});
const generators = await getGenerators({
  schemaContext: context,
  registry: { 'prisma-client': { type: 'in-process', generator: new PrismaClientTsGenerator() } },
  cliCommand: 'prisma',
  allowNoModels: false,
});
try {
  for (const generator of generators) await generator.generate();
  console.log(
    'Generated Prisma client using official Prisma WASM schema parser and TypeScript generator.',
  );
} finally {
  for (const generator of generators) generator.stop();
}
