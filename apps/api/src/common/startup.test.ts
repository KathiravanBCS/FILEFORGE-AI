import { describe, expect, it } from 'vitest';
import { startupFailureDiagnostic, type StartupStage } from './startup.js';
import { apiRuntime } from './runtime.js';

describe('safe API startup diagnostics', () => {
  it('identifies missing production origins without exposing any environment values', () => {
    const environment = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://private-user:private-password@private-db.example/db',
      BETTER_AUTH_SECRET: 'private-signing-key-must-not-be-logged',
      COOKIE: 'private-session-cookie',
    };
    const diagnostic = startupFailureDiagnostic(
      'origin',
      new Error('private raw error'),
      environment,
    );
    expect(diagnostic).toEqual({
      event: 'api_startup_failed',
      stage: 'origin',
      errorType: 'Error',
      invalidEnvironmentFields: ['BETTER_AUTH_URL', 'NEXT_PUBLIC_APP_URL'],
    });
    expect(JSON.stringify(diagnostic)).not.toMatch(/private-|postgresql|raw error/);
  });

  it('identifies only the missing half of a canonical origin pair', () => {
    expect(
      startupFailureDiagnostic('origin', new Error(), {
        NODE_ENV: 'production',
        BETTER_AUTH_URL: 'https://app.example.test',
      }).invalidEnvironmentFields,
    ).toEqual(['NEXT_PUBLIC_APP_URL']);
  });

  it('does not confuse a module load failure with unrelated environment configuration', () => {
    const error = Object.assign(new Error('Cannot load private/internal/location'), {
      code: 'ERR_MODULE_NOT_FOUND',
      cause: new Error('postgresql://user:private-password@private-host/db'),
    });
    const diagnostic = startupFailureDiagnostic('application', error, { NODE_ENV: 'production' });
    expect(diagnostic).toEqual({
      event: 'api_startup_failed',
      stage: 'application',
      errorType: 'Error',
      code: 'ERR_MODULE_NOT_FOUND',
    });
    expect(JSON.stringify(diagnostic)).not.toMatch(/private|postgresql|cause|stack|message/);
  });

  it('reports selected invalid PORT with the actual runtime parser and preserves PORT precedence', () => {
    const environment = { PORT: 'private-invalid-port', API_PORT: '4000' };
    let failure: unknown;
    try {
      apiRuntime(environment);
    } catch (error) {
      failure = error;
    }
    expect(startupFailureDiagnostic('runtime', failure, environment)).toEqual({
      event: 'api_startup_failed',
      stage: 'runtime',
      errorType: 'ZodError',
      invalidEnvironmentFields: ['PORT'],
    });
    expect(
      startupFailureDiagnostic('runtime', new Error(), { API_PORT: 'invalid' })
        .invalidEnvironmentFields,
    ).toEqual(['API_PORT']);
    expect(
      startupFailureDiagnostic('runtime', new Error(), { PORT: '4000', API_PORT: 'invalid' }),
    ).not.toHaveProperty('invalidEnvironmentFields');
  });

  it('records known transport codes without connection addresses, messages, or stacks', () => {
    const error = Object.assign(new Error('connect ECONNREFUSED private-host:443'), {
      code: 'ECONNREFUSED',
      address: 'private-host',
      stack: 'private stack details',
    });
    expect(startupFailureDiagnostic('listen', error, {})).toEqual({
      event: 'api_startup_failed',
      stage: 'listen',
      errorType: 'Error',
      code: 'ECONNREFUSED',
    });
  });

  it('does not serialize arbitrary exception names, codes, causes, or primitive values', () => {
    const privateValue = 'private-credential-must-never-appear';
    for (const error of [
      Object.assign(new Error(privateValue), {
        name: privateValue,
        code: privateValue,
        cause: { password: privateValue },
      }),
      privateValue,
      null,
    ]) {
      const diagnostic = startupFailureDiagnostic('documentation', error, {});
      expect(diagnostic.errorType).toBe('UnknownError');
      expect(diagnostic).not.toHaveProperty('code');
      expect(JSON.stringify(diagnostic)).not.toContain(privateValue);
    }
  });

  it('survives inaccessible exception properties without reading message, stack, or cause', () => {
    const error = new Proxy(
      {},
      {
        get: () => {
          throw new Error('private getter failure');
        },
      },
    );
    expect(startupFailureDiagnostic('application', error, {})).toEqual({
      event: 'api_startup_failed',
      stage: 'application',
      errorType: 'UnknownError',
    });
  });

  it('rejects an unexpected stage value instead of copying it into logs', () => {
    expect(startupFailureDiagnostic('private value' as StartupStage, new TypeError(), {})).toEqual({
      event: 'api_startup_failed',
      stage: 'application',
      errorType: 'TypeError',
    });
  });
});
