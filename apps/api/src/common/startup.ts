import { z } from 'zod';
import { applicationOriginsSchema } from '@fileforge/shared';
import { apiRuntime } from './runtime.js';

export const startupStages = [
  'runtime',
  'origin',
  'application',
  'documentation',
  'listen',
] as const;
export type StartupStage = (typeof startupStages)[number];
const stageSchema = z.enum(startupStages);
const environmentFieldSchema = z.enum([
  'PORT',
  'API_PORT',
  'NODE_ENV',
  'BETTER_AUTH_URL',
  'NEXT_PUBLIC_APP_URL',
  'VERCEL',
  'VERCEL_ENV',
  'VERCEL_URL',
  'VERCEL_PROJECT_PRODUCTION_URL',
]);
type EnvironmentField = z.infer<typeof environmentFieldSchema>;

// Error names and codes are data too: arbitrary custom values can contain secrets.
const errorTypes = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'ZodError',
  'UnknownDependenciesException',
  'UndefinedDependencyException',
]);
const errorCodes = new Set([
  'EACCES',
  'EADDRINUSE',
  'EADDRNOTAVAIL',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOENT',
  'ETIMEDOUT',
  'MODULE_NOT_FOUND',
  'ERR_MODULE_NOT_FOUND',
  'ERR_UNKNOWN_FILE_EXTENSION',
  'ERR_PACKAGE_PATH_NOT_EXPORTED',
  'ERR_REQUIRE_ESM',
  'ERR_REQUIRE_ASYNC_MODULE',
  'ERR_INVALID_PACKAGE_CONFIG',
  'ERR_SOCKET_BAD_PORT',
  'ERR_SERVER_ALREADY_LISTEN',
  'ERR_SERVER_NOT_RUNNING',
]);

export interface StartupFailureDiagnostic {
  event: 'api_startup_failed';
  stage: StartupStage;
  errorType: string;
  code?: string;
  invalidEnvironmentFields?: EnvironmentField[];
}

function safeProperty(error: unknown, property: 'name' | 'code'): unknown {
  try {
    return error && typeof error === 'object' ? Reflect.get(error, property) : undefined;
  } catch {
    // Custom exceptions/proxies must not prevent safe startup failure reporting.
    return undefined;
  }
}

function invalidEnvironmentFields(
  stage: StartupStage,
  environment: Record<string, string | undefined>,
): EnvironmentField[] {
  if (stage === 'runtime') {
    try {
      apiRuntime(environment);
    } catch {
      // Diagnose only the selected variable, matching the runtime's precedence.
      if (environment.PORT !== undefined) return ['PORT'];
      if (environment.API_PORT !== undefined) return ['API_PORT'];
    }
  }
  if (stage === 'origin') {
    const result = applicationOriginsSchema.safeParse(environment);
    if (!result.success) {
      const fields = result.error.issues.flatMap((issue) => {
        const field = environmentFieldSchema.safeParse(issue.path[0]);
        return field.success ? [field.data] : [];
      });
      return [...new Set(fields)].sort();
    }
  }
  return [];
}

/** Pure, value-free diagnostics. The caller owns logging and failure propagation. */
export function startupFailureDiagnostic(
  stage: StartupStage,
  error: unknown,
  environment: Record<string, string | undefined>,
): StartupFailureDiagnostic {
  const parsedStage = stageSchema.safeParse(stage);
  const safeStage = parsedStage.success ? parsedStage.data : 'application';
  const name = safeProperty(error, 'name');
  const code = safeProperty(error, 'code');
  const fields = invalidEnvironmentFields(safeStage, environment);
  return {
    event: 'api_startup_failed',
    stage: safeStage,
    errorType: typeof name === 'string' && errorTypes.has(name) ? name : 'UnknownError',
    ...(typeof code === 'string' && errorCodes.has(code) ? { code } : {}),
    ...(fields.length ? { invalidEnvironmentFields: fields } : {}),
  };
}
