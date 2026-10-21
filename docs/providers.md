# Managed providers and background processing

FileForge never starts PostgreSQL, Redis, object storage, or Docker locally. Application records use Neon PostgreSQL; all source images and XLSX downloads use the private Cloudflare R2 `file-processing` bucket. BullMQ uses the Upstash **Redis TLS protocol**, not REST. Groq requests use the official SDK.

## Required settings

Set `DATABASE_URL` to Neon's pooled URL and `DIRECT_URL` to the direct migration connection. Supply `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY`; `S3_REGION=auto`, `S3_BUCKET=file-processing`, and `STORAGE_PROVIDER=r2` are the defaults. R2 endpoints must be account-specific HTTPS `*.r2.cloudflarestorage.com` URLs. Credentials must stay server-side.

Set `REDIS_URL=rediss://...@your-database.upstash.io:6379`. The adapter always enables certificate-verified TLS for Upstash, including when an existing Upstash connection URL spells its protocol `redis://`; it never opens plaintext Redis. Other providers, localhost, and REST URLs are rejected. Production should use the explicit `rediss://` spelling.

Set `GROQ_API_KEY` and `GROQ_VISION_MODEL`. The requested default is `qwen/qwen3.8-27b`. This model's availability and vision/JSON capabilities must be confirmed in your Groq account. The code does not substitute a different model if that name is unavailable. `GROQ_TEXT_MODEL=openai/gpt-oss-20b` is reserved for future text adapters; the scanner does not call it. Optional `GROQ_INPUT_USD_PER_MILLION` and `GROQ_OUTPUT_USD_PER_MILLION` provide account/model-specific cost estimates. Cost stays null when rates have not been configured; token usage is still recorded.

During implementation, read-only requests to `api.groq.com` and `console.groq.com` were blocked by an egress-proxy CONNECT 403. Model availability was therefore **not verified**. Allow those destinations and rerun provider checks before claiming a live scan works. No paid inference request is made by ordinary unit tests.

## Queue operations

Run the worker as a separate process: `pnpm --filter @fileforge/worker dev` during development or `pnpm --filter @fileforge/worker start` after building. Start only the workers required by active development. A snapshot does not retain live worker processes.

The `fileforge-processing` queue receives identifier-only tasks `{jobId, organizationId, type}`. Types are `scan`, `export`, and `cleanup`. A worker reloads the tenant-scoped database job, checks current creator membership/permissions, and revalidates file ownership before acting. It never trusts arbitrary object keys, extraction contents, or privileged commands supplied through queue payloads. Scan results stop in `review`; only an authenticated human approval creates a contact.

Concurrency defaults to two and accepts `WORKER_CONCURRENCY=1..10`. Jobs retry three times with exponential backoff starting at two seconds. Completed entries retain at most 500 jobs for one day; failed entries retain at most 500 for seven days. Database job/audit records retain the durable status. Idle worker polling uses a 30-second drain delay and 60-second stalled checks; locks are 120 seconds. BullMQ requires persistent connections and renewals even when idle: evaluate Upstash command and connection quotas, provision an appropriate paid plan for continuous/high-volume workloads, and monitor command usage and failed jobs. Producer connections fail after bounded retries; worker connections use the BullMQ-required unlimited request retry mode.

Cancellation is cooperative: it stops between processing stages and before committing results. An already-dispatched Groq request cannot be recalled and may still incur provider charges. Retries of retained failed jobs must use BullMQ `retry()` or remove the failed queue entry before re-enqueueing the same identifier. Database terminal states make duplicate successful processing a no-op. Database transactions and unique `(jobId,type)` usage records prevent duplicate persisted outcomes; external inference may still occur twice after a process crash or lost queue lock.

On SIGINT/SIGTERM, workers stop fetching new work, drain in-flight processing, close Redis, and disconnect PostgreSQL. Deployment stop deadlines must exceed the 60-second provider timeout plus retries. Monitor failed jobs and use authorized API retry routes after diagnosing the failure; there is no silently successful dead-letter fallback.

## Uploads, downloads, and retention

The API checks image magic bytes independently of client MIME/filename. JPEG, PNG, and WebP up to 20 MiB per image are accepted; each card has one image or front/back. The worker revalidates bytes against stored metadata. These checks are not malware scanning or image sanitization: add a managed scanner/quarantine stage before expanding accepted file types or claiming malware protection. Images should not be rendered as trusted HTML.

Object keys contain only validated workspace/file identifiers. The private bucket must never have public access enabled. Only an authorized tenant-scoped database lookup can lead to a download signature; signatures expire after two minutes (maximum five), and include sanitized attachment filenames. Presigned links are bearer credentials until expiry and must not be logged.

Uploaded images expire after 30 days by default (`FILE_RETENTION_DAYS`); expired images cannot be downloaded or submitted for a new scan. Exports run in the queue, select only tenant-scoped nondeleted contacts, page database reads in batches of 500, and cap one workbook at 25,000 contacts to bound worker memory. Narrow filters or split larger exports. XLSX text cells are escaped against formula injection; postal codes stay text. Export objects expire after seven days. An administrative cleanup task removes up to 100 expired/soft-deleted source objects and 100 expired export objects per run; rerun or schedule authorized per-workspace cleanup until the backlog is empty. Cleanup is implemented, but automatic scheduling and legal retention policies must be configured for deployment. Configure R2 lifecycle policies as a defense in depth after checking application retention requirements.

Avoid logging images, OCR results, contact details, keys, signed URLs, and provider raw errors. Worker logs contain job identifiers, task types, attempt counts, and sanitized error categories only. Never claim enterprise compliance, malware scanning, backup verification, or disaster recovery validation from these adapters alone.
