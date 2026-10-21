/** Server-only transport to the runtime-bound API service. Never import into client components. */
const API_PREFIX = '/api/v1';
const MAX_BODY_BYTES = 1024 * 1024;
const REQUEST_HEADERS = [
  'accept',
  'accept-language',
  'content-type',
  'cookie',
  'origin',
  'user-agent',
  'x-workspace-id',
  'x-request-id',
  'sec-fetch-site',
  'sec-fetch-mode',
] as const;
const RESPONSE_HEADERS = [
  'content-type',
  'content-disposition',
  'retry-after',
  'www-authenticate',
  'x-request-id',
  'ratelimit-limit',
  'ratelimit-remaining',
  'ratelimit-reset',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'x-total-count',
] as const;
class ProxyError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
interface ProxyOptions {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
}
function errorResponse(status: number, message: string): Response {
  return Response.json(
    { message },
    { status, headers: { 'Cache-Control': 'no-store', Vary: 'Cookie, Origin, X-Workspace-Id' } },
  );
}
function apiBase(env: NodeJS.ProcessEnv): URL {
  const binding = env.FILEFORGE_API_URL;
  if (!binding && env.NODE_ENV === 'production') {
    throw new ProxyError(
      503,
      'The API service binding is unavailable. Check the deployment service configuration.',
    );
  }
  try {
    let fallback = 'http://localhost:4000';
    if (!binding && env.API_PORT) {
      const port = Number(env.API_PORT);
      if (!/^\d+$/.test(env.API_PORT) || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('Invalid local API port');
      }
      fallback = `http://localhost:${port}`;
    }
    const base = new URL(binding || fallback);
    if (
      !['http:', 'https:'].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash
    ) {
      throw new Error('Invalid service binding');
    }
    // The platform may supply a mount path as part of the service base URL.
    base.pathname = base.pathname.replace(/\/+$/, '') + API_PREFIX;
    return base;
  } catch {
    throw new ProxyError(
      503,
      'The API service binding is invalid. Check the deployment service configuration.',
    );
  }
}
function targetUrl(base: URL, path: readonly string[], search: string): URL {
  if (path.some((segment) => segment.length > 200 || !/^[A-Za-z0-9_-]+$/.test(segment))) {
    throw new ProxyError(400, 'The API path is invalid.');
  }
  const target = new URL(base);
  target.pathname =
    base.pathname + (path.length ? '/' + path.map(encodeURIComponent).join('/') : '');
  target.search = search;
  return target;
}
async function metadataBody(request: Request): Promise<Uint8Array<ArrayBuffer> | undefined> {
  if (request.method === 'GET' || request.method === 'HEAD' || !request.body) return undefined;
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    throw new ProxyError(
      413,
      'The request is too large. Upload image bytes directly using a signed upload URL.',
    );
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new ProxyError(
          413,
          'The request is too large. Upload image bytes directly using a signed upload URL.',
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
export async function proxyApiRequest(
  request: Request,
  path: readonly string[],
  options: ProxyOptions = {},
): Promise<Response> {
  let signal: AbortSignal | undefined;
  try {
    // Read the service binding for every request, never during next build.
    const base = apiBase(options.env ?? process.env);
    const target = targetUrl(base, path, new URL(request.url).search);
    const headers = new Headers();
    for (const name of REQUEST_HEADERS) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    const body = await metadataBody(request);
    signal = AbortSignal.any([request.signal, AbortSignal.timeout(110_000)]);
    const upstream = await (options.fetch ?? globalThis.fetch)(target, {
      method: request.method,
      headers,
      body,
      redirect: 'manual',
      cache: 'no-store',
      signal,
    });
    const outgoing = new Headers({
      'Cache-Control': 'no-store',
      Vary: 'Cookie, Origin, X-Workspace-Id',
    });
    for (const name of RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value !== null) outgoing.set(name, value);
    }
    for (const cookie of upstream.headers.getSetCookie()) outgoing.append('Set-Cookie', cookie);
    const location = upstream.headers.get('location');
    if (location) {
      const destination = new URL(location, target);
      if (
        destination.origin !== base.origin ||
        (destination.pathname !== base.pathname &&
          !destination.pathname.startsWith(base.pathname + '/'))
      ) {
        throw new ProxyError(502, 'The API service returned an unsupported redirect.');
      }
      outgoing.set(
        'Location',
        API_PREFIX +
          destination.pathname.slice(base.pathname.length) +
          destination.search +
          destination.hash,
      );
    }
    const bodyless = request.method === 'HEAD' || [204, 205, 304].includes(upstream.status);
    return new Response(bodyless ? null : upstream.body, {
      status: upstream.status,
      headers: outgoing,
    });
  } catch (error) {
    if (error instanceof ProxyError) return errorResponse(error.status, error.message);
    if (signal?.aborted && !request.signal.aborted)
      return errorResponse(504, 'The API service took too long to respond. Try again.');
    if (request.signal.aborted) return errorResponse(408, 'The request was cancelled.');
    return errorResponse(502, 'The API service could not be reached. Try again.');
  }
}
