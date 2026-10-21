import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { getDatabase } from '@fileforge/database';
import { R2Storage } from '@fileforge/integrations';
import { checkApiQueue } from './controller.js';

interface ReadinessChecks {
  database: boolean;
  storage: boolean;
  queue: boolean;
  authentication: boolean;
  processingConfigured: boolean;
}
let cached: { at: number; checks: ReadinessChecks } | undefined;
let probing: Promise<ReadinessChecks> | undefined;
async function boundedCheck(operation: () => Promise<unknown>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Readiness timeout')), 5000);
        timer.unref();
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
async function checkReadiness(): Promise<ReadinessChecks> {
  if (cached && Date.now() - cached.at < 30_000) return cached.checks;
  if (probing) return probing;
  probing = (async () => {
    const [database, storage, queue] = await Promise.all([
      boundedCheck(async () => {
        await getDatabase().$queryRaw`SELECT 1`;
      }),
      boundedCheck(() => R2Storage.fromEnvironment().head()),
      boundedCheck(checkApiQueue),
    ]);
    const checks: ReadinessChecks = {
      database,
      storage,
      queue,
      authentication: Boolean(process.env.BETTER_AUTH_SECRET),
      processingConfigured: Boolean(process.env.REDIS_URL && process.env.GROQ_API_KEY),
    };
    cached = { at: Date.now(), checks };
    return checks;
  })();
  try {
    return await probing;
  } finally {
    probing = undefined;
  }
}

@ApiTags('Health')
@Controller('api/v1')
export class HealthController {
  @Get('health')
  health() {
    return { status: 'ok', service: 'fileforge-api', version: '0.1.0' };
  }

  @Get('capabilities')
  capabilities() {
    return {
      email: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
      oauth: {
        google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
        microsoft: Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET),
      },
      storage: Boolean(
        process.env.S3_ENDPOINT && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY,
      ),
      processing: Boolean(process.env.REDIS_URL && process.env.GROQ_API_KEY),
    };
  }

  @Get('readiness')
  async readiness() {
    const checks = await checkReadiness();
    if (!Object.values(checks).every(Boolean))
      throw new ServiceUnavailableException({ status: 'unavailable', checks });
    return {
      status: 'ok',
      checks,
      note: 'Model availability is checked by the opt-in provider check; no paid inference is performed here.',
    };
  }
}
