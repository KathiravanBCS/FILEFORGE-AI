import { getAuth, authCapabilities } from '@fileforge/database';
export const runtime = 'nodejs';
async function handler(request: Request) {
  const path = new URL(request.url).pathname;
  const emailConfigured = authCapabilities().email;
  if (
    process.env.NODE_ENV === 'production' &&
    !emailConfigured &&
    path.endsWith('/sign-up/email')
  ) {
    return Response.json(
      { message: 'Registration requires configured transactional email in production.' },
      { status: 503 },
    );
  }
  if (
    !emailConfigured &&
    ['/request-password-reset', '/send-verification-email'].some((suffix) => path.endsWith(suffix))
  ) {
    return Response.json(
      {
        message:
          'Email verification and password reset are unavailable until transactional email is configured.',
      },
      { status: 503 },
    );
  }
  try {
    return await getAuth().handler(request);
  } catch {
    return Response.json(
      { message: 'Authentication service is unavailable. Check server configuration.' },
      { status: 503 },
    );
  }
}
export const GET = handler;
export const POST = handler;
