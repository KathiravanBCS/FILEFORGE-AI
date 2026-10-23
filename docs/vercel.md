# Deploying with Vercel Services

The root [`vercel.json`](../vercel.json) defines one Vercel project with two independently built Node 24 services. Import the repository with **Root Directory set to the repository root**. Keep dashboard build/install/output overrides unset; the service configuration owns them. Do not create separate projects rooted at each app for this setup.

## Routing and bindings

| Service | Directory  | Public routing                      | Outbound service calls                |
| ------- | ---------- | ----------------------------------- | ------------------------------------- |
| `web`   | `apps/web` | All paths on the project domain     | Calls `api` using `FILEFORGE_API_URL` |
| `api`   | `apps/api` | Internal; no public service rewrite | None                                  |

The browser calls same-origin `/api/v1/*`. A Next Node route handler forwards requests through the binding, preserving the session cookie, workspace header, query and browser origin. The API independently validates sessions, membership and CSRF. Better Auth `/api/auth/*` and configuration `/api/config` stay on Next. Swagger `/api/docs` is available on the API directly during development, outside the web proxy.

**Do not set `FILEFORGE_API_URL` yourself** in environment settings, `.env`, builds, middleware or client code. Vercel generates it for the calling `web` service's runtime functions. The proxy reads it per request, never during builds. Bindings grant connectivity; protected API routes still require authentication.

## Persistent worker

`apps/worker` consumes BullMQ tasks over persistent Redis connections. Run it continuously on a separate native Node background-worker host with outbound access to Neon, Upstash, R2 and Groq. It needs no inbound port or Vercel binding. API and worker must share the same database, private bucket and Redis queue.

Vercel Services are request handlers. Vercel Daemons support continuous workers but currently require a Dockerfile or Containerfile. The repository's no-Docker requirement therefore leaves the worker outside Vercel. Select its host before launch; deploying only web/API leaves scans and exports queued.

Use the repository root as the worker build directory, Node 24 and pnpm 11.25.0:

```sh
# Build command
pnpm install --frozen-lockfile && pnpm db:generate && pnpm --filter @fileforge/worker build
# Start command
pnpm --filter @fileforge/worker start
```

Configure the worker host's database, R2, Redis, Groq, concurrency, retention and optional token-price variables from `.env.example`. It does not need signing/OAuth/email secrets. Start with one instance and concurrency two. Allow shutdown time for the 60-second provider timeout and retries. Monitor queue errors and Upstash quotas. Deploy compatible schema/API/worker releases together. Use separate databases, buckets and Redis instances for preview and production; workers sharing a queue can consume each other's jobs.

## Environment variables

Set values through Vercel project settings for each environment and redeploy. Set **`ENABLE_EXPERIMENTAL_COREPACK=1`** for builds so Vercel uses the pinned pnpm 11.25.0 instead of inferring an older version from lockfile format 9. Root and service manifests declare the package manager and Node 24 version. Never commit `.env` or reuse a local development secret in production.

| Setting                                                   | Value / purpose                                                                                                                     |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_APP_URL`, `BETTER_AUTH_URL`                  | The same explicit canonical HTTPS origin, such as `https://fileforge.example.com`; no path/query/credentials                        |
| `BETTER_AUTH_SECRET`                                      | Stable cryptographically random secret, at least 32 characters, shared by web and API                                               |
| `DATABASE_URL`                                            | Neon pooled PostgreSQL URL with TLS                                                                                                 |
| `STORAGE_PROVIDER`, `S3_BUCKET`, `S3_REGION`              | `r2`, private bucket name, `auto`                                                                                                   |
| `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Account-specific R2 HTTPS endpoint and scoped private-bucket credentials                                                            |
| `REDIS_URL`                                               | Upstash Redis **protocol** TLS URL (`rediss://`), not REST                                                                          |
| `FILE_RETENTION_DAYS`                                     | Source retention, default 30                                                                                                        |
| `RESEND_API_KEY`, `EMAIL_FROM`                            | Both required for production registration verification, reset and invitation email; verify the sender domain                        |
| OAuth variables                                           | Optional Google/Microsoft credential pairs; register the matching `/api/auth/callback/google` or `/api/auth/callback/microsoft` URL |

Vercel supplies `PORT` and `NODE_ENV`; do not override these for deployment. Groq and `WORKER_CONCURRENCY` belong on the worker host. `pnpm env:check` validates the complete three-process configuration and additionally expects Groq. `DIRECT_URL` is the Neon direct TLS connection for the separate migration job. No `NEXT_PUBLIC_API_URL` is needed.

Preview deployments need their own exact canonical HTTPS origins, signing secret, provider resources, email/OAuth callbacks and R2 allowed origins. Arbitrary generated preview hostnames do not automatically become trusted. Use a stable preview domain or explicitly set both canonical origins for that deployment. Request Host headers and wildcard auth origins are not trusted. Cookies are host-only; sign in again after changing the canonical domain.

## R2 direct uploads

Vercel Functions accept at most 4.5 MB per request/response. The app preserves **20 MiB per image** by sending file bytes directly from the browser to private R2:

1. An authenticated API request reserves a pending file and a five-minute PUT URL for a tenant-scoped `quarantine/` object.
2. The browser uploads bytes to R2 without application cookies.
3. Completion checks tenant/uploader, exact size, MIME and image signature, then conditionally copies the validated ETag to a final key. Pending/rejected files cannot be scanned or downloaded. The worker validates finalized images again.

Configure bucket CORS with your exact deployed and local origins:

For `https://fileforge-ai-two.vercel.app`, the ready-to-paste production policy is
[`deploy/r2-cors.production.json`](../deploy/r2-cors.production.json). In Cloudflare,
open **R2 Object Storage → file-processing → Settings → CORS Policy**, add or edit
the policy, paste that JSON array and save. This is a bucket setting; adding it to
Vercel environment variables does not configure R2. Object read/write credentials
may not have permission to edit bucket settings. Use the Cloudflare dashboard when
the S3 CORS API returns `AccessDenied`.

For other deployments, replace the example origins below with their exact origins:

```json
[
  {
    "AllowedOrigins": ["https://fileforge.example.com", "http://localhost:3000"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "MaxAgeSeconds": 300
  }
]
```

Keep the bucket private. Add GET/HEAD CORS methods only if needed by a signed-image preview consumer. Configure a lifecycle rule to delete **`quarantine/` objects after one day**. A signed PUT can be reused until expiry, even after completion deletes its staged object; lifecycle cleanup bounds abandoned objects. Do not apply this short lifetime to final `workspaces/` keys. Administrative worker cleanup also removes expired staging objects; schedule tenant-authorized cleanup for final file/export retention. CORS and lifecycle are external settings, not applied by `vercel.json`. Signed URLs are bearer credentials and must not be logged.

After saving CORS, start a fresh upload from the scanner so it receives a new
five-minute URL. A failed browser PUT leaves a pending reservation, not a completed
image; pending rows cannot be downloaded. Verify the browser's OPTIONS request
returns a successful status and `Access-Control-Allow-Origin` matching the app's
origin, then confirm PUT succeeds before completion and scan submission. The R2
error `CORS not configured for this bucket` identifies the missing bucket policy;
changing image size, session settings or the API route does not resolve it.

## Build, migrate and release

Each service installs the frozen workspace lockfile with build dependencies included (`--prod=false`) and generates Prisma before building itself. Builds do not connect to the database, apply migrations or start the worker. Workspace source outside each app directory must remain included; keep inclusion of files outside the root directory enabled if the Vercel UI offers that setting.

The API service selects `vercel-entry.mjs` explicitly. This stable wrapper exists before the build and imports `dist/main.mjs`; Services deploys the compiled `dist` output. The explicit selection avoids relying on framework detection after bundling removes the external NestJS imports. The entrypoint and lazy chunks use `.mjs` so Node recognizes ES modules even when Vercel packages them outside `apps/api/package.json`. Internal workspace packages and the HTTP NestJS framework packages are bundled together. This also converts the CommonJS throttler's Nest imports into the same module graph: Vercel's function loader rejects synchronous `require()` of Nest12 ES modules. TypeScript workspace source exports are not production function entrypoints.

The API build also runs [`package-api.mjs`](../scripts/package-api.mjs). It creates a temporary workspace containing the required package manifests, existing lockfile and compiled chunks. Production dependencies are installed with the frozen lockfile, a hoisted layout and lifecycle hooks disabled. The pinned Vercel file tracer then selects runtime files; only those files and Swagger assets are copied into `dist/node_modules`. The temporary workspace is removed afterward. Cached packages are preferred, with normal registry access for cache misses.

Vercel mounts the compiled output at the function root, so dependencies must travel with it. The output contains regular files: the Services builder in CLI 64.7 incorrectly treats directory symlinks as JavaScript trace entries. Missing dependencies, symbolic links or conflicting file contents fail packaging. The documented optional Nest/email features remain unused.

Keep `outputDirectory`, function `includeFiles: "dist/**"`, `.mjs` output extensions and the `start` command aligned. `pnpm check:api-build`, run after building, copies only `dist` to an empty temporary directory, rejects symbolic links, and boots native Node under a CommonJS package scope with synchronous `require(esm)` and TypeScript stripping disabled. No repository dependencies or provider credentials are supplied. It checks health, signed-session and anonymous authorization, CSRF, rate limiting and Swagger HTML/JSON/CSS with `NODE_ENV` both production and unset. HTTPS cookie names depend on the shared canonical origin, so Next.js and the API use the same cookie even if their runtime modes differ. CI requires this check.

Back up existing data and review `packages/database/prisma/migrations/20261020000000_initial/migration.sql` before first release. Run `pnpm db:deploy` once in a controlled release environment with `DIRECT_URL` and access to official Prisma engine downloads. Do not run migrations concurrently in service builds or reset a managed database.

After configuration review, import the Git repository, select the repository root, configure variables and deploy. Start the matching external worker. Configure distributed abuse protection/WAF: Nest's limiter is per process and functions scale independently. Verify readiness, sign-in, a direct upload larger than 4.5 MB, extraction, review and export against real providers before launch. Follow [`testing.md`](testing.md) for tenant-isolation and failure checks. Successful builds do not validate credentials, migrations, R2 policies or real provider behavior.

## Test locally

```sh
pnpm install --frozen-lockfile
# Configure root .env; use http://localhost:3000 for both local origins.
pnpm dev:vercel
# Separate terminal, when managed providers are reachable:
pnpm --filter @fileforge/worker dev
```

`dev:vercel` generates Prisma, builds the API, and runs `vercel dev -L` through the pinned external CLI (`pnpm --allow-build=esbuild dlx vercel@65.0.0`). The initial build makes the configured API output available before service discovery. This starts web/API and injects the binding without linking or deploying a project. **Restart `pnpm dev:vercel` after changing API source**; the pinned CLI does not reload the selected compiled bundle when it is rebuilt. Test `/`, `/api/v1/health` and anonymous `/api/v1/contacts` (401). `/api/auth/*` must still reach Better Auth. Cookie-authenticated mutations must carry the configured application Origin. Use the default local port or update both local origins to your chosen port.

Plain `pnpm dev` starts all three processes and watches API TypeScript source directly. Its web proxy uses the local API port only outside production; production without a binding returns 503.

References: [Services](https://vercel.com/docs/services), [bindings](https://vercel.com/docs/services/bindings), [NestJS](https://vercel.com/docs/frameworks/backend/nestjs), [function limits](https://vercel.com/docs/functions/limitations), [Daemons configuration](https://vercel.com/docs/daemons/config-reference).
