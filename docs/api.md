# REST API

The NestJS service listens on `PORT`, falling back to local `API_PORT` (default 4000). Base path: `/api/v1`.
Swagger documentation: `/api/docs`. Swagger describes operations; shared Zod contracts in
`packages/shared` are the request-validation source of truth.

## Authentication and workspace isolation

Authenticate through Better Auth at the Next.js `/api/auth/*` route. The API independently
looks up the session using Better Auth on every protected request; cookie caching is disabled.
Send the session cookie with `credentials: 'include'`. Set `x-workspace-id` to a workspace
returned by `GET /workspaces`. User IDs or role claims supplied by the client are never trusted.

The browser calls the same-origin web `/api/v1` proxy; that server uses the fixed `FILEFORGE_API_URL` binding to the internal API. Browser cookies and the original Origin reach Nest without exposing a runtime binding to the client. Better Auth stays on the web service at `/api/auth`. Both services validate the same explicit canonical application/authentication origin. Local direct API calls also work on matching localhost cookie hostnames.

All unsafe cookie-authenticated API requests require `Origin` exactly matching
`NEXT_PUBLIC_APP_URL`. This includes command-line integration clients: send the configured
Origin header. Cross-site browser requests are denied. CORS allows that single application
origin with credentials. Helmet applies security headers. API throttling is 120 requests per minute per verified user, per route and API process. The global guard and route guard share one Better Auth validation through a server-owned request Symbol. Client user/IP headers never select an authenticated tracker. Invalid/missing sessions use the socket-derived anonymous IP quota, and public health/capability routes avoid session/database lookup. An ingress/firewall limit is required before authentication lookups, and shared distributed limits are required across function instances; this in-memory limiter is not a global production quota.

Read-only viewers cannot upload, scan, modify contacts, export, or administer a workspace.
Members can perform normal document workflows. Admins and owners can invite members and
request retention cleanup. Only owners can invite admins. Every record-ID query is additionally
scoped to the authorized organization, including signed download requests.

## Routes

| Operation                                              | Request / response                                                                                                                                                          |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                                          | Public process liveness, not provider readiness                                                                                                                             |
| `GET /capabilities`                                    | Public configured email/OAuth/storage/processing flags, no credentials                                                                                                      |
| `GET /readiness`                                       | Checks PostgreSQL, R2 bucket access, Redis queue read, and required configuration; no paid AI calls. Probes cached30s/deduplicated with 5s per-check deadlines              |
| `GET /workspaces`                                      | `{data: [{id, name, slug, role}]}`                                                                                                                                          |
| `POST /workspaces`                                     | `{name, slug}`; creates owner membership atomically                                                                                                                         |
| `PATCH /workspaces/:id`                                | Update active workspace name/slug (admin/owner)                                                                                                                             |
| `GET /me`                                              | Current public user profile                                                                                                                                                 |
| `GET, PATCH /preferences`                              | Shared appearance/preference schema, independent of active workspace                                                                                                        |
| `GET /dashboard`                                       | Real tenant counts, recent audit events, aggregate token usage                                                                                                              |
| `GET /contacts`                                        | Server pagination, search, sort, status filter                                                                                                                              |
| `POST /contacts`                                       | `{data: ContactData, status: 'approved' \| 'draft', scanId?: UUID}`                                                                                                         |
| `GET, PATCH, DELETE /contacts/:id`                     | Scoped read/update/soft-delete; PATCH takes `{data, status}`                                                                                                                |
| `POST /contacts/bulk-delete`                           | `{ids: UUID[]}`, 1–100 items, all must exist in this tenant                                                                                                                 |
| `POST /files/uploads`                                  | `{originalName, mimeType, size}`; creates pending metadata and returns `{file, upload: {url, method, headers, expiresIn}}` for a five-minute private R2 PUT, maximum 20 MiB |
| `POST /files/:id/complete`                             | After the browser PUT, validates tenant/uploader, exact size, MIME/signature and ETag; promotes to a final key and returns uploaded metadata                                |
| `POST /files/upload`                                   | Legacy multipart `file` for direct non-Vercel API use; disabled on Vercel. Browser uploads use the direct R2 flow                                                           |
| `GET /files`                                           | Paginated file metadata; private keys omitted                                                                                                                               |
| `GET /files/:id/download`                              | `{url}`: short-lived authorized R2 URL                                                                                                                                      |
| `POST /scans`                                          | `{fileIds: UUID[]}`, one or two unique uploaded images from this workspace                                                                                                  |
| `GET /scans`                                           | Paginated scan history including jobs and file metadata                                                                                                                     |
| `GET /scans/:id`                                       | Scan detail including extraction, source image metadata, job, contacts                                                                                                      |
| `POST /scans/:id/rescan`                               | Creates a new scan/job using the original tenant-scoped images; revalidates availability/expiry and preserves existing reviews/contacts                                     |
| `POST /scans/:id/retry`                                | Retry failed/cancelled scans after the old queue task is removable                                                                                                          |
| `POST /scans/:id/cancel`                               | Marks queued/processing task cancelled; an in-flight provider call may still finish                                                                                         |
| `GET /jobs`, `GET /jobs/:id`                           | Tenant-scoped job state                                                                                                                                                     |
| `POST /exports`                                        | `{ids?: UUID[], search?: string, status?: 'draft' \| 'approved'}`; queues XLSX generation                                                                                   |
| `GET /exports`                                         | Paginated export metadata with job state                                                                                                                                    |
| `POST /exports/:id/retry`                              | Retry a failed export                                                                                                                                                       |
| `GET /exports/:id/download`                            | Signs only completed, unexpired exports owned by the tenant                                                                                                                 |
| `PATCH, DELETE /members/:id`                           | Change roles/remove members; preserve last owner, admins cannot manage owners/admins                                                                                        |
| `GET /members`                                         | Workspace members, roles, user display details                                                                                                                              |
| `GET, POST /invitations`                               | Admin listing/invitation; POST `{email, role}`; email configuration required                                                                                                |
| `GET /invitations/:id`, `POST /invitations/:id/accept` | Invitee-only detail and supported Better Auth acceptance, independent of active workspace                                                                                   |
| `POST /invitations/:id/cancel`                         | Admin cancels a pending invitation                                                                                                                                          |
| `GET /usage`                                           | Paginated actual usage and aggregates; unknown AI cost remains null                                                                                                         |
| `POST /cleanup`                                        | Admin/owner queues tenant-scoped expired/deleted file and expired export cleanup                                                                                            |

Paginated routes accept `page` (default 1) and `pageSize` (default 20, maximum 100), returning
`{data, total, page, pageSize}`. Contacts also accept `search`, `status`, `sort` (`fullName`,
`company`, `jobTitle`, `createdAt`, `status`), company/jobTitle column substring filters, and `direction` (`asc`/`desc`). No browser-side
full-dataset pagination is required.

## Failure and retention behavior

Browser uploads enter private R2 quarantine using a signed exact-size PUT. Completion copies
the verified ETag to a final workspace key before publishing uploaded metadata. Pending,
validating and rejected files cannot be downloaded or scanned. A reused signed PUT cannot
modify the final key. Configure quarantine lifecycle cleanup as described in [the Vercel guide](vercel.md).
Upload reservations expire after 15 minutes. If a process terminates during validation, start
a new upload; the interrupted reservation expires for cleanup. An uncertain database commit
does not trigger deletion of the final copy, which could remove a successfully committed file.
Uncommitted copies remain private and are removed by expired-file cleanup.
A queue failure leaves a persisted failed job with an explicit retryable message.
Extracted data is unverified until a user approves the contact. Review writes contact data and
scan/job approval status in one database transaction. Repeat review of a scan is rejected;
users edit its existing contact instead.

Uploaded source images expire after `FILE_RETENTION_DAYS` (default 30, allowed 1–3650).
The API refuses new scans/downloads of expired images. Cleanup is an explicit admin job;
configure an external scheduler to request it periodically and observe failures. Cleanup is
chunked; repeat when more than one chunk remains. Soft-deleted contacts remain in PostgreSQL;
a legal deletion/purge policy must be defined before production.

Unexpected errors return a generic message and correlation ID; logs omit cookie values,
request bodies, provider responses, search strings, and credentials. Request logs include
method, route path, status, and duration only. Routine tests mock cloud providers; provider
readiness and full real-service workflow checks are separate opt-in validations.
