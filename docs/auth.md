# Authentication and tenant boundaries

FileForge uses Better Auth with its supported Prisma PostgreSQL adapter. The Next.js
`/api/auth/[...all]` route owns authentication, while NestJS independently validates
sessions with the same server-only `getAuth().api.getSession({ headers })` implementation.
The auth client never receives database, storage, AI, Redis, or session-signing secrets.

## Configuration

Set `BETTER_AUTH_SECRET` to at least 32 cryptographically random characters in secure
environment settings. The application refuses an absent or short secret. Set
`BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` to the web origin. HTTPS and secure cookies are
required in production. Development uses `http://localhost:3000` and the API at port 4000.
The shared auth configuration selects secure cookies for every HTTPS canonical origin,
even when a service's runtime does not set `NODE_ENV`. Next.js and the API must read
the same `__Secure-better-auth.session_token`; neither accepts an unsigned token or a
session absent from the database. HTTP local development keeps its non-secure cookie.
`DATABASE_URL` must be the Neon pooled URL; `DIRECT_URL` is used for migrations when
present. Runtime connections use the Prisma PostgreSQL driver adapter with a bounded pool.

`RESEND_API_KEY` and `EMAIL_FROM` enable verification, resets, and organization invitation
emails. Without them, development permits email/password registration and sign-in, with
verification and resets explicitly unavailable. Production always requires email
verification; configure and verify the sender before accepting registrations. Missing
email configuration is an operational blocker for production sign-in by unverified users.
The auth route returns 503 for reset/verification delivery requests while email is absent.
No token, email body, reset URL, or session value is written to logs.

OAuth is enabled per provider only when both fields are configured:
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, or `MICROSOFT_CLIENT_ID` /
`MICROSOFT_CLIENT_SECRET`. Register the Better Auth callback URL for each provider,
`<web-origin>/api/auth/callback/google` or `/api/auth/callback/microsoft`.

## Missing verification emails

Use `/verify-email` to request a fresh verification email for an existing unverified
account. The registration confirmation and login screens link to this page. Requests
that succeed use conditional wording because unknown and already-verified addresses
receive a generic response; the UI does not disclose account existence or promise inbox
delivery.

Repeating registration is not a resend mechanism. With required verification, Better Auth
returns an intentionally generic successful signup response for existing addresses and
does not send another email. A newly created account may also remain unverified after
its initial email is rejected. After correcting email configuration, request verification
again through `/verify-email`; the earlier rejected email is not retried automatically.

Resend's `onboarding@resend.dev` sender is restricted to the address associated with the
Resend account. For other recipients, verify a domain you control and configure
`EMAIL_FROM` to use that domain, then redeploy. Changing the sender does not require a
new API key if the existing key has sending access to that verified domain.

Explicit verification requests await the email callback. Provider rejection and transport
failures return an error instead of a success message. Server diagnostics record only a
sanitized provider status, never recipients, email bodies, tokens, sender values or API
keys. Better Auth limits verification requests to three per minute per IP/path; production
still needs distributed abuse protection. A provider accepting a request does not prove
inbox delivery: inspect the provider's delivery events when needed.

## Schema and migrations

The authentication model shapes follow Better Auth's built-in schemas: User, Session,
Account, Verification and the organization plugin's Organization, Member, Invitation.
The application extends these with UserPreferences and domain models; it does not create
a second authentication user or membership schema. Better Auth controls account/session
writes. A successful registration creates a personal Organization, owner Member, and
default preferences through a database hook.

Run `pnpm db:generate`, then review and apply migrations with `pnpm db:deploy` in managed
Neon. Development changes can use `pnpm db:migrate`. Do not run destructive schema pushes
against a shared database. The seed script only checks the connection; accounts should
be created through registration and no fake metrics or contacts are inserted.

## Authorization

Application-owned records carry `organizationId`. Every read, mutation, object download,
scan, job, and export lookup must include the authorized organization. A valid record ID
is never sufficient authorization. The active workspace is selected only after verifying
membership against PostgreSQL. Shared `can` / `assertPermission` helpers implement four
roles: owner and admin can manage settings and members, members can write domain data,
viewers can only read. Better Auth's organization access control also defines a viewer
role without organization or membership write privileges.

The API must authorize the organization before passing tenant context to a service. The
worker must re-read job, scan, file, and export rows, checking tenant ownership rather than
trusting queue payloads. `assertTenant` denies empty or mismatched tenant identities.
Cross-tenant negative tests belong both at the policy boundary and at API/worker lookups.

## Sessions and security limits

Sessions expire after seven days, with a one-day update interval. Session cookie caching
is disabled so revocations are checked against the database. Cookies are HTTP-only,
SameSite=Lax, and secure in production. Better Auth enforces trusted origins and its
built-in CSRF checks; the trusted origin comes from the configured web URL. Auth requests
also use Better Auth's default in-memory rate limiter. A multi-replica production
deployment needs a reviewed shared limiter strategy and edge limits; an in-memory limit
alone is not a global abuse control.

MFA, passkeys, SSO, and SCIM are extension points via Better Auth plugins; none is enabled
or claimed as implemented here. Enable them only with migrations, recovery design,
provider configuration, and dedicated security tests.

Organization deletion is disabled until a durable R2 purge lifecycle is implemented.
Deleting relational tenant metadata first would orphan private objects and bypass
retention cleanup. Account deletion is likewise not exposed in the current UI.

## Restricted-egress code generation

`pnpm db:generate` calls `packages/database/scripts/generate-client.ts`. It uses the
version-pinned official `@prisma/internals` WASM schema parser and
`@prisma/client-generator-ts` in-process generator, producing the real Prisma client.
The standard CLI unconditionally downloads a native schema engine even for generation;
this environment's proxy denies `binaries.prisma.sh`. The helper avoids that unrelated
download without disabling TLS, signatures, package integrity, or checksum verification.
Its dependencies are pinned to the same Prisma version and must be upgraded together.
Because these are Prisma internal APIs, revalidate the helper when upgrading Prisma.

The standard CLI is retained as `pnpm --filter @fileforge/database generate:cli` for
unrestricted environments. Native migration commands still need verified access to
`binaries.prisma.sh`. Do not set `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING`, point engine
variables at dummy executables, or otherwise bypass artifact verification.

`prisma/migrations/20261020000000_initial/migration.sql` is a reviewable initial SQL
migration authored from the schema. It includes tenant and identity foreign keys,
compound membership uniqueness, queue/export idempotency constraints, and lookup
indexes. It has **not been applied or live-validated against Neon**: the configured
managed database host currently fails DNS resolution in this environment. Review it
against the existing database and compare with Prisma's schema diff before deployment.
No database reset, schema push, or production migration was performed during setup.

## Production and Vercel preview origins

Configure `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` explicitly for each deployed
environment. Both values must be the same canonical HTTPS web origin, without an API
path, credentials, query string, or fragment. The shared origin resolver normalizes
trailing slashes and default ports, rejects disagreement, and fails closed in production
if either origin is absent. The web runtime and its corresponding API deployment must
use the same canonical origin and the same securely supplied Better Auth signing secret
and session database. Browser requests use same-origin `/api/auth` and `/api/v1` paths.
The backend service address is a server-only runtime binding managed by deployment; no
public API URL is needed in the browser bundle.

Vercel preview deployments also run with `NODE_ENV=production`. Assign a deliberate
canonical preview origin (for example, a stable preview alias you control) and configure
both canonical-origin variables for that preview environment. Do not point a preview at
the production canonical origin, switch to development mode, trust request `Host` or
`X-Forwarded-Host` headers, or allow every `*.vercel.app` origin to make preview sign-in
work. A deployment whose canonical hostname has not been configured can serve public
pages, but authentication is intentionally unavailable until its trusted origin is set.
This code does not infer trust from `VERCEL_URL` or an incoming request host.

`NEXT_PUBLIC_APP_URL` is a build-time public Next.js variable. After changing a canonical
origin, rebuild/redeploy the web app and update the matching API environment rather than
assuming an existing browser bundle changes at runtime. `BETTER_AUTH_URL` is server-only
and is resolved lazily when the authentication instance is initialized, so a public-page
build does not require cloud credentials. Its value must agree with the built public
origin. Register the exact Google/Microsoft callback URLs for each environment; use
separate preview provider configuration and data when applicable.

Production sessions use Secure, HttpOnly, SameSite=Lax cookies and keep Better Auth's
host-only cookie scope. Do not enable a shared parent-domain cookie to bridge preview
and production hosts. Session revocation remains checked against PostgreSQL because
cookie caching is disabled. Origin and cookie controls have focused configuration
coverage; successful real-provider authentication still requires reachable Neon, a
valid signing secret, and configured verification email in production.
