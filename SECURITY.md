# Security policy

Clinical Case Room handles (synthetic) clinical records, access control between care teams and organizations, and human sign-off of clinical decisions. Security reports are taken seriously.

## Reporting a vulnerability

**Do not open a public issue, discussion or pull request for a vulnerability.**

Report it privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Include:

- what the problem is and its impact (for example, which data or action becomes reachable, by whom);
- steps to reproduce, using the bundled synthetic data or your own synthetic data only;
- the commit or version you tested.

You can expect an acknowledgment within 7 days. We will keep you informed while we work on a fix, agree on a disclosure date with you, and credit you in the advisory unless you prefer otherwise.

## Supported versions

The project is a pre-1.0 MVP. Only the latest commit on the `main` branch receives security fixes.

## Scope

In scope, for example:

- reading or changing data of a case, organization or member without the required membership or role;
- approving or finalizing a decision, brief or handoff without the required human review, or approving content the reviewer was not shown;
- the AI presenting a fabricated source or quote as verified;
- prompt injection that makes the application perform an action or disclose data beyond the requester's access;
- authentication, session, invitation, upload and file-serving flaws;
- bypasses of rate limits or AI budgets with real impact.

Out of scope:

- the demo accounts and their published password (`demo1234`): they are public by design and must never exist on a real deployment (see below);
- findings that require a compromised server, database or browser;
- volume-based denial of service, and missing hardening that only affects local development;
- social engineering.

## Deploying safely

This software is **not a medical device**. Running it with real patient data requires your own legal, privacy and clinical-safety assessment. At minimum:

- never run `npm run setup` or `npm run db:seed` against a deployment that others can reach: the seed creates accounts with a known password. Set `DEMO_LOGIN="false"`;
- serve the app over TLS behind a trusted reverse proxy that overwrites `X-Forwarded-For`, and do not expose the app port directly (per-address limits rely on that header);
- use a long random `AUTH_SECRET`, keep `.env` out of version control and images, and store uploaded originals in private object storage;
- review `PUBLIC_SIGNUP` and the AI budget settings in `.env.example` before connecting a paid AI provider;
- remember that AI providers receive the case text sent to them; decide whether that is permitted for your data.
