import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import pino from 'pino';
import { resolveApplicationOrigins } from '@fileforge/shared';
import type { Request, Response, NextFunction } from 'express';
import { closeApiQueue } from './modules/controller.js';
import { SafeExceptionFilter } from './common/errors.js';

import { AppModule } from './app.module.js';
import { apiRuntime } from './common/runtime.js';

const log = pino({ name: 'fileforge-api' });
const { port, handleProcessSignals } = apiRuntime();
const { origin: appOrigin } = resolveApplicationOrigins(process.env);
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  app.use(helmet());
  app.enableCors({
    origin: appOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-workspace-id'],
  });
  app.use((request: Request, response: Response, next: NextFunction) => {
    const started = Date.now();
    response.once('finish', () =>
      log.info(
        {
          method: request.method,
          path: request.path,
          status: response.statusCode,
          durationMs: Date.now() - started,
        },
        'Request completed',
      ),
    );
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const origin = request.headers.origin;
      if (
        (origin && origin !== appOrigin) ||
        (!origin && request.headers.cookie) ||
        request.headers['sec-fetch-site'] === 'cross-site'
      ) {
        response.status(403).json({ message: 'Request origin is not authorized.' });
        return;
      }
    }
    next();
  });
  app.useGlobalFilters(new SafeExceptionFilter());
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('FileForge AI API')
      .setDescription(
        'Tenant-scoped private document processing. Protected endpoints require a Better Auth session cookie and x-workspace-id.',
      )
      .setVersion('0.1.0')
      .addCookieAuth()
      .build(),
  );
  SwaggerModule.setup('api/docs', app, document);
  await app.listen(port, '0.0.0.0');
  log.info({ port }, 'FileForge API listening');
  if (handleProcessSignals)
    for (const signal of ['SIGINT', 'SIGTERM'] as const)
      process.once(signal, () => {
        void (async () => {
          await closeApiQueue();
          await app.close();
          process.exit(0);
        })().catch(() => process.exit(1));
      });
}

// Vercel captures the server's listen call before it completes importing this
// entrypoint. Awaiting bootstrap at module scope deadlocks that interception.
void bootstrap().catch((error: unknown) => {
  log.error(
    { errorType: error instanceof Error ? error.name : 'UnknownError' },
    'API startup failed',
  );
  if (handleProcessSignals) process.exitCode = 1;
});
