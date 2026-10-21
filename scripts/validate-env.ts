import { validateServerEnvironment } from '../packages/shared/src/environment.js';
try {
  validateServerEnvironment(process.env);
  console.log(
    'Required runtime configuration is present and structurally valid. Connectivity is checked separately.',
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Invalid runtime configuration.');
  process.exitCode = 1;
}
