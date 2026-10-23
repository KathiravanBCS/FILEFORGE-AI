# Testing and troubleshooting

## Routine checks

`pnpm db:generate`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm check:api-build` and `pnpm test:e2e` are the normal quality checks. Run the compiled API check after building. It copies only the deployable API output to an empty directory and rejects symbolic links. Native Node runs with synchronous `require(esm)` and TypeScript stripping disabled, matching the function loader's restrictions. With `NODE_ENV` both production and unset, it validates real HTTP health, anonymous authorization, signed HTTPS sessions, origin rejection, rate limiting and Swagger HTML/JSON/CSS. Session checks use generated test-only signing keys and an in-memory database fixture; valid sessions load preferences and workspaces, while incorrect signatures and revoked tokens return401. No repository dependencies or provider credentials are available. External provider requests are mocked in automated tests. Never run paid inference as part of the ordinary test suite.

- Unit tests cover shared schemas/permissions, auth availability, image signatures/sizes, safe Excel cells, structured AI output, task configuration and processing semantics.
- HTTP tests boot a Nest application and send real requests through its guards/controllers while replacing the database/auth/provider boundary with test doubles. They verify tenant rejection before storage signing and writes.
- Worker tests re-read ownership, reject forged or mismatched task types, respect cancellation before commit and persist review-only results and usage.
- Browser tests use desktop and mobile Chromium to exercise landing navigation, registration validation, anonymous route protection, legal-review notices and unavailable email behavior. They do not simulate a signed-in production session.

On this cloud machine, use `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium pnpm test:e2e`. On other machines install Chromium using `pnpm exec playwright install chromium`. Tests run one browser worker to avoid competing cold Next webpack compilations. First startup can be slower than a production build.

## Real-provider acceptance (explicit, opt-in)

1. Verify the network policy permits the exact Neon pooled/direct hostnames, R2 account endpoint, Upstash hostname and `api.groq.com`. Prisma native migration commands require `binaries.prisma.sh`. TLS verification must remain enabled.
2. Run `pnpm env:check` then `pnpm check:providers`. The latter performs read-only database, bucket, Redis and model-list checks, and exits nonzero if any fail. A model-list result does not prove vision support.
3. Back up existing data and review `packages/database/prisma/migrations/20261020000000_initial/migration.sql` before `pnpm db:deploy`. The supplied migration is reviewable schema-derived SQL; it has not been applied or verified against the user's managed database during this implementation.
4. Start the web, API and worker. Check API `/api/v1/health`; verify anonymous `/api/v1/contacts` returns401. Check `/api/v1/readiness` returns503 until required provider checks actually pass.
5. Register two distinct users. Verify personal workspaces and persistent sessions; create a shared organization and invite a second user only after email is configured.
6. Upload a non-sensitive business card with known consent. Confirm the object is in the private R2 bucket and the task is consumed by BullMQ. This step invokes paid Groq inference; run it deliberately, not in ordinary CI.
7. Confirm the output matches only the card's visible information. Correct a field, approve the contact and refresh the page to verify Neon persistence.
8. Search/filter/sort contacts, select rows and queue an XLSX export. Verify the private R2 object and authorized expiring download. Open the workbook and verify the corrected value and formula-safety behavior.
9. Attempt the same contact/file/scan/job/export IDs from the other user's workspace. Reads and writes must be rejected, and no signed URL should be issued.
10. Exercise provider failure/retry and cancellation; verify truthful failed/review/completed states. Revoke a session and confirm subsequent API calls fail.
11. Test dark/system/accent/density preferences across refresh and a second browser after explicit Save. Test email verification/password reset and configured OAuth independently.
12. After a deliberately rejected verification email, correct the sender configuration and use `/verify-email` for that existing unverified account. Confirm a fresh request appears in Resend, verify the new link, and confirm provider rejection/rate-limit responses remain visible without claiming delivery. Repeating signup must not claim a new account or a delivered email.

This acceptance procedure remains outstanding until the managed services are reachable. It is not reported as passed by mocked tests.

## Dependency audit scope

Run `pnpm audit --prod` for deployed runtime dependencies and `pnpm audit` for the full workspace. The Vercel CLI runs as an external pinned tool through `pnpm dlx`, avoiding an all-framework deployment toolchain in the application dependency tree; audit that tool separately when selecting/upgrading its version. CLI 65.0.0 reported advisories in its transitive build tooling during this review and is not described as vulnerability-free.

The full workspace audit currently reports [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) in development-only `braces@3.0.3`, used by Prisma's official code generator through glob tooling. No patched release is listed. These build globs are repository-controlled and do not process application uploads. Track the upstream fix; do not accept untrusted build patterns or suppress the finding as proof of security.

## Current cloud networking

Runtime checks observed `EAI_AGAIN` resolving the Neon hosts, Redis TLS connection failures, and rejected R2/Groq requests. Credentials were inspected for presence only and were never written into source or logs. The configured Groq model's availability has not been confirmed; the implementation fails explicitly rather than selecting a substitute.

The environment configuration draft successfully saves Prisma/Groq domain additions. Attempts to add the exact Neon/R2/Upstash hostnames returned a generic `INVALID_ARGUMENT` and did not confirm persistence. Add the required exact hostnames through environment settings; do not replace an unknown existing allowlist or broaden the rules as a workaround. Review/save the draft and publish the environment to activate the prepared configuration. Saved configuration does not apply runtime changes by itself.

## Troubleshooting

- **Package cache permission errors:** use writable XDG paths as in `scripts/setup-cloud.sh`; don't change the system home directory.
- **Native Prisma engine download403:** `pnpm db:generate` uses the official pinned WASM/TypeScript generator from integrity-verified npm packages. Migration CLI commands still require the official native download and direct database access. Never skip checksum/TLS verification.
- **Next child process rejects an env-file flag:** use the included `scripts/run-next.mjs` launcher. It loads `.env` through Node's built-in API without propagating unsupported flags through `NODE_OPTIONS`.
- **Authentication503:** verify a valid signing secret and reachable, migrated Neon database. No development auth bypass is provided.
- **Verified login works, but workspaces/preferences return500:** inspect the API function's Vercel runtime log. Auth runs on `web`, so successful verification does not establish that `api` starts. `Cannot use import statement outside a module` at `main.js` means an ESM bundle was loaded as CommonJS. Deploy the current `.mjs` bundle configuration with API `outputDirectory: "dist"`; remove dashboard output/build overrides and redeploy the latest commit. Confirm `/api/v1/health` returns200 before testing workspaces. Startup diagnostics report a stage, allowlisted error type/code and invalid configuration field names without logging their values; module-loader failures happen before these diagnostics can run.
- **API reports `ERR_MODULE_NOT_FOUND` for `zod` or another package:** ensure the API build includes `package-api.mjs` and `dist/node_modules` is included in the function. Running the compiled entrypoint inside the monorepo can hide this failure by resolving dependencies from parent directories. `pnpm check:api-build` must pass against the detached artifact before release; do not copy the entire development dependency tree into the function.
- **Services build says a `.pnpm/.../node_modules/package` directory does not exist:** CLI64.7 can feed dependency directory symlinks into its JavaScript tracer, which reports this misleading error. Use the current packager's hoisted, regular-file output and verify that `pnpm check:api-build` rejects any artifact containing symbolic links.
- **Runtime reports `ERR_REQUIRE_ESM` from the throttler to `@nestjs/common`:** keep the NestJS packages bundled together in the API tsup configuration. The throttler publishes CommonJS while Nest12 publishes ESM. Ordinary Node24 can hide that incompatibility by allowing `require(esm)`; the compiled startup check disables that feature and verifies that rate limiting still returns429.
- **Dashboard shows a signed-in user, but preferences/workspaces report a missing session:** web and API must share the canonical HTTPS origin, signing secret and database. Cookie names must depend consistently on that origin; Next.js can force production mode while the API's `NODE_ENV` is unset. Keep the current shared secure-cookie configuration and redeploy both services. Do not remove signature verification or accept identity headers to work around a401.
- **Email/OAuth missing:** configure both required variables and sending-domain/redirect settings. No email-delivery or OAuth success is simulated.
- **Model rejected:** verify the configured Groq model is listed and supports images and JSON output. Change the model explicitly in secure environment configuration if the requested preview model is unavailable.
- **Queued jobs never start:** verify Upstash TLS, quota/plan, worker startup and matching release/schema. Check failed-job metadata; do not remove all queue data to hide an error.
- **Failed exports:** verify selected contacts belong to the current workspace, R2 is reachable, the export is within the documented25,000-record bound and the private file has not expired.
