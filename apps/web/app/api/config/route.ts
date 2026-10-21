export const dynamic = 'force-dynamic';
export function GET() {
  const email = Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
  return Response.json({
    email,
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    microsoft: Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET),
    registrationAvailable: process.env.NODE_ENV !== 'production' || email,
    verificationRequired: process.env.NODE_ENV === 'production' || email,
  });
}
