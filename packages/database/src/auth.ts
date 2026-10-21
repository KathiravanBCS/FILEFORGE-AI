import { randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { organization } from 'better-auth/plugins';
import { defaultAc, adminAc, ownerAc, memberAc } from 'better-auth/plugins/organization/access';
import { Resend } from 'resend';
import { getDatabase } from './client.js';

export function authCapabilities() {
  return {
    email: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    microsoft: Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET),
  };
}
export function requireAuthSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32)
    throw new Error('BETTER_AUTH_SECRET must be configured with at least 32 random characters.');
  return secret;
}
async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from)
    throw new APIError('SERVICE_UNAVAILABLE', {
      message: 'Transactional email is not configured. Contact your administrator.',
    });
  const result = await new Resend(key).emails.send({ from, to, subject, text });
  if (result.error)
    throw new APIError('SERVICE_UNAVAILABLE', {
      message: 'The email provider could not deliver this message. Please try again later.',
    });
}

function createAuth() {
  const secret = requireAuthSecret();
  const database = getDatabase();
  const capabilities = authCapabilities();
  const appUrl =
    process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const production = process.env.NODE_ENV === 'production';
  return betterAuth({
    appName: 'FileForge AI',
    secret,
    baseURL: appUrl,
    trustedOrigins: [new URL(appUrl).origin],
    database: prismaAdapter(database, { provider: 'postgresql' }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      requireEmailVerification: production || capabilities.email,
      revokeSessionsOnPasswordReset: true,
      ...(capabilities.email
        ? {
            sendResetPassword: async ({ user, url }: { user: { email: string }; url: string }) => {
              await sendEmail(
                user.email,
                'Reset your FileForge AI password',
                `Reset your password using this link: ${url}\nIf you did not request this, ignore this email.`,
              );
            },
          }
        : {}),
    },
    emailVerification: {
      sendOnSignUp: capabilities.email,
      autoSignInAfterVerification: true,
      ...(capabilities.email
        ? {
            sendVerificationEmail: async ({
              user,
              url,
            }: {
              user: { email: string };
              url: string;
            }) => {
              await sendEmail(
                user.email,
                'Verify your FileForge AI email',
                `Verify your email using this link: ${url}`,
              );
            },
          }
        : {}),
    },
    socialProviders: {
      ...(capabilities.google
        ? {
            google: {
              clientId: process.env.GOOGLE_CLIENT_ID!,
              clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
            },
          }
        : {}),
      ...(capabilities.microsoft
        ? {
            microsoft: {
              clientId: process.env.MICROSOFT_CLIENT_ID!,
              clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
            },
          }
        : {}),
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    rateLimit: { enabled: true, window: 60, max: 30 },
    advanced: {
      useSecureCookies: production,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure: production },
      database: { generateId: () => randomUUID() },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            const organizationId = randomUUID();
            await database.$transaction(async (tx) => {
              await tx.organization.create({
                data: {
                  id: organizationId,
                  name: `${user.name}'s workspace`,
                  slug: `personal-${organizationId}`,
                  metadata: JSON.stringify({ personal: true }),
                },
              });
              await tx.member.create({
                data: { id: randomUUID(), organizationId, userId: user.id, role: 'owner' },
              });
              await tx.userPreferences.create({ data: { userId: user.id } });
            });
          },
        },
      },
    },
    plugins: [
      organization({
        allowUserToCreateOrganization: true,
        // Preserve private-file metadata until a durable tenant purge is implemented.
        disableOrganizationDeletion: true,
        creatorRole: 'owner',
        roles: {
          owner: ownerAc,
          admin: adminAc,
          member: memberAc,
          viewer: defaultAc.newRole({
            organization: [],
            member: [],
            invitation: [],
            team: [],
            ac: [],
          }),
        },
        invitationExpiresIn: 60 * 60 * 24 * 7,
        sendInvitationEmail: async (data) => {
          const invitationUrl = new URL('/settings/invitations', appUrl);
          invitationUrl.searchParams.set('invitationId', data.id);
          await sendEmail(
            data.email,
            `Invitation to ${data.organization.name} on FileForge AI`,
            `${data.inviter.user.name} invited you to ${data.organization.name}. Sign in and accept the invitation: ${invitationUrl.toString()}`,
          );
        },
        organizationHooks: {
          beforeCreateInvitation: async () => {
            if (!capabilities.email)
              throw new APIError('SERVICE_UNAVAILABLE', {
                message:
                  'Invitations require transactional email. Configure Resend before inviting members.',
              });
          },
        },
      }),
    ],
  });
}
let instance: ReturnType<typeof createAuth> | undefined;
export function getAuth(): ReturnType<typeof createAuth> {
  return (instance ??= createAuth());
}
export type Auth = ReturnType<typeof getAuth>;
