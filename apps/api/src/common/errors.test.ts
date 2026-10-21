import { describe, expect, it, vi } from 'vitest';
import type { ArgumentsHost } from '@nestjs/common';
vi.mock('pino', () => ({ default: () => ({ error: vi.fn() }) }));
import { SafeExceptionFilter } from './errors.js';

function capture(exception: unknown) {
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;
  new SafeExceptionFilter().catch(exception, host);
  return response;
}

// Deliberately not subclasses of this package's HttpException: package-manager
// peer contexts can give Nest dependency exceptions a different class identity.
class ForeignHttpException extends Error {
  constructor(private readonly status: number) {
    super('HTTP failure');
  }
  getStatus() {
    return this.status;
  }
  getResponse() {
    return {
      statusCode: this.status,
      message: this.status === 429 ? 'Too many requests' : 'Forbidden',
    };
  }
}

describe('HTTP exceptions across package boundaries', () => {
  it.each([403, 429])(
    'preserves status %i from the supported HTTP exception contract',
    (status) => {
      const response = capture(new ForeignHttpException(status));
      expect(response.status).toHaveBeenCalledWith(status);
      expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ statusCode: status }));
    },
  );
  it('keeps unexpected errors private', () => {
    const response = capture(new Error('private provider credentials or response'));
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      message: 'Something went wrong. Please try again.',
      errorId: expect.any(String),
    });
  });
  it('rejects invalid HTTP status contracts', () => {
    expect(capture(new ForeignHttpException(200)).status).toHaveBeenCalledWith(500);
  });
  it('does not fail while handling a broken exception contract', () => {
    class BrokenException extends ForeignHttpException {
      getStatus(): number {
        throw new Error('broken');
      }
    }
    expect(capture(new BrokenException(429)).status).toHaveBeenCalledWith(500);
  });
});
