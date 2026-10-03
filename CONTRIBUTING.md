# Contributing to Clinical Case Room

Thank you for helping. Bug reports, ideas, documentation and code are all welcome. This guide explains how to set up the project, what every pull request needs, and the few rules that matter more here than in most projects.

## Three rules first

1. **Synthetic data only.** Never put real patient data in code, tests, fixtures, issues, pull requests, screenshots or logs. This includes data that "looks anonymized": names, dates of birth, record numbers, free-text notes or images from real people. Use the bundled synthetic patients or invent new ones. Pull requests or issues with real patient data are closed and their content removed.
2. **The AI never makes a clinical decision.** The AI may organize, summarize, cite and suggest. It must not diagnose, prescribe, select treatments, place orders or approve anything. Decisions, briefs and handoffs become final only through an authenticated human approval, and AI statements must cite records of the case (unverifiable citations are dropped). Changes that touch these guarantees need an issue and a discussion before code.
3. **Security problems are reported privately.** Do not open a public issue for a vulnerability; follow [SECURITY.md](SECURITY.md).

## Before you start

- For a small fix (typo, clear bug, missing test), open a pull request directly.
- For a feature, a behavior change, a new dependency or a schema change, open an issue first so we can agree on the approach before you spend time on it.
- Look for issues labeled `good first issue` if you are new to the codebase.

## Set up

Prerequisites: **Node.js 22.18 or later** (see `.nvmrc`) and **PostgreSQL 16** (installed locally, or `docker compose up -d postgres`).

```bash
cp .env.example .env            # set DATABASE_URL and AUTH_SECRET (openssl rand -base64 32)
npm install                     # install workspace dependencies
npm run setup                   # Prisma client, migrations, synthetic demo data
npm run dev                     # http://localhost:3000, demo password demo1234
```

No AI provider key is needed: without `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` the app uses the offline demo engine. Never commit keys or your `.env`.

`README.md` describes the demo accounts, and `docs/ARCHITECTURE.md` and `docs/AI.md` describe how the system fits together. Read the *Concurrency* and *Abuse limits* sections of the architecture document before changing services.

## Checks

Every pull request runs these in CI, and they must pass:

```bash
npm run lint
npm run typecheck
npm test                        # unit tests
npm run build
npm run test:integration        # services against PostgreSQL
```

Integration tests need a separate database whose name ends in `_test`, because they erase it:

```bash
createdb clinical_case_room_test
# in .env:
TEST_DATABASE_URL="postgresql://USER@localhost:5432/clinical_case_room_test"
```

The test configuration refuses to run against a database that is not named `*_test` or that is the same as `DATABASE_URL`.

## Writing code

- **Language:** TypeScript, strict. Code, comments, UI text and documentation are in English.
- **Style:** match the surrounding code (naming, comment density, file layout). ESLint and TypeScript are the arbiters; there is no separate formatter step.
- **Where logic lives:** business logic goes in `apps/web/src/server/services`. Every service checks authentication, the role permission (`assertCan`) and case access (`assertCaseAccess`), and writes its audit row in the same transaction as the change. Server actions and route handlers stay thin.
- **Concurrency:** workflows that read, check and write lock the row they depend on with `lockRow`, in the documented order (`Identity` → `Organization` → `Invitation`, and `CaseRoom` → `Decision` / `CaseBrief`). Model calls never run inside a transaction. A test for a race must hold work in flight (for example with a pending promise); a test that only runs requests one after another does not prove anything about concurrency.
- **Database changes:** edit `packages/database/prisma/schema.prisma` and add a migration (`npm run db:migrate`). Migrations must preserve existing data.
- **AI changes:** keep case data out of the system prompt, keep citations resolvable through the `SourceRegistry`, and add tests with the fake LLM client in `packages/ai`. Prompts must not ask the model to decide, diagnose or prescribe.
- **Tests:** add or update tests for what you change. Bug fixes should come with a test that fails without the fix.

## Pull requests

- Keep each pull request focused on one change, and explain **what** changed and **why**.
- Link the issue it resolves.
- For UI changes, add before/after screenshots that show synthetic data only.
- Fill in the pull request checklist.
- Expect review comments; the maintainer may ask for changes or tests before merging.

### Sign your commits (DCO)

Every commit must be signed off under the [Developer Certificate of Origin](https://developercertificate.org/): by adding a `Signed-off-by` line you certify that you wrote the change or otherwise have the right to submit it under the project's license.

```bash
git commit -s -m "Fix stale approval message"
```

This adds `Signed-off-by: Your Name <you@example.com>` using your Git name and email. CI checks that every commit in a pull request has it. To sign off commits you already made: `git rebase --signoff main`, then force-push your branch.

## License

Clinical Case Room is licensed under the [GNU Affero General Public License v3.0](LICENSE). By contributing, you agree that your contributions are licensed under the same license.
