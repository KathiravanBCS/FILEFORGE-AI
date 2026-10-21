# Implementation status

FileForge AI has an implemented application foundation and business-card workflow using the requested stack. **The initial live-service acceptance criteria are not yet complete.** Local builds and mocked integration tests do not establish that the managed services work.

## Implemented

- pnpm/Turborepo monorepo with Next.js, NestJS, worker and shared database/contracts/UI/integration packages.
- Better Auth registration, sessions, profile/password/session management, optional Resend and Google/Microsoft configuration. Production registration is rejected on the server when email verification cannot be delivered.
- Personal and organization workspaces, four roles, membership policies, invitations and tenant-scoped API/worker lookups.
- Nineteen Prisma models and an initial SQL migration, including normalized contacts, files, jobs, exports, usage, preferences and audit logs.
- Responsive public/authenticated interfaces, dynamic Mantine appearance and a live preview, real-data dashboard/usage views and a reusable server-paginated contacts table.
- Signature-validated private R2 uploads, front/back scanning, batches of individual cards, Groq structured extraction, human review, contact correction/approval, retry/cancellation and scan history.
- Rescanning creates a new scan/job from authorized originals without replacing existing approved contacts or history.
- Background formula-safe XLSX exports stored privately in R2, authorized expiring downloads and bounded retention cleanup.
- Security headers, cookie/origin protections, per-process rate limits, sanitized failures, workspace audit events, tests and CI commands.

## Local evidence

| Check                                     | Result                                                                                              |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Lockfile installation                     | Passed, including a frozen offline repeat                                                           |
| Prisma client generation                  | Passed through the official version-pinned WASM/TypeScript generator                                |
| All application/package production builds | Passed; Next.js builds all 26 routes                                                                |
| Strict TypeScript checks                  | Passed across packages, applications, scripts and test configuration                                |
| ESLint and formatting                     | Passed                                                                                              |
| Unit, API HTTP and worker tests           | 75 passed across 13 files; external boundaries mocked                                               |
| Playwright public/authentication tests    | 8 passed across desktop and mobile Chromium                                                         |
| Saved development command                 | `pnpm dev` starts web/API; landing200, health200 and protected401 verified                          |
| Production web runtime                    | Landing200, anonymous redirect307 and production signup without email503 verified                   |
| Compiled NestJS runtime                   | Started; health200, protected requests401, disallowed origin403, rate limit429 and Swagger verified |
| Compiled worker runtime                   | Started, attempted verified Redis TLS, and shut down cleanly; queue connection failed               |
| Dependency audit                          | No known production vulnerabilities reported after compatible ExcelJS UUID override                 |
| Secret review                             | No injected provider or generated session secrets found in trackable source files                   |

Browser coverage includes public navigation, weak-password validation before authentication requests, explicit unavailable email states, anonymous route protection, legal-review notices and responsive layout. It does not cover authenticated live scanning. The production signup prerequisite has separate server-handler tests.

## External requirements still outstanding

| Requirement                             | Current observation / next step                                                                                                                                                                 |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Neon application and direct connections | Runtime checks fail; DNS previously reported `EAI_AGAIN`. Permit the exact configured hostnames and verify the supplied connections.                                                            |
| Initial database migration              | SQL has not been applied or validated against Neon. Back up/review existing data, compare the schema, then run `pnpm db:deploy` when native Prisma downloads and the direct connection work.    |
| Cloudflare R2                           | Private bucket access check fails. Verify endpoint, credentials, bucket permissions and network policy; no live upload was confirmed.                                                           |
| Upstash                                 | Verified TLS connection check fails. Permit the configured hostname and verify credentials/plan/quotas. No live BullMQ processing was confirmed.                                                |
| Groq                                    | Model-list access fails. Verify the configured vision model exists and accepts images/JSON before running the real scan acceptance procedure. No paid inference or model substitution occurred. |
| Resend                                  | Credentials/sender are absent. Verification/reset/invitation delivery is unavailable; production signup is blocked until configured.                                                            |
| Optional OAuth                          | Credentials are absent; provider sign-in has not been tested.                                                                                                                                   |
| Windows                                 | Commands were designed for Windows without Docker/WSL, but execution was validated only on Linux.                                                                                               |

The reusable environment draft contains tested `install_script` and `start_skill` fields, plus custom allowed domains for `binaries.prisma.sh`, `api.groq.com` and `console.groq.com`. Exact Neon/R2/Upstash additions could not be saved: the configuration tool returned a generic `INVALID_ARGUMENT`. Add the exact hostnames from the corresponding connection variables through environment settings. Review/save the configuration and publish through the product when appropriate. Draft persistence does not prove runtime application, publication or fresh-task restoration.

## Operational and future scope

Exports are capped at 25,000 contacts per job and expire after seven days. Original files default to 30-day retention; cleanup processes bounded batches and needs an operator-configured schedule. There is no external malware scanner, global distributed abuse limiter, verified disaster recovery, SSO/SCIM/MFA/passkey implementation, or compliance certification. Legal pages are clearly marked for review.

Future PDF, QR, invoice, conversion and reporting modules remain deferred as requested. The extension points exist; those tools are not advertised as functional.

Complete the [real-provider acceptance procedure](testing.md#real-provider-acceptance-explicit-opt-in) after connectivity and migrations are resolved. Until then, do not call the application production ready or the full scanner/export workflow end-to-end verified.
