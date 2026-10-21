'use client';
import { useAppearance } from '../stores/appearance';
import { useWorkspace } from '../stores/workspace';
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const workspace = useWorkspace.getState().id;
  if (workspace) headers.set('x-workspace-id', workspace);
  if (options.body && !(options.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  const segments = path.split('?')[0]!.slice(1).split('/');
  if (
    !path.startsWith('/') ||
    !segments.every((segment) => /^[A-Za-z0-9_-]+$/.test(segment)) ||
    path.includes('#')
  ) {
    throw new Error('API requests must use a relative workspace path.');
  }
  const res = await fetch(`/api/v1${path}`, { ...options, headers, credentials: 'include' });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    throw new ApiError(
      res.status,
      Array.isArray(body.message)
        ? body.message.join(', ')
        : body.message || `Request failed (${res.status}).`,
    );
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Something went wrong. Please try again.';
export const formatDate = (value: string) => {
  const preferences = useAppearance.getState().preferences;
  try {
    return new Intl.DateTimeFormat(preferences.language, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: preferences.timeZone,
    }).format(new Date(value));
  } catch {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(value));
  }
};
