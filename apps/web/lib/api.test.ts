import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';
vi.mock('../stores/workspace', () => ({
  useWorkspace: { getState: () => ({ id: 'active-workspace' }) },
}));
vi.mock('../stores/appearance', () => ({
  useAppearance: { getState: () => ({ preferences: { language: 'en', timeZone: 'UTC' } }) },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe('same-origin browser API client', () => {
  it('uses the public same-origin proxy and session cookie independently of build-time public API variables', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://not-used.example/api');
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [] }));
    vi.stubGlobal('fetch', transport);
    await expect(api('/contacts?search=Lee%20%26%20Co')).resolves.toEqual({ data: [] });
    const [url, options] = transport.mock.calls[0]!;
    expect(url).toBe('/api/v1/contacts?search=Lee%20%26%20Co');
    expect(options?.credentials).toBe('include');
    expect(new Headers(options?.headers).get('x-workspace-id')).toBe('active-workspace');
  });
  it.each([
    'https://external.example/contacts',
    '//external.example/contacts',
    '/../auth/sign-out',
    '/%2e%2e/auth',
    '/contacts/../auth',
    '/contacts#fragment',
  ])('prevents callers escaping the API route prefix: %s', async (path) => {
    const transport = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', transport);
    await expect(api(path)).rejects.toThrow('relative workspace path');
    expect(transport).not.toHaveBeenCalled();
  });
  it('preserves failed HTTP outcomes as typed errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ message: 'Session expired' }, { status: 401 })),
    );
    await expect(api('/contacts')).rejects.toEqual(new ApiError(401, 'Session expired'));
  });
  it('accepts successful no-content responses without inventing JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 })),
    );
    await expect(api('/contacts/contact-id', { method: 'DELETE' })).resolves.toBeUndefined();
  });
});
