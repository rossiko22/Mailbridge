# Mailbridge

Self-hosted web mail client: Outlook (Microsoft Graph) and Gmail (Gmail API) in one inbox.
The owner reviews, tests and documents; Codex writes the code. The owner is learning security (goal: pentesting), so explain the security reasoning behind changes.

## Stack
- Node 24, TypeScript (strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes), ESM
- Express 5, PostgreSQL 18 with raw parameterized SQL (`pg`), migrations: node-pg-migrate SQL files
- Sessions: express-session + connect-pg-simple (table `sessions`)
- Frontend: vanilla JS in `public/`, no build step, strict CSP (no inline script or style)
- Tests: `node --test` + tsx; Playwright for browser tests
- Deploy (last phase): Docker image on GHCR → Contabo VPS (Docker Compose + Caddy)

## Repo layout
- `src/app.ts` wiring · `src/server.ts` entry · `src/config/` env + DB pool
- `src/modules/<name>/` schemas / routes / service / repository (factory functions, dependencies injected; see docs/architecture.md)
- `src/http/` error codes (`errors.ts`) and Zod helpers (`validate.ts`)
- `src/integrations/mail/` provider abstraction (MailClient, MailProvider, CredentialStore, registry)
- `src/integrations/{gmail,outlook}/` provider implementations
- `src/security/` Argon2id passwords, AES-256-GCM token vault
- `src/middleware/` auth, same-site JSON (CSRF), security headers + throttle, errors, session
- `database/migrations/` `NNN_name.sql` with `-- Up Migration` / `-- Down Migration`
- `tests/*.test.ts` unit · `tests/integration/` real Postgres · `tests/e2e/` Playwright · `tests/support/harness.ts`
- `contracts/openapi.yaml` API contract (Redocly rules in `redocly.yaml`) · `docs/` analysis, architecture, adr/ · `deploy/` Caddyfile and scripts

## Commands
- `npm run dev`: start with reload (needs `docker compose up -d postgres mailpit`)
- `npm run migration` / `npm run seed`: migrate / load demo data (demo@example.test)
- `npm run lint` (Biome) · `npm run typecheck` (source, tests, browser scripts) · `npm test` · `npm run test:integration` · `npm run test:e2e` · `npm run test:e2e:firefox` · `npm run test:coverage` · `npm run test:mutation [-- <name>]`
- `npm run check`: lint + typecheck + unit tests + build
- `npm run migration -- down <n>`: roll back the last n migrations (every migration after 008 must roll back)
- Integration and e2e tests use `<POSTGRES_DB>_test`, which is created automatically
- Lint the contract: `docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD:/spec" -w /spec redocly/cli:2.62.0@sha256:4497cdb4450ed434c72821419af114ffdafa7e5bd966ade394adc50176261545 lint`
- gitleaks on staged changes before every commit (call docker directly, never through a shell variable; zsh will not split it):
  `docker run --rm -v "$PWD:/repo" -w /repo zricethezav/gitleaks:v8.21.2@sha256:0e99e8821643ea5b235718642b93bb32486af9c8162c8b8731f7cbdc951a7f46 protect --staged --redact -v`

## Non-negotiables
- Never weaken: Argon2id, the token vault (AES-GCM with the account ID as AAD), the same-site JSON check, the sandboxed mail iframe and its CSP, the SSRF allowlists, `redirect: 'error'` on outbound fetches, size-limited downloads, send idempotency, the fetch-blocking test harness, container hardening.
- All SQL is parameterized. Every query on user data is scoped by `user_id`; another user's data answers 404.
- Validate all input at the edge with Zod (`parse()` in src/http/validate.ts). Error shape: `{"error":{"code","message"}}`, never internals.
- API changes start in `contracts/openapi.yaml` and are reviewed by the owner before implementation.
- Never log or return mail content, passwords, tokens or credentials. The audit log is insert-only.
- No new dependency, service or shared library without asking. New ideas go to BACKLOG.md; do not build them unprompted.
- Never edit an applied migration; fix forward. No destructive migration without a written plan in the PR.
- No secrets in code, commits, logs or chat. Locally: `.env` (gitignored). Production: a root-owned 600 file or GitHub Environments.
- Never run anything against the server. Give the commands and explain them; the owner runs them.
- The frontend stays vanilla (ADR 0002) unless the owner decides otherwise.
- No database lock or pooled connection may be held across a provider call (ADR 0009).
- New security-critical logic gets an entry in tests/mutation/mutations.ts.

## Workflow
- Order of work: make the app optimized, secure and working first; deployment comes last (see docs/analysis.md §2).
- Plan first (plan mode) for anything non-trivial and wait for approval.
- One decision at a time: one question with options, the recommendation marked, plain-language what / why / risks.
- Keep changes small. Flag the security-sensitive parts of the diff first.
- Prefer simple, conventional code over clever code. Match the style of the surrounding code.

## Git rules
- Never commit to main. One branch per task: feat/ fix/ chore/ docs/ ci/ refactor/ test/
- Small Conventional Commits.
- Never `git push --force`, `git reset --hard` or delete branches without asking.
- Before committing: gitleaks on the staged changes, show `git diff --stat`, wait for approval.
- PR body: summary · security-sensitive parts to check first · how it was tested · risks · docs changed.

## Definition of Done
- Acceptance criteria met; contract updated.
- Every endpoint tested for success, unauthenticated (401), another user's data (404) and invalid input (400).
- Unit + integration (real Postgres) + browser e2e in Chromium and Firefox: keyboard-only use, phone width without horizontal scroll, no CSP violations, no unexpected console errors.
- Mutation script: every applied mutation in security- and logic-critical code is caught.
- Migrations tested up and down.
- Lint, types, tests and CI green (Semgrep, gitleaks, npm audit, Trivy, actionlint, Redocly).
- Docs updated: README, docs/architecture.md, an ADR for each real decision, SECURITY.md, BACKLOG.md, the commands in this file.
- Reviewed by the owner and merged.
