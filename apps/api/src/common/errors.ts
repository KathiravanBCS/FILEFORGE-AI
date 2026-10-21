import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import pino from 'pino';
const log = pino({ name: 'fileforge-api' });

function httpErrorDetails(
  exception: unknown,
): { status: number; body: string | object } | undefined {
  if (!(exception instanceof Error)) return undefined;
  const candidate = exception as Error & Partial<Pick<HttpException, 'getStatus' | 'getResponse'>>;
  if (typeof candidate.getStatus !== 'function' || typeof candidate.getResponse !== 'function')
    return;
  try {
    // Nest dependencies can resolve a distinct peer-package copy of HttpException.
    // Its public contract survives that boundary; instanceof HttpException does not.
    const status = candidate.getStatus();
    if (!Number.isInteger(status) || status < 400 || status > 599) return;
    const body = candidate.getResponse();
    if (typeof body === 'string' || (body !== null && typeof body === 'object'))
      return { status, body };
  } catch {
    /* An invalid exception contract is treated as an unexpected server error. */
  }
}

@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const details = httpErrorDetails(exception);
    const status = details?.status ?? HttpStatus.INTERNAL_SERVER_ERROR;
    const errorId = randomUUID();
    if (status >= 500)
      log.error(
        { errorId, errorType: exception instanceof Error ? exception.name : 'UnknownError' },
        'Request failed',
      );
    const body = details?.body ?? { message: 'Something went wrong. Please try again.', errorId };
    response.status(status).json(typeof body === 'string' ? { message: body } : body);
  }
}
