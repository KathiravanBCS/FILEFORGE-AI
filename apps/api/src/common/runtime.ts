import { z } from 'zod';

export function apiRuntime(env: NodeJS.ProcessEnv = process.env) {
  const port = z.coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .parse(env.PORT ?? env.API_PORT ?? 4000);
  // Vercel owns its function process and intercepts Nest's normal listen call.
  // A function must not install handlers that terminate the shared host process.
  return { port, handleProcessSignals: env.VERCEL !== '1' };
}
