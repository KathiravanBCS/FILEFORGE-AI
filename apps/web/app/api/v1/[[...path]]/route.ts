import { proxyApiRequest } from '../../../../lib/server/api-proxy';
export const runtime = 'nodejs';
export const maxDuration = 120;
export const dynamic = 'force-dynamic';
interface RouteContext {
  params: Promise<{ path?: string[] }>;
}
async function handler(request: Request, context: RouteContext) {
  const { path = [] } = await context.params;
  return proxyApiRequest(request, path);
}
export {
  handler as GET,
  handler as POST,
  handler as PUT,
  handler as PATCH,
  handler as DELETE,
  handler as HEAD,
  handler as OPTIONS,
};
