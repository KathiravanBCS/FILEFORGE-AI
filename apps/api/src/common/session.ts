import { ServiceUnavailableException } from '@nestjs/common';
import { getAuth } from '@fileforge/database';
import type { Request } from 'express';
import type { Principal } from './context.js';

const validatedSession = Symbol('fileforge.verifiedSession');
type SessionRequest = Request & { [validatedSession]?: Promise<Principal | null> };

async function validate(request: Request): Promise<Principal | null> {
  if (!request.headers.cookie) return null;
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === 'string') headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(', '));
  }
  try {
    const session = await getAuth().api.getSession({ headers });
    return session
      ? { userId: session.user.id, email: session.user.email, sessionId: session.session.id }
      : null;
  } catch {
    throw new ServiceUnavailableException('Authentication is temporarily unavailable.');
  }
}

export function resolveRequestPrincipal(request: Request): Promise<Principal | null> {
  const scoped = request as SessionRequest;
  return (scoped[validatedSession] ??= validate(request));
}

/** Only returns a server-validated result; it never reads client identity/IP headers. */
export function cachedRequestPrincipal(request: Request): Promise<Principal | null> {
  return (request as SessionRequest)[validatedSession] ?? Promise.resolve(null);
}
