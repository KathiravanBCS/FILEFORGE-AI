import { randomBytes } from 'node:crypto';
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'dotenv';

// Generate only the development session-signing secret, never provider credentials.
const path = resolve(process.cwd(), '.env');
let contents = '';
try {
  contents = await readFile(path, 'utf8');
} catch (error) {
  if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
    throw error;
}
const configured = Boolean(parse(contents).BETTER_AUTH_SECRET);
if (!process.env.BETTER_AUTH_SECRET && !configured) {
  const line = `BETTER_AUTH_SECRET=${randomBytes(48).toString('base64url')}`;
  contents = /^BETTER_AUTH_SECRET[ \t]*=/m.test(contents)
    ? contents.replace(/^BETTER_AUTH_SECRET[ \t]*=.*$/m, line)
    : contents + `\n${line}\n`;
  await writeFile(path, contents, { mode: 0o600 });
  await chmod(path, 0o600);
  console.log('Generated a private local development session secret in ignored .env.');
} else console.log('Existing session secret preserved.');
