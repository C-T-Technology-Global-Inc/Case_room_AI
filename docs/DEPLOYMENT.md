# Deployment

Clinical Case Room runs as **one long-running Node.js container** next to PostgreSQL 16 and, for uploaded originals, S3-compatible object storage or a persistent volume. It needs a host that keeps the process running between requests (Server-Sent Events, a PostgreSQL `LISTEN` connection and background AI jobs): a VM, a managed container platform, or a serverless container with CPU allocated outside requests. Short-lived functions are not supported as is.

> This software is not a medical device. Real patient data requires your own legal, privacy and clinical-safety assessment first (see [SECURITY.md](../SECURITY.md)). Everything below assumes synthetic data.

## Images

The [Dockerfile](../Dockerfile) builds three targets from the monorepo root:

| Target | Command | Purpose |
|---|---|---|
| `runner` (default) | `docker build -t case-room .` | The web app: Next.js standalone server, non-root user, `HEALTHCHECK` on `/api/health`, port 3000. |
| `migrate` | `docker build --target migrate -t case-room-migrate .` | Applies database migrations (`prisma migrate deploy`) and exits. Run it as a release step before starting a new web version. |
| `seed` | `docker build --target seed -t case-room-seed .` | Loads the synthetic demo data. **Erases the whole database first.** Local demos only. |

CI builds all three on every pull request and runs [scripts/smoke-container.sh](../scripts/smoke-container.sh) against the web container (health, readiness, sign-in, database pages, upload, background processing, download, non-root user, no secrets in the image).

## Try it with Docker Compose

```bash
export AUTH_SECRET="$(openssl rand -base64 32)"
docker compose --profile app up -d --build        # postgres + migrations + web on http://localhost:3000
docker compose --profile demo run --rm seed       # synthetic demo data (erases the database)
```

Sign in with a demo account from the README (password `demo1234`). Uploaded originals are kept in the `storage-data` volume.

## Configuration

Set these in the container environment. Never bake them into an image.

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL 16. Must allow a **session** connection: the app keeps one `LISTEN` connection per process for realtime. A transaction-mode pooler in front breaks cross-process realtime (each process then only sees its own events). |
| `AUTH_SECRET` | yes | Long random string (`openssl rand -base64 32`). Readiness fails without it. Same value on every replica. |
| `APP_URL`, `AUTH_URL` | yes | Public HTTPS URL of the app (invitation links, Auth.js). |
| `SOURCE_CODE_URL` | yes for modified versions | Repository of the exact code you run. The AGPL-3.0 requires offering it to users; the app links to it on every screen. |
| `DEMO_LOGIN` | set `"false"` | Hides the demo accounts on the sign-in page. Never seed a reachable deployment. |
| `PUBLIC_SIGNUP` | review | `"false"` stops self-service creation of organizations (signup and "Create organization"). People can still join existing organizations by invitation. |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | recommended | Private bucket for uploaded originals. Without `S3_BUCKET`, files go to `STORAGE_DIR`. |
| `S3_SERVER_SIDE_ENCRYPTION` | optional | `AES256` (default), `aws:kms`, or empty for S3-compatible services that reject the header. |
| `STORAGE_DIR` | without S3 | Local directory for originals; `/data/storage` in the image. Mount a persistent, backed-up volume there. |
| `AI_PROVIDER`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, … | optional | Without keys the offline demo engine is used. Review the AI budget variables in [.env.example](../.env.example) before adding a paid key. |

All abuse limits and AI budgets are documented in `.env.example`.

## Release process

1. Build the images from one commit; use the same image for every replica.
2. Run the `migrate` image against the database. Never run `seed`, `setup` or `db:reset` on a shared deployment.
3. Start or roll the web containers. Route traffic only when `GET /api/ready` returns 200.

Rolling back to an older image is only safe if no migration since that version removed or moved something the old code uses (for example, `20261002090000_identities` moved passwords from `User` to `Identity`). Rolling back a migration is a manual database operation, done with a backup in hand.

## Health checks

| Endpoint | Meaning |
|---|---|
| `GET /api/health` | Liveness: the process serves requests. Never touches the database. |
| `GET /api/ready` | Readiness: `AUTH_SECRET` is set, the database answers within 2 s and no migration is half-applied. Returns `503` otherwise, without internal details. |

## Reverse proxy

Put the app behind a TLS-terminating reverse proxy, and do not expose port 3000 directly:

- **Client address:** the outermost proxy must **overwrite** `X-Forwarded-For` with the connecting client's address (per-IP sign-in and signup limits rely on it). Appending to a client-supplied header lets clients choose their own address.
- **Server-Sent Events** (`/api/cases/*/events`): no response buffering or caching, and an idle timeout above the app's 20-second heartbeat. Clients reconnect and resynchronize automatically when a proxy closes a stream (some platforms cap requests at 15 minutes).
- **Upload size:** allow request bodies of at least 11 MB on `/api/cases/*/documents`.

Example for nginx:

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $remote_addr;   # overwrite, do not append
  proxy_set_header Connection "";
  client_max_body_size 12m;
}

location ~ ^/api/cases/[^/]+/events$ {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $remote_addr;
  proxy_set_header Connection "";
  proxy_buffering off;
  proxy_cache off;
  proxy_read_timeout 75s;
}
```

## Shutdown and background jobs

The server exits on `SIGTERM`. Document processing and `@AI` answers run after the response (`after()`) and are **not durable**: a job interrupted by a stop or crash is lost. The document then stays in `PROCESSING`. Its AI budget reservation keeps its slot until the next reservation in the deployment finds its heartbeat silent for more than 2 minutes and closes it as failed (the units stay counted). Avoid deploying while AI jobs are running; a durable job queue is planned.

## Scaling

Run **one web replica** for now. A second replica works for realtime (PostgreSQL `NOTIFY` reaches every process), but:

- the burst, sign-in and upload limits are counted per process, so each replica multiplies them;
- presence ("who is online") is per process and only approximate across replicas;
- local file storage is per container, so you must use S3 storage.

AI daily budgets, organization membership limits and all clinical workflows are enforced in the database and are safe across replicas. Budget the database connections: each process uses its Prisma pool, one `LISTEN` connection, and one short-lived connection while a readiness probe runs (concurrent probes in a process share it).

## Backups

Back up both the database (`pg_dump` or the provider's point-in-time recovery) **and** the uploaded originals (bucket versioning or volume snapshots); one without the other is incomplete. Rehearse a restore into a separate environment before relying on it. The audit log is append-only by design, so restores must not be "cleaned up" by deleting audit rows.

## Checklist before others can reach a deployment

- [ ] TLS, a trusted proxy that overwrites `X-Forwarded-For`, and no direct access to port 3000
- [ ] `AUTH_SECRET` set; `DEMO_LOGIN="false"`; the database was never seeded
- [ ] `SOURCE_CODE_URL` points to the code you run
- [ ] S3 bucket (private) or a persistent, backed-up volume for originals
- [ ] `PUBLIC_SIGNUP` and AI budgets reviewed; provider spending limits set if a paid key is used
- [ ] Database and storage backups configured and a restore rehearsed
- [ ] `/api/ready` used by the load balancer; logs collected; someone receives alerts
