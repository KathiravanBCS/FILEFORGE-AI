import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxyApiRequest } from './api-proxy';
const env: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  FILEFORGE_API_URL: 'https://api.internal.test/service/base/',
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
describe('runtime API service proxy', () => {
  it('uses only the trusted binding base, preserving path, query, identity and tenant headers', async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        { total: 3 },
        {
          status: 202,
          headers: {
            'Retry-After': '2',
            'Cache-Control': 'public,max-age=3600',
            'X-Request-Id': 'server-id',
          },
        },
      ),
    );
    const request = new Request(
      'https://web.example/api/v1/contacts?search=Lee%20%26%20Co&page=2',
      {
        method: 'POST',
        headers: {
          Cookie: 'session=opaque',
          Origin: 'https://web.example',
          'Content-Type': 'application/json',
          'X-Workspace-Id': 'workspace-one',
          Host: 'evil.example',
          'X-Forwarded-For': '127.0.0.1',
          'X-Forwarded-Host': 'evil.example',
          'X-Vercel-Protection-Bypass': 'must-not-forward',
        },
        body: JSON.stringify({ action: 'review' }),
      },
    );
    const response = await proxyApiRequest(request, ['contacts'], { env, fetch: upstream });
    const [url, options] = upstream.mock.calls[0]!;
    expect(String(url)).toBe(
      'https://api.internal.test/service/base/api/v1/contacts?search=Lee%20%26%20Co&page=2',
    );
    const headers = new Headers(options?.headers);
    expect(headers.get('cookie')).toBe('session=opaque');
    expect(headers.get('origin')).toBe('https://web.example');
    expect(headers.get('x-workspace-id')).toBe('workspace-one');
    for (const name of [
      'host',
      'x-forwarded-for',
      'x-forwarded-host',
      'x-vercel-protection-bypass',
    ])
      expect(headers.has(name)).toBe(false);
    expect(new TextDecoder().decode(options?.body as Uint8Array)).toBe('{"action":"review"}');
    expect(options).toMatchObject({ method: 'POST', redirect: 'manual', cache: 'no-store' });
    expect(response.status).toBe(202);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('retry-after')).toBe('2');
    expect(response.headers.get('x-request-id')).toBe('server-id');
    expect(await response.json()).toEqual({ total: 3 });
  });
  it('reads a changed service binding on subsequent requests rather than capturing it at build/import time', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const upstream = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({}));
    vi.stubEnv('FILEFORGE_API_URL', 'https://one.internal.test/base');
    await proxyApiRequest(new Request('https://web.example/api/v1/health'), ['health'], {
      fetch: upstream,
    });
    vi.stubEnv('FILEFORGE_API_URL', 'https://two.internal.test/another');
    await proxyApiRequest(new Request('https://web.example/api/v1/health'), ['health'], {
      fetch: upstream,
    });
    expect(String(upstream.mock.calls[0]![0])).toBe('https://one.internal.test/base/api/v1/health');
    expect(String(upstream.mock.calls[1]![0])).toBe(
      'https://two.internal.test/another/api/v1/health',
    );
  });
  it('fails explicitly when a production binding is missing and permits local fallback only outside production', async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ status: 'ok' }));
    const missing = await proxyApiRequest(
      new Request('https://web.example/api/v1/health'),
      ['health'],
      { env: { NODE_ENV: 'production' }, fetch: upstream },
    );
    expect(missing.status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
    await proxyApiRequest(new Request('http://localhost:3000/api/v1/health'), ['health'], {
      env: { NODE_ENV: 'development' },
      fetch: upstream,
    });
    expect(String(upstream.mock.calls[0]![0])).toBe('http://localhost:4000/api/v1/health');
  });
  it('honors the local API port without exposing it to the browser', async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ status: 'ok' }));
    await proxyApiRequest(new Request('http://localhost:3000/api/v1/health'), ['health'], {
      env: { NODE_ENV: 'development', API_PORT: '5174' },
      fetch: upstream,
    });
    expect(String(upstream.mock.calls[0]![0])).toBe('http://localhost:5174/api/v1/health');
  });
  it.each(['0', '65536', 'invalid', '4000.5', '0xFA0'])(
    'rejects invalid local API ports: %s',
    async (port) => {
      const upstream = vi.fn<typeof fetch>();
      const response = await proxyApiRequest(
        new Request('http://localhost:3000/api/v1/health'),
        ['health'],
        { env: { NODE_ENV: 'development', API_PORT: port }, fetch: upstream },
      );
      expect(response.status).toBe(503);
      expect(upstream).not.toHaveBeenCalled();
    },
  );
  it.each([
    'ftp://internal.test',
    'https://user:password@internal.test',
    'https://internal.test/?secret=example',
    'https://internal.test/#fragment',
    'not-a-url',
  ])(
    'rejects malformed or credential-bearing service bindings without exposing them',
    async (binding) => {
      const upstream = vi.fn<typeof fetch>();
      const response = await proxyApiRequest(
        new Request('https://web.example/api/v1/files'),
        ['files'],
        { env: { ...env, FILEFORGE_API_URL: binding }, fetch: upstream },
      );
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain(binding);
      expect(upstream).not.toHaveBeenCalled();
    },
  );
  it.each([
    ['..'],
    ['%2e%2e'],
    ['https://evil.example'],
    ['contacts/../../auth'],
    ['\\evil.example'],
    ['contacts?host=evil'],
    [''],
  ])('blocks traversal and external URL path injection: %j', async (segment) => {
    const upstream = vi.fn<typeof fetch>();
    const response = await proxyApiRequest(
      new Request('https://web.example/api/v1/files'),
      [segment],
      { env, fetch: upstream },
    );
    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('does not follow upstream redirects and refuses destinations outside the fixed service API prefix', async () => {
    const upstream = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(null, { status: 307, headers: { Location: 'https://evil.example/collect' } }),
      );
    const response = await proxyApiRequest(
      new Request('https://web.example/api/v1/files'),
      ['files'],
      { env, fetch: upstream },
    );
    expect(response.status).toBe(502);
    expect(upstream.mock.calls[0]![1]?.redirect).toBe('manual');
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(await response.text()).not.toContain('evil.example');
  });
  it('rewrites an allowed internal redirect to the public same-origin API path', async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 307,
        headers: { Location: '/service/base/api/v1/contacts?page=2' },
      }),
    );
    const response = await proxyApiRequest(
      new Request('https://web.example/api/v1/contacts'),
      ['contacts'],
      { env, fetch: upstream },
    );
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('/api/v1/contacts?page=2');
  });
  it('preserves authentication failures and multiple cookies without forwarding stale content lengths/encodings', async () => {
    const headers = new Headers({
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip',
      'Content-Length': '999',
    });
    headers.append('Set-Cookie', 'first=one; HttpOnly; Path=/');
    headers.append('Set-Cookie', 'second=two; HttpOnly; Path=/');
    const upstream = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{"message":"Session expired"}', { status: 401, headers }));
    const response = await proxyApiRequest(
      new Request('https://web.example/api/v1/contacts'),
      ['contacts'],
      { env, fetch: upstream },
    );
    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie()).toHaveLength(2);
    expect(response.headers.has('content-length')).toBe(false);
    expect(response.headers.has('content-encoding')).toBe(false);
    expect(await response.json()).toEqual({ message: 'Session expired' });
  });
  it('handles bodyless HTTP responses', async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const response = await proxyApiRequest(
      new Request('https://web.example/api/v1/contacts', { method: 'DELETE' }),
      ['contacts'],
      { env, fetch: upstream },
    );
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });
  it('rejects declared and actual oversized bodies before contacting the service', async () => {
    const upstream = vi.fn<typeof fetch>();
    const declared = await proxyApiRequest(
      new Request('https://web.example/api/v1/files/uploads', {
        method: 'POST',
        headers: { 'Content-Length': '2097152' },
        body: '{}',
      }),
      ['files', 'uploads'],
      { env, fetch: upstream },
    );
    const actual = await proxyApiRequest(
      new Request('https://web.example/api/v1/files/uploads', {
        method: 'POST',
        body: 'x'.repeat(1024 * 1024 + 1),
      }),
      ['files', 'uploads'],
      { env, fetch: upstream },
    );
    expect(declared.status).toBe(413);
    expect(actual.status).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('reports transport failures without leaking private hosts or credentials', async () => {
    const upstream = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('private.internal:443 secret details'));
    const response = await proxyApiRequest(
      new Request('https://web.example/api/v1/files'),
      ['files'],
      { env, fetch: upstream },
    );
    expect(response.status).toBe(502);
    expect(await response.text()).not.toMatch(/private\.internal|secret details/);
  });
  it('reports upstream timeout separately', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('Timed out', 'TimeoutError'));
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const upstream = vi.fn<typeof fetch>().mockRejectedValue(controller.signal.reason);
    const response = await proxyApiRequest(
      new Request('https://web.example/api/v1/files'),
      ['files'],
      { env, fetch: upstream },
    );
    expect(response.status).toBe(504);
  });
});
