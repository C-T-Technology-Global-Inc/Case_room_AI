# Put the demo online (one server + Supabase)

This sets up a **password-protected online demo with synthetic data**: the app and an HTTPS proxy on one small server, the database on Supabase. Allow about an hour the first time. It is not a pilot setup for real patients: that needs the legal, security and hosting decisions in [DEPLOYMENT.md](DEPLOYMENT.md).

What the demo is:

- **Synthetic data only.** It reloads the demo patients every night and erases anything visitors added.
- **Behind a shared password** (asked by the browser before the app's own sign-in), so strangers cannot use it or upload files. You give the password to the people you invite.
- **Offline demo AI** by default (no API key, no cost); live AI is optional, with daily caps (see [Live AI](#live-ai-optional)). The demo accounts are listed on the sign-in page. Public signup is off.

> **Status:** run end to end on 2026-10-19 on a Google Cloud e2-medium (Ubuntu 24.04, x86) with a Supabase session pooler: migrations and the app verified the database certificate, Caddy obtained its certificate, and a browser check passed (site password, sign-in, realtime between two users, an @AI answer). Other providers should behave the same but were not tried.

Files: [`deploy/docker-compose.yml`](../deploy/docker-compose.yml), [`deploy/Caddyfile`](../deploy/Caddyfile), [`deploy/.env.example`](../deploy/.env.example), [`deploy/reset-demo.sh`](../deploy/reset-demo.sh).

## 1. Supabase (database)

1. Create a project at [supabase.com](https://supabase.com). Choose the region **Southeast Asia (Singapore)** and a long database password; save the password.
2. **Turn off the Data API.** Supabase exposes tables in the `public` schema through an automatic REST API; this app does not use it and does not protect its tables for it. In the project settings, under *Data API* (or *API*), disable it, or remove `public` from the exposed schemas.
3. In *Project Settings → Database → SSL Configuration*: turn on **Enforce SSL on incoming connections**, and **download the certificate**. Keep the file: it becomes `deploy/certs/supabase-ca.crt` on the server.
4. Click **Connect** at the top of the project and copy the **Session pooler** connection string (port 5432). Use the session pooler, not the transaction pooler (port 6543): live updates use PostgreSQL `LISTEN/NOTIFY`, which needs a session connection. The direct connection works too, but only over IPv6.
5. Optional: *Network Restrictions* to allow only your server's IP address, once you know it.

That string, with your password in it, is your `DATABASE_URL`. Add this ending, so the connection is encrypted and checked against the certificate from step 3:

```
?sslmode=verify-full&sslrootcert=/certs/supabase-ca.crt
```

If the password contains special characters, write them URL-encoded (`@` as `%40`, `:` as `%3A`, `/` as `%2F`, `#` as `%23`, `?` as `%3F`, `%` as `%25`), or choose a password of letters and digits only. Migrations use the same URL: the project converts its SSL options to the form Prisma reads.

A free Supabase project can be paused after a week without activity; the nightly reset below uses the database every day.

## 2. Server and domain

1. Rent a VPS with **Ubuntu 24.04 LTS**, **2 vCPU and 4 GB RAM** (building the app needs the memory), at least 30 GB disk, in the same region as the database. Any provider works, for example Google Cloud, DigitalOcean or Vultr, or a Vietnamese provider. Add your SSH key when creating it.
   - **Google Cloud:** tick *Allow HTTP traffic* and *Allow HTTPS traffic*, and promote the external IP to a static one (*VPC network → IP addresses*), or it can change when the machine restarts. The SSH user is the name at the end of the key you pasted, with `sudo`.
2. Point a domain or subdomain (for example `demo.your-company.com`) at the server: a DNS **A record** to its IPv4 address. Wait until `ping demo.your-company.com` shows that address.
3. Sign in (`ssh root@SERVER_IP`; prefix the commands with `sudo` as a non-root user), then:

```bash
# Minimal images can lack these
apt-get update && apt-get install -y git cron ufw

# Firewall: SSH and web only (the database is on Supabase, the app is reached through Caddy)
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable

# Docker (official packages)
curl -fsSL https://get.docker.com | sh

# With 2 GB of RAM instead of 4, add swap before building:
# fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## 3. Configure

```bash
git clone https://github.com/C-T-Technology-Global-Inc/Case_room_AI.git /opt/case-room
cd /opt/case-room/deploy
cp .env.example .env
nano .env                      # fill in every value (comments explain each one)
```

- Upload the Supabase certificate from your computer: `scp supabase-ca.crt root@SERVER_IP:/opt/case-room/deploy/certs/supabase-ca.crt`
- `AUTH_SECRET`: the output of `openssl rand -base64 32`.
- The site password hash: `docker run --rm caddy:2 caddy hash-password --plaintext 'the-password-you-will-share'`. Paste it into `DEMO_PASSWORD_HASH` **between single quotes** (`'$2a$14$...'`), as in the example; with double quotes Docker Compose would treat each `$` as a variable.
- `chmod 600 .env` so only root can read it.

## 4. Start

```bash
docker compose up -d --build   # builds the images (several minutes), runs migrations, starts the app and HTTPS
docker compose ps              # migrate "exited (0)", web "healthy", caddy "running"
./reset-demo.sh                # loads the synthetic demo data
```

Open `https://demo.your-company.com`: the browser asks for the site password, then the sign-in page lists the demo clinicians (password `demo1234`).

If something fails:

```bash
docker compose logs migrate    # database connection or migration problems
docker compose logs -f web     # the app
docker compose logs caddy      # certificate problems: check the DNS record and that ports 80/443 are open
```

- `self-signed certificate in certificate chain` or `unable to verify`: the file in `deploy/certs/` is not Supabase's certificate, or the path in the URL is wrong.
- `P1011 ... TLS` from migrate: the same certificate problem, seen by Prisma.
- `P1011 ... The certificate was not trusted` when running Prisma **on a Mac** against Supabase: macOS rejects Supabase's pooler certificate (valid for five years, no extended key usage) under Apple's own rules, while OpenSSL, which the app and the Linux containers use, accepts it. Run migrations from the server as described here, not from a Mac; on the Linux server they verify the certificate normally.
- `ENETUNREACH` or a timeout to `db.*.supabase.co`: that is the IPv6-only direct connection; use the session pooler string.

## 5. Nightly reset

```bash
crontab -e
# 03:00 Vietnam time (20:00 UTC): reload the demo data
0 20 * * * /opt/case-room/deploy/reset-demo.sh >> $HOME/case-room-reset.log 2>&1
```

## 6. Updates

```bash
cd /opt/case-room && git pull
cd deploy && docker compose up -d --build   # new migrations run before the new app starts
```

Before each update that others will reach, check for Next.js security releases ([DEPLOYMENT.md](DEPLOYMENT.md#security-updates)); the project must be on the latest patched release.

## Live AI (optional)

The demo uses the offline engine unless `deploy/.env` turns on a provider. With live AI, **everyone who has the site password spends on your key**, so:

1. In the [Anthropic console](https://console.anthropic.com), set a **monthly spending limit** first: it is the hard ceiling.
2. Check the output on your own computer first (`npm run ai:live-check`, see [CONTRIBUTING.md](../CONTRIBUTING.md)).
3. Add to `deploy/.env`:

   ```bash
   AI_PROVIDER="anthropic"
   ANTHROPIC_API_KEY="sk-ant-..."
   ```

4. `docker compose up -d` restarts the app with it.

The app also caps usage, counted in the database: by default 40 AI requests a day for the whole demo, 4 a minute per user and 2 at a time (`AI_DAILY_REQUESTS_TOTAL`, `AI_REQUESTS_PER_USER_PER_MINUTE`, `AI_CONCURRENT_RUNS_PER_ORG` in `deploy/docker-compose.yml`; override them in `deploy/.env`). Uploading a document also runs AI. The data sent to the provider is the synthetic demo data. To go back to the offline engine, set `AI_PROVIDER="demo"` and run `docker compose up -d`.

## Rules for this demo

- **Never enter real patient information.** The data is erased nightly and the demo accounts' password is public.
- Share the site password only with the people you invite; change it (new hash in `.env`, then `docker compose up -d caddy`) when you want to cut access.
- With live AI, give the site password only to people you are happy to pay for, and keep the spending limit in place.
