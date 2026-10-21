import { z } from 'zod';

const optional = z
  .string()
  .optional()
  .transform((value) => value || undefined);
const neonUrl = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return (
      ['postgres:', 'postgresql:'].includes(url.protocol) &&
      url.hostname.endsWith('.neon.tech') &&
      ['require', 'verify-full', 'verify-ca'].includes(url.searchParams.get('sslmode') || '')
    );
  } catch {
    return false;
  }
}, 'Use a TLS-enabled Neon PostgreSQL connection URL.');
const r2Endpoint = z.url().refine((value) => {
  const url = new URL(value);
  return (
    url.protocol === 'https:' &&
    url.hostname.endsWith('.r2.cloudflarestorage.com') &&
    !url.username &&
    !url.password
  );
}, 'Use the HTTPS Cloudflare R2 account endpoint.');
const redisUrl = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return (
      ['redis:', 'rediss:'].includes(url.protocol) &&
      (url.hostname.endsWith('.upstash.io') || url.hostname.endsWith('.upstash.com'))
    );
  } catch {
    return false;
  }
}, 'Use an Upstash Redis protocol connection; the adapter always enforces TLS.');

/** An explicit canonical origin prevents request headers from changing auth trust. */
const applicationOrigin = z.string().transform((value, context) => {
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hostname.includes('*') ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Use an HTTP(S) origin without wildcards, credentials, path, query, or fragment.',
      });
      return z.NEVER;
    }
    return url.origin;
  } catch {
    context.addIssue({ code: 'custom', message: 'Use a valid HTTP(S) application origin.' });
    return z.NEVER;
  }
});
const optionalApplicationOrigin = z.preprocess(
  (value) => (typeof value === 'string' && !value.trim() ? undefined : value),
  applicationOrigin.optional(),
);
export const applicationOriginsSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    BETTER_AUTH_URL: optionalApplicationOrigin,
    NEXT_PUBLIC_APP_URL: optionalApplicationOrigin,
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV === 'production') {
      for (const field of ['BETTER_AUTH_URL', 'NEXT_PUBLIC_APP_URL'] as const) {
        if (!value[field] || !value[field].startsWith('https://')) {
          context.addIssue({
            code: 'custom',
            path: [field],
            message: 'Configure an explicit HTTPS canonical origin for this deployment.',
          });
        }
      }
    }
    if (
      value.BETTER_AUTH_URL &&
      value.NEXT_PUBLIC_APP_URL &&
      value.BETTER_AUTH_URL !== value.NEXT_PUBLIC_APP_URL
    ) {
      context.addIssue({
        code: 'custom',
        path: ['NEXT_PUBLIC_APP_URL'],
        message: 'The web application and authentication canonical origins must match.',
      });
    }
  })
  .transform((value) => {
    const origin = value.BETTER_AUTH_URL || value.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    return { authUrl: origin, appUrl: origin, origin };
  });

export function resolveApplicationOrigins(
  input: Record<string, string | undefined>,
): z.infer<typeof applicationOriginsSchema> {
  const result = applicationOriginsSchema.safeParse(input);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(
      `Invalid application origin configuration: ${fields.join(', ')}. Configure the canonical origins for this deployment.`,
    );
  }
  return result.data;
}

/** Pass server process variables explicitly. Never serialize this result to the browser. */
export const serverEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: neonUrl,
    DIRECT_URL: neonUrl.optional(),
    BETTER_AUTH_URL: optionalApplicationOrigin,
    BETTER_AUTH_SECRET: z.string().min(32),
    NEXT_PUBLIC_APP_URL: optionalApplicationOrigin,
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    STORAGE_PROVIDER: z.literal('r2').default('r2'),
    S3_BUCKET: z.string().min(1).default('file-processing'),
    S3_REGION: z.literal('auto').default('auto'),
    S3_ENDPOINT: r2Endpoint,
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    REDIS_URL: redisUrl,
    GROQ_API_KEY: z.string().min(1),
    GROQ_VISION_MODEL: z.string().min(1).default('qwen/qwen3.8-27b'),
    GROQ_TEXT_MODEL: z.string().min(1).default('openai/gpt-oss-20b'),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
    FILE_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
    RESEND_API_KEY: optional,
    EMAIL_FROM: optional,
    GOOGLE_CLIENT_ID: optional,
    GOOGLE_CLIENT_SECRET: optional,
    MICROSOFT_CLIENT_ID: optional,
    MICROSOFT_CLIENT_SECRET: optional,
  })
  .superRefine((value, context) => {
    for (const [left, right] of [
      ['RESEND_API_KEY', 'EMAIL_FROM'],
      ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
      ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'],
    ] as const) {
      if (Boolean(value[left]) !== Boolean(value[right]))
        context.addIssue({
          code: 'custom',
          path: [left],
          message: `Configure ${left} and ${right} together.`,
        });
    }
    const origins = applicationOriginsSchema.safeParse(value);
    if (!origins.success) {
      for (const issue of origins.error.issues)
        context.addIssue({ code: 'custom', path: issue.path, message: issue.message });
    }
  })
  .transform((value) => {
    const origins = applicationOriginsSchema.parse(value);
    return { ...value, BETTER_AUTH_URL: origins.authUrl, NEXT_PUBLIC_APP_URL: origins.appUrl };
  });
export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;
export function validateServerEnvironment(
  input: Record<string, string | undefined>,
): ServerEnvironment {
  const result = serverEnvironmentSchema.safeParse(input);
  if (!result.success) {
    // Never serialize Zod input or credential values into logs.
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Invalid server configuration: ${fields.join(', ')}. See .env.example.`);
  }
  return result.data;
}
