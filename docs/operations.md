# Operations and production requirements

Use three Node 24 processes (Next.js, API and worker), Neon PostgreSQL, private Cloudflare R2 and Upstash TLS Redis. There are no Docker, local database, local Redis or alternative storage dependencies.

## Deployment

Set production HTTPS URLs, a stable cryptographically random Better Auth secret, managed-service credentials and the allowed application origin. Build from the lockfile, generate Prisma, back up the database, review SQL, run `pnpm db:deploy`, then deploy web/API/worker versions together. Never run development schema reset commands on a managed production database. Session signing needs the real secret in the process; an HTTP proxy placeholder cannot sign local cookies.

Keep object storage private. Use scoped R2 credentials with only required bucket permissions. Rotate secrets in the deployment platform. Never log file bodies, contact contents, tokens, cookies or connection URLs. Put the API behind your HTTPS ingress and configure trusted proxy settings only for infrastructure you control.

## Upstash

BullMQ uses the Redis TLS protocol, not the REST API. Blocking reads, retries, heartbeats and idle workers consume commands and connections. Start with low concurrency, bound completed/failed queue retention, observe command quotas, and use a plan sized for continuous background processing. Stop unnecessary workers in development. Measure concurrency against Groq rate limits and Redis quotas before increasing it. Do not promise high throughput on a free tier.

Failed jobs retain diagnostic metadata and may be retried after fixing the cause. Cancellation is best effort once an external request has started. Review database/queue consistency and requeue orphaned jobs under operator control. Run retention cleanup on a deliberate schedule; configure and verify policies before deleting user data. Soft-deleted contact data needs a separate permanent erasure policy covering backups.

## Required controls before launch

- Verify the configured Groq vision model's current availability and image/schema support using an authorized account; no fallback should silently change providers or models.
- Configure Resend and verify the sending domain before enabling verification, password resets and invitations.
- Register OAuth redirects and test provider-specific sign-in and linking before advertising those buttons.
- Configure distributed abuse limits at your ingress for horizontally scaled APIs. In-memory limits are per process.
- Add malware scanning, metrics/alerts, error monitoring, durable audit retention and provider-specific request/cost metering.
- Review legal policy placeholders with counsel; they are not legal documents.
- Test Neon point-in-time recovery and R2 object recovery in an isolated environment. Record RPO/RTO and restore evidence.
- Maintain incident response contacts, credential rotation runbooks and data breach escalation.
- Run dependency auditing and review transitive findings. Do not suppress warnings as proof of security.

No compliance certification, disaster recovery guarantee, or production readiness is claimed by this scaffold.
