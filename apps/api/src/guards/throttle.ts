import type { ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { cachedRequestPrincipal, resolveRequestPrincipal } from '../common/session.js';
import { HealthController } from '../modules/health.js';

export class VerifiedUserThrottlerGuard extends ThrottlerGuard {
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getClass() !== HealthController) {
      const request = context.switchToHttp().getRequest<Request>();
      // Authentication failures still consume the anonymous quota; SessionGuard
      // subsequently surfaces the cached failure without another database lookup.
      await resolveRequestPrincipal(request).catch(() => null);
    }
    return super.canActivate(context);
  }

  protected override async getTracker(request: Record<string, unknown>): Promise<string> {
    const principal = await cachedRequestPrincipal(request as unknown as Request).catch(() => null);
    if (principal) return `user:${principal.userId}`;
    // Express's socket-derived IP stays authoritative: no trust-proxy setting or
    // client-supplied X-Forwarded-For/user identifier participates in this key.
    return `ip:${await super.getTracker(request)}`;
  }
}
