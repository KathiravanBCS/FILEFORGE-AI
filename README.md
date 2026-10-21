# FileForge AI

A TypeScript monorepo for business card scanning: private images → background AI extraction → human review → searchable contacts → XLSX export.

Built with **Next.js App Router, React, Mantine, NestJS, Better Auth, Prisma, BullMQ, Groq SDK and ExcelJS**. Neon is the sole relational database, Cloudflare R2 the sole file store, and Upstash TLS Redis the queue service. No Docker or local database/Redis server is required.

## Run locally

Use Node **24 LTS (24.11 or later, below 25)** and pnpm **11.25.0**. Package versions are pinned in manifests and the lockfile; TypeScript 5.9 and TanStack Table 8 are selected for compatibility with the current framework APIs.

```sh
pnpm install --frozen-lockfile
```

Copy `.env.example` to `.env` at the repository root (`cp .env.example .env` on macOS/Linux; `Copy-Item .env.example .env` in Windows PowerShell). Fill the managed-service values securely. Never commit `.env` or paste credentials into issues/chat. The native Node environment loader is shared by all three app scripts.

```sh
pnpm env:init       # generates a random local session secret only if missing
pnpm env:check      # validates configuration; does not prove connectivity
pnpm db:generate   # official pinned Prisma TypeScript generator; no native engine download
pnpm db:deploy     # review the initial SQL and back up existing data first
pnpm dev
```

`env:init` preserves existing secrets and user configuration. Its generated secret is for local development. Supply a stable deployment-managed signing secret for production. Migration commands require Prisma's official native schema engine downloads and the Neon direct connection. Do not reset a managed database to resolve a migration conflict.

| Process | Default address                  | Purpose                                        |
| ------- | -------------------------------- | ---------------------------------------------- |
| Next.js | `http://localhost:3000`          | Interface and Better Auth `/api/auth`          |
| NestJS  | `http://localhost:4000/api/v1`   | Authenticated, tenant-scoped REST API          |
| Swagger | `http://localhost:4000/api/docs` | API route documentation                        |
| Worker  | No public port                   | Groq extraction, exports and retention cleanup |

The commands are designed for Windows without WSL; Windows execution has not been validated in this Linux environment. Set environment variables through your shell or deployment settings; never use a local PostgreSQL/Redis substitute. On a constrained cloud machine with an unwritable home directory, use [`scripts/setup-cloud.sh`](scripts/setup-cloud.sh), which directs package-manager caches to writable paths.

## Deploy to Vercel

For deployment, follow [the Vercel Services guide](docs/vercel.md). Import the repository root as one project: Next serves the public domain and calls the internal Nest API using a runtime binding. The persistent BullMQ worker needs a separate native Node background-worker host under the no-Docker requirement.

## Business card workflow

1. Register and sign in. Registration creates a personal workspace; additional workspaces can be created in the workspace switcher.
2. Open **Business card scanner**, select a JPG, PNG or WebP front image and an optional back image, then submit. Individual files are limited to 20 MB.
3. Follow the queued/processing state. Provider errors are displayed; retry after resolving the cause.
4. Review the extracted fields beside the original images. AI output is unverified until you explicitly approve it. Missing details remain empty.
5. Search/filter/sort contacts, select rows, edit details, or request an Excel export.
6. Download completed exports through the authorized Exports page. Generated workbooks remain private in R2.

Role enforcement happens on the server: viewers can read, members can process/edit, and admins/owners manage the workspace. An arbitrary `x-workspace-id`, record ID or job ID cannot grant access. Deleting an organization is disabled until a coordinated R2 retention/deletion process is implemented.

## Appearance

The Appearance page supports light/dark/system mode, nine accents, compact/comfortable density, border radius and reduced motion, with a live preview. Local preferences apply before sign-in; saved authenticated preferences take precedence after loading and are saved explicitly to PostgreSQL. Workspace theme policies are a future extension. The authenticated application uses both small Mantine tables and a reusable TanStack/Mantine contacts table with server pagination, selection and column controls.

## Configuration and service limits

- `DATABASE_URL`: Neon pooled TLS URL; `DIRECT_URL`: direct TLS URL for migrations.
- `BETTER_AUTH_SECRET`: at least 32 random characters. Production uses secure cookies and requires HTTPS.
- R2: use the private `file-processing` bucket and its account endpoint; secrets remain server-only.
- `REDIS_URL`: Upstash Redis protocol, preferably `rediss://`. The adapter enforces verified TLS even for Upstash's `redis://` spelling. REST endpoints are rejected.
- `GROQ_VISION_MODEL`: defaults to the requested `qwen/qwen3.8-27b`. Model availability and vision/JSON compatibility must be verified for your account; no other model is silently selected.
- `GROQ_TEXT_MODEL`: reserved configuration for a future text adapter; it is not called by the scanner.
- `RESEND_API_KEY` and `EMAIL_FROM`: optional during development. Verification, password resets and email invitations remain unavailable without both. Production requires verified email; configure Resend before allowing sign-ups.
- Google/Microsoft OAuth only appears when both provider credentials are configured.

Upstash command/connection quotas apply even to idle BullMQ workers. Concurrency defaults to two; use an appropriately sized plan before running continuous processing. AI cost is recorded only when configured token rates are supplied; an unknown cost stays unknown.

## Validation

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
pnpm check:providers   # opt-in read-only external checks, no paid inference
```

Routine tests mock external providers. The suite covers tenant authorization through actual Nest HTTP requests, session rejection, read-only roles, file validation, malformed AI responses, queue configuration, worker ownership/cancellation, Excel formula safety, environment redaction and auth configuration. Browser tests cover public navigation, client-side validation, protected route redirects, responsive layout and explicitly unavailable email. They do not prove live managed-service integration. See [`docs/testing.md`](docs/testing.md) for the real-provider acceptance procedure.

This environment also has system Chromium; set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium` to use it instead of downloading a browser. On Windows, use the Playwright-managed browser by default.

## Current validation limits

See [`docs/implementation-status.md`](docs/implementation-status.md) for the checked implementation, test results and outstanding acceptance criteria. The current cloud network blocks Neon DNS and external provider requests. No managed database migration or live AI inference has been completed. Email/OAuth credentials are absent. Source implementation and mocked tests must not be treated as proof of a working production service.

Future PDF/QR/invoice tools, enterprise SSO/SCIM/MFA/passkeys, external malware scanning, production observability and disaster recovery verification remain separate work. No enterprise compliance or production-readiness claim is made.

## Documentation

- [Vercel services deployment and worker hosting](docs/vercel.md)
- [Architecture and data flow](docs/architecture.md)
- [Authentication and database setup](docs/auth.md)
- [API contracts](docs/api.md)
- [Cloud providers and queue operations](docs/providers.md)
- [Production operations and limitations](docs/operations.md)
- [Testing and troubleshooting](docs/testing.md)
