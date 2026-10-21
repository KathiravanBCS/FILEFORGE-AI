# Architecture

FileForge uses pnpm workspaces and Turborepo. Each app is an independent process:

- `apps/web`: Next.js App Router, Better Auth HTTP handlers, Mantine, TanStack Query/Table, Zustand preferences.
- `apps/api`: NestJS REST API, session validation, tenant authorization, orchestration and metadata writes.
- `apps/worker`: BullMQ consumers, private object retrieval, Groq extraction and Excel export.
- `packages/database`: Prisma schema/client and the shared server-only Better Auth configuration.
- `packages/shared`: dependency-light Zod contracts and permission policies usable in both runtimes.
- `packages/integrations`: R2, Upstash queue, Groq, image validation and Excel adapters.
- `packages/ui`: reusable Mantine presentation components.

The browser never receives storage, database, queue or AI credentials. The API validates the Better Auth session independently and resolves membership for `x-workspace-id`. Supplying an ID does not confer access. Every organization-owned lookup includes the authenticated organization, including downloads, retries, exports and background job data. Workers load database records again rather than trusting queue payloads.

## Business card lifecycle

1. An authenticated member reserves a pending JPEG, PNG or WebP upload through the API and uploads bytes directly to private R2 quarantine using a five-minute signed PUT.
2. Completion verifies exact size, MIME, signature and ETag, copies to a unique organization-scoped final key and publishes uploaded metadata in Neon. A signed staging URL cannot overwrite that final key.
3. The API persists a scan and job, then adds an idempotently identified BullMQ task.
4. The worker validates ownership, reads the private source, requests structured output from Groq and validates it with Zod.
5. Extracted content requires human review. The user edits the fields and explicitly approves the contact.
6. A selected/filtered contact export queues a workbook job. ExcelJS writes formula-safe values and the worker stores the result in private R2.
7. A tenant-authorized API endpoint issues a short-lived signed download URL.

Provider failures remain visible as failed/retryable states. Database and queue writes span different services: enqueuing failures must leave recoverable job metadata; operators should monitor orphaned jobs. This is not an exactly-once distributed transaction.

## Extensions

On Vercel, the public Next service proxies `/api/v1/*` to an internal Nest service through a runtime service binding. Better Auth remains on Next. The continuous BullMQ worker runs on a separate native Node host; see [deployment configuration](vercel.md).

Queue task types, AI interfaces and storage adapters provide extension points for future modules. PDF, QR, invoice and conversion tools are deliberately deferred until the scanner is validated. SSO/SCIM/MFA/passkeys require separate implementation, threat modelling and operational testing; current organization roles do not imply enterprise compliance.

## Data and privacy

Contact data is personal data. Groq receives the images needed for extraction, R2 retains the originals and Neon retains structured records. Configure retention according to your policy, document subprocessors, and verify deletion and backup behavior before public use. Uploaded files are restricted images; full malware scanning is an additional production control, not an implemented guarantee.
