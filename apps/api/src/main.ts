import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import pino from 'pino';
import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { closeApiQueue } from './modules/controller.js';
import { SafeExceptionFilter } from './common/errors.js';

import { AppModule } from './app.module.js';

const log = pino({ name: 'fileforge-api' });
const port = z.coerce
  .number()
  .int()
  .min(1)
  .max(65535)
  .parse(process.env.API_PORT ?? 4000);
const appOrigin = z.url().parse(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000');
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
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void (async () => {
      await closeApiQueue();
      await app.close();
      process.exit(0);
    })().catch(() => process.exit(1));
  });
