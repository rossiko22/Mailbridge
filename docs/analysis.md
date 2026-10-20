# Mailbridge: Phase 0 analysis

Status on 2026-10-20, branch `docs/phase-0-analysis`, based on commit `a4045fc`.
This document compares Mailbridge with the Outreach Tracker standards and proposes how to close the gaps. No code was changed while writing it.

## 0. Results of the existing checks (run locally)

| Check | Command | Result |
| --- | --- | --- |
| Types (app + tests) | `npm run typecheck` | Pass |
| Unit tests | `npm test` | 53 / 53 pass |
| Unit + integration, with coverage gates | `npm run test:coverage` (Postgres 18 in a throwaway container) | 101 / 101 pass. Lines 93.7 %, branches 81.0 %, functions 90.0 %, all above the gates (90 / 75 / 85) |
| Browser (Chromium only) | `npm run test:e2e` | 9 / 9 pass |
| Migrations up | `npm run migration` on an empty DB | Pass (001 → 009) |
| Migrations down | node-pg-migrate `down` | 009 down + up: pass. 008 down: refuses by design (`RAISE EXCEPTION`). 001 has no `Down` section |
| Dependency audit | `npm audit` | 0 vulnerabilities |

Weakest coverage: `outlook/provider.ts` (42 % lines: the MSAL flow is never exercised), `mailer.ts` (68 %), `config/env.ts` (81 % lines, 50 % branches: the production checks are untested).

---

## 1. Deviations from the standard, ordered by how much they matter

### Keep: already better than the standard

These stay as they are. The migration work must not weaken them.

- **Provider abstraction**: `MailClient` / `MailProvider` / `CredentialStore` in `src/integrations/mail/types.ts`, plus `registry.ts`. Adding IMAP later means adding one provider; nothing else changes.
- **Hand-built security**:
  - Argon2id (`src/security/password.ts`), including a decoy hash so response timing doesn't reveal registered addresses (`users.service.ts:12`).
  - AES-256-GCM token vault with the account ID as AAD (`src/security/token-vault.ts`).
  - Same-site JSON CSRF defence (`src/middleware/json.middleware.ts`).
  - Sandboxed mail iframe with its own CSP (`src/modules/emails/presentation.ts`).
  - SSRF host and path allowlists on stored Graph cursors (`src/integrations/outlook/graph.ts:84`).
  - `redirect: 'error'` on every outbound fetch, and bounded downloads (`src/integrations/mail/http.ts`).
- **Fetch-blocking test harness** (`tests/support/harness.ts`): any unexpected outbound request fails the test, and tests get their own `_test` database.
- **Send idempotency**: request IDs are reserved before the provider call, with an explicit `unknown` state (`emails.repository.ts:74`, `emails.service.ts:111`). Your standard doesn't ask for this; keep it.
- **Small dependency footprint**: 10 runtime dependencies, no frontend build.
- **Container hardening**: non-root user, `read_only`, `cap_drop: ALL`, `no-new-privileges`, an internal-only DB network, and a smoke test that refuses a root image (`deploy/smoke-test.sh`).
- **CI extras you don't require**: CodeQL `security-extended`, `dependency-review-action`, build provenance attestation, and the image smoke test.
- **TypeScript is stricter than "strict"**: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`.

### High: affects correctness, security or every later step

| # | Deviation | Where | Why it matters |
| --- | --- | --- | --- |
| H1 | **No schema validation library.** Every handler checks `req.body` by hand, each in its own style | `auth.controller.ts:30-56, 83-88`, `users.controller.ts:12-16`, `emails.routes.ts:31-40, 47-53, 94-99`, `accounts.routes.ts:83` | Hard to review. Easy to miss a field. Rules are duplicated (`MAX_DISPLAY_NAME` is imported from a controller into another controller). Nothing produces a contract |
| H2 | **Error responses have no stable code.** Shape is `{ message }`, written from about 40 places. Unknown routes fall through to Express' HTML 404 | `error.middleware.ts`, every controller and route, `security.middleware.ts:49`, `json.middleware.ts:7` | Clients and tests match on English text. The standard requires `{"error":{"code","message"}}` |
| H3 | **No OpenAPI contract** (`contracts/`), so no Redocly lint | none | API changes can't be reviewed before implementation |
| H4 | **Real IP will be wrong behind Cloudflare.** `trust proxy` is fixed at 1 hop. With Cloudflare → Caddy → app, `req.ip` becomes a Cloudflare edge address | `src/app.ts:29`, `deploy/Caddyfile` | Per-IP throttles (`app.ts:57-60`) would be shared by everyone behind the same edge, so one attacker could lock out all sign-ins. Audit IPs would also be useless. **Must be fixed before the VPS deploy** |
| H5 | **Credential lookup holds a DB transaction and row lock across network calls.** Every Gmail/Graph API call runs `getToken()`, which opens `BEGIN … SELECT … FOR UPDATE`. While a refresh is in flight (timeout 30 s), the pool connection stays checked out | `accounts.repository.ts:76-91`, `gmail/provider.ts:56`, `outlook/provider.ts:50` | With pool `max: 10` (`config/database.ts:11`), a few slow refreshes during sync can starve the pool. Every request then waits up to 5 s and fails. Availability risk once there are several users |
| H6 | **CI scans missing**: Semgrep, gitleaks (full history), Trivy image + config, actionlint, Redocly. **Actions are pinned by tag** (`@v4`), not SHA. **Images aren't pinned by digest** (`postgres:18-alpine`, `caddy:2-alpine`, `node:24-bookworm-slim`, `axllent/mailpit:latest`, `dpage/pgadmin4:9`) | `.github/workflows/*.yml`, `Dockerfile`, both compose files | Supply-chain integrity. A moved tag can change what runs in CI with `packages: write` and `id-token: write` |
| H7 | **No lint or formatter.** Quote style, import brace spacing and indentation are mixed, even within one file | `src/app.ts:1-24`, `users.repository.ts`, `001_create_users.sql` | Noise in every diff you review |
| H8 | **Audit log isn't insert-only.** The app role can `UPDATE`/`DELETE`. The app deletes rows itself for retention, and `ON DELETE CASCADE` erases a user's history | `modules/audit/audit.ts:32-35`, `009_audit_events.sql:8` | An attacker with the app's DB credentials can erase their tracks. The standard says insert-only |

### Medium: consistency and the Definition of Done

| # | Deviation | Where |
| --- | --- | --- |
| M1 | **Three module styles at once.** (a) `users.repository.ts` exports module functions that import the **global `pool`**; `auth.middleware.ts`, `users.service.ts` and `auth.service.ts` take `typeof repository` (the module itself). (b) `accounts` and `emails` use factories with an injected `pool` ✓. (c) `auth` and `users` have controllers; `accounts` and `emails` put handlers inline in the routers. `session.middleware.ts` and `app.ts` also import the global pool. `emails.service.ts` runs raw SQL itself (`:36`, `:57`, `:80`, `:84`) instead of going through the repository | `src/modules/**`, `src/middleware/session.middleware.ts:4`, `src/app.ts:13` |
| M2 | **Logging is hand-rolled `console.log(JSON.stringify(…))`.** Request logs exist only in production, there are no levels, and `server.ts`, `database.ts` and `migrate.ts` print plain text. The request ID is generated but not used as a log binding | `security.middleware.ts:9-15`, `server.ts:9`, `database.ts:18,28`, `error.middleware.ts:30` |
| M3 | **OFFSET pagination**, plus search as `strpos(lower(subject‖sender‖body_text))`: a sequential scan of every cached body on every keystroke | `emails.repository.ts:36-48`, `emails.routes.ts:32` |
| M4 | **Browser tests run Chromium only.** No Firefox, no keyboard-only test. CSP violations and console errors **are** checked (`tests/e2e/app.test.ts:24-27,40`). Phone width is checked once (`:151`) | `tests/e2e/app.test.ts`, `ci.yml:578` |
| M5 | **No mutation testing** | none |
| M6 | **Migrations aren't tested down in CI.** `001` has no `Down` section. `008` is deliberately irreversible (documented, fine) | `database/migrations/001_create_users.sql`, `ci.yml:541-543` |
| M7 | **Env config is checked by hand** (not a Zod schema), and two places read `process.env` directly, bypassing `env` | `config/env.ts`, `json.middleware.ts:4`, `app.ts:29`, `security.middleware.ts:9,23` |
| M8 | **Missing docs**: `CLAUDE.md`, `BACKLOG.md`, `docs/architecture.md`, `docs/adr/`. README and SECURITY.md exist and are good | repo root, `docs/` |
| M9 | **Production compose builds on the server** (`build: .`, `image: ticket-mail:local`) instead of pulling a GHCR digest. Migrations aren't a one-shot service | `compose.production.yaml:20-21` |
| M10 | **Optimistic locking (`version` + 409)**: nothing in Mailbridge needs it *today*. The only shared mutable things are the display name (last write wins, harmless) and the read flag (idempotent, and the provider is the source of truth). It becomes necessary with drafts, labels, rules and settings. I recommend adding it then, not retrofitting it now. This needs your decision | — |

### Low: hardening and small findings from reading the code

| # | Finding | Where | Suggested fix |
| --- | --- | --- | --- |
| L1 | GCM auth tag length isn't enforced on decrypt. Node accepts truncated tags (4–16 bytes) unless `authTagLength` is set, which weakens integrity. Only exploitable by someone who can already write to the DB | `token-vault.ts:18-20` | `createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 })` plus a test |
| L2 | Ciphertexts have no key ID or version, so rotating `TOKEN_ENCRYPTION_KEY` forces every user to reconnect every mailbox | `token-vault.ts:13` | `v1.<iv>.<tag>.<data>` format plus an optional `TOKEN_ENCRYPTION_KEY_PREVIOUS` for rolling re-encryption |
| L3 | SMTP on port 587 with `secure:false` and no `requireTLS`. A network attacker can strip STARTTLS and read reset links | `integrations/mailer.ts:28-31` | `requireTLS: true` whenever not `secure` (production) |
| L4 | Session cookie is named `session`. A `__Host-` prefix pins it to the exact host, HTTPS only, `Path=/` | `session.middleware.ts:11` | `__Host-mailbridge` in production |
| L5 | The throttle runs `DELETE FROM login_attempts …` on **every** throttled request | `security.middleware.ts:52` | Prune at most once a minute, like `audit.ts` does |
| L6 | `sessions.sess` is `JSON` and revocation filters on `sess->>'userId'` (a full scan) | `002_create_sessions.sql`, `users.repository.ts:20,111` | When the session-list feature comes: add a `user_id` column and an index |
| L7 | The logout route repeats the same-site check that already runs globally | `auth.routes.ts:25-27` | Remove during the validation step |
| L8 | `/health` runs `SELECT 1` but doesn't report migration level. If it fails, the generic 500 handler answers | `app.ts:83-86` | Separate `/health` (liveness) and `/ready` (DB + schema) |
| L9 | `HSTS` lacks `includeSubDomains`. That's fine while the apex hosts other things; decide during the domain step | `security.middleware.ts:23` | — |
| L10 | A Dependabot branch for a Node 26 base image exists although majors are ignored (likely opened before the ignore rule) | `origin/dependabot/docker/node-26-bookworm-slim` | Close it |

### On `helmet`

The headers are hand-written (`security.middleware.ts:16-23`), tested (`tests/integration/security.test.ts:12-31`), and stricter than helmet's defaults: `default-src 'self'` with no inline styles, `frame-ancestors 'none'`, and `Cache-Control: no-store`. You prefer visible mechanics, so I recommend **keeping them and recording an ADR**. Adding helmet would change little but cost one dependency and hide what's sent. It's your call (asked in §7).

---

## 2. Migration plan (app working and tests green at every step)

Each step is one branch and one PR, small enough to review.

**Step 1: Foundations (no behaviour change)**
1. `docs/claude-md`: add `CLAUDE.md`, `BACKLOG.md`, `docs/architecture.md`, and `docs/adr/0001-record-architecture-decisions.md` plus ADRs for decisions already made (vanilla frontend, hand-written headers, provider abstraction, server sessions in Postgres).
2. `chore/rename-leftovers`: the code-only part of §3. No data is touched.
3. `chore/lint-format`: add ESLint (typescript-eslint `strict-type-checked`) and Prettier, or Biome (you decide). The first commit adds config plus `npm run lint`/`format:check`. A **separate** commit has the mechanical reformat, so your review of real changes isn't buried. Fix lint findings in small follow-ups.
4. `ci/pin-and-scan`: pin all actions by SHA and images by digest. Add jobs for gitleaks (full history), Semgrep (`p/javascript p/typescript p/owasp-top-ten p/secrets p/dockerfile`), Trivy image + config, and actionlint. Each runs as a pinned Docker image.
5. `refactor/module-style`: one pattern everywhere, shown below. Order: `users.repository` → factory with `pool` (removes the global import), then `session.middleware` takes `pool`, then `emails.service` SQL moves into the repository. Tests stay green because the routes don't change.

```
modules/<name>/
  <name>.schemas.ts     Zod schemas (step 2)
  <name>.repository.ts  createXRepository(pool)          SQL only
  <name>.service.ts     createXService({ repo, ... })    rules, transactions
  <name>.routes.ts      createXRouter({ service, auth }) parse → call → respond
```

`src/app.ts` becomes `createApp(deps)` and `server.ts` creates the pool. That lets tests inject their own pool instead of relying on import order.

**Step 2: Contract, validation, errors (one module per PR)**
1. `feat/error-codes`: introduce `AppError(code, status, message)` and the `{"error":{"code","message"}}` shape in `error.middleware.ts`, plus a JSON 404 for unknown API paths. **The frontend reads `data.error?.message ?? data.message`** during the transition (`public/js/core.js:15`), so nothing breaks.
2. `contracts/openapi.yaml` + Redocly lint in CI. I write it for one module, you review it, then I implement.
3. Per module, in this order: `auth` → `users` → `accounts` → `emails`. Write Zod schemas from the contract, replace the hand checks, and add tests for success / 401 / other user's data = 404 / invalid input on every endpoint.
4. Env config moves to a Zod schema (`config/env.ts`). The production rules stay identical, and the missing branch tests are added.
5. Logging (`pino` + `pino-http`, needs your OK): request ID as the log binding, redaction of `authorization`, `cookie`, `password*`, `token*` and `credentials`. Remove the hand-written request log.

**Step 3: Security hardening** (each with tests, and migration up/down tests where a migration is involved)
- L1 GCM tag length, L2 token vault key versioning.
- L3 SMTP `requireTLS`, L4 `__Host-` cookie, L5 throttle pruning, L7 duplicate logout check, L8 `/health` + `/ready`.
- H8: insert-only audit. A trigger rejects `UPDATE`/`DELETE` except from a separate `mailbridge_maintenance` role that runs retention; user deletion keeps rows with `user_id` nulled.
- M4/M5: Firefox + keyboard-only e2e, then the mutation script on the security-critical code.

**Step 4: Performance and robustness**
- H5: read and decrypt credentials **without** holding a lock. Only take the row lock (with `NOWAIT`/short timeout) when a refresh is needed, and re-check inside the lock. Plus an in-process single-flight per account.
- M3: keyset pagination `(received_at, email_id)`, then full-text search (`tsvector` + `pg_trgm`).
- Frontend: measure first (Lighthouse/Playwright timings), then fix what shows up (caching of static assets with hashed names, fewer requests on inbox load).

**Step 5: Features from the roadmap** (§4), in the order you choose.

**Step 6: Deployment, last** (Phases 1–3: deployment doc, server setup, CI/CD, server security)
- H4 real client IP (Caddy `trusted_proxies` with Cloudflare ranges, then `trust proxy` set to Caddy only).
- M9 compose pulls `ghcr.io/rossiko22/mailbridge@sha256:…`, with a `migrate` one-shot service.

**Leave alone:**
- Migrations 001–009 stay as written. They're applied history. Fix forward with new migrations.
- `presentation.ts` sanitizer rules.
- The Gmail quota logic (until server-side sync).
- The frontend architecture (see §7).

---

## 3. "Ticket Mail" leftovers and the rename plan

| Leftover | Where | Risk of renaming |
| --- | --- | --- |
| npm package name `ticket-mail` | `package.json:2`, `package-lock.json` | None |
| localStorage key `ticket-mail-theme` | `public/js/theme.js:3` | Users lose their theme choice. Read the old key once, write the new one |
| Compose project `name: ticket-mail`, image `ticket-mail:local` | `compose.production.yaml:1,21` | **Data risk.** Compose prefixes volumes with the project name (`ticket-mail_pgdata`). Renaming the project on a running deployment starts Postgres on a new, empty volume |
| DB name and user `ticket_mail` | `.env-example:12-13`, `.env.production.example:13-14`, `render.yaml:315-316` | **Data risk** for any existing database |
| Container, volume and network names `ticket-mail-*`, `ticket_mail_*` | `.env-example:15-26` | Your local dev volume |
| Backup filename `ticket-mail-…dump` | `deploy/backup.sh:6` | None |
| Example domain `tickets.your-domain.example` | `.env.production.example:4-5,20-21` | None |
| IntelliJ module `Okta-Ticketing-System.iml`, old paths | `.idea/` (gitignored, local only) | None. Close the IDE, delete `.idea/`, reopen |
| Comments mentioning tickets | migrations `004`, `008` | **Don't touch.** They're history |
| Test fixture id `ticket-1` | `tests/eml.test.ts:4` | Cosmetic |

**Safe order:**
1. **Code only** (step 1.2): package name, theme key with fallback, backup filename, example files, test fixture.
2. **Production names: decide before the first VPS deploy.** The VPS has no data yet, so the new deployment starts directly with project `mailbridge`, DB `mailbridge` and user `mailbridge`. **No data plan is needed for the VPS.**
3. **Render** (if a Render deployment with real users exists): leave `render.yaml` names as they are. Renaming a Render database means creating a new one. If you move to the VPS, migrate with `pg_dump -Fc` from Render → `pg_restore --no-owner --role=mailbridge` on the VPS, verify row counts, then switch DNS. I'll write that as a separate plan if needed. Question in §7.
4. **Your local dev database**: the example files change, but your own `.env` keeps working as is. Two options to switch: (a) throw the dev DB away and re-seed (simplest; it's demo data), or (b) `ALTER DATABASE ticket_mail RENAME TO mailbridge; ALTER ROLE ticket_mail RENAME TO mailbridge;`. Note that renaming a role clears MD5 passwords but not SCRAM; Postgres 18 uses SCRAM by default. Then update `.env`.

---

## 4. Feature roadmap (value ÷ effort)

| Rank | Feature | Value | Effort | Architecture it needs |
| --- | --- | --- | --- | --- |
| 1 | **Keyset pagination** | Med | S | `(received_at, email_id)` cursor encoded as opaque base64url, row comparison `WHERE (received_at, email_id) < ($1,$2)`. Index exists (`emails_account_received`); add a user-wide one via `mail_accounts` join or denormalized `user_id` |
| 2 | **Archive / delete / move** | High | M | `MailClient.move(id, target)`: Graph `/move`, Gmail `modify` labels. The idempotent outgoing pattern doesn't apply (moves are idempotent by nature). Local row removed optimistically, restored on error |
| 3 | **Full-text search** | High | M | `tsvector` generated column on `subject‖sender‖body_text` with a GIN index for words, and `pg_trgm` GIN on `subject`/`sender_address` for partial matches. Migration must use `CREATE INDEX CONCURRENTLY` (outside a transaction, so `singleTransaction:false` for that file) |
| 4 | **Session list + sign out other sessions** | High (security) | S–M | `sessions.user_id` column + index, written by a small session-store wrapper. Store `created_at`, `ip`, `user_agent` at sign-in. Endpoint lists/deletes only own sessions |
| 5 | **Email verification** | High (closes account-takeover gap in SECURITY.md) | M | `email_verifications` table (hashed token, like `password_resets`), `users.email_verified_at`. Unverified users can't connect mailboxes |
| 6 | **2FA: TOTP first, then passkeys** | High | M / L | TOTP: secret encrypted with the token vault, recovery codes hashed with Argon2, second step in the session (`pendingSecondFactor`). Passkeys: WebAuthn, which needs a library (ask). RP ID = your domain |
| 7 | **Folders / labels** | High | M–L | `mail_folders` (account_id, provider_folder_id, kind, name), `emails.folder_id`. Sync per folder: Graph delta per folder, Gmail history with label changes (already partly handled) |
| 8 | **Threading** | Med | M | `emails.thread_key`: Gmail `threadId`, Graph `conversationId`. Group in list query |
| 9 | **Account deletion + data export** | Med (GDPR) | S–M | Delete: revoke provider tokens (Google `/revoke`; Microsoft can't be revoked server-side, so tell the user), cascade delete, keep anonymized audit rows. Export: JSON of profile + accounts (no tokens) + audit |
| 10 | **Server-side background sync** | High | L | Worker process (same image, `node dist/worker.js`) with a job table using `FOR UPDATE SKIP LOCKED`. Moves sync off the browser. Requires the quota budget to move to Postgres (see risks) |
| 11 | **Provider push** | Med | L | Graph change-notification subscriptions (public HTTPS webhook with `clientState` secret; message subscriptions last at most ~7 days, so renew daily); Gmail `users.watch` → Google Pub/Sub topic → push endpoint with OIDC-verified JWT (renew every 7 days). Both feed the worker queue. Needs #10 |
| 12 | **Notifications** | Med | M | Web Push (VAPID keys, service worker; CSP needs `worker-src 'self'`). Needs #10/#11 to be useful |
| 13 | **Drafts** | Med | M | Provider-side drafts (Graph `/messages` with `isDraft`, Gmail `drafts`). Local `version` column, **the first real use of optimistic locking (409)** |
| 14 | **Rich compose + attachments** | High | L | Sanitized HTML compose (same allowlist as reader), multipart MIME builder for Gmail, Graph upload sessions for >3 MB. Raises body limits for one route only. Virus-scanning question |
| 15 | **IMAP/SMTP provider** | High for custom domains (e.g. `@ecomforge.site` at Namecheap Private Email/Zoho) | L | A third `MailProvider`. Credentials are a password/app-password (encrypted in vault). IMAP `CONDSTORE/QRESYNC` for sync cursor. Needs an IMAP library (ask), and SSRF rules change because the host is user-provided: allowlist ports 993/465/587, block private IP ranges after DNS resolution |

---

## 5. Risks

- **Google restricted scopes.** `gmail.modify` is a *restricted* scope (`gmail/provider.ts:6`).
  - **Testing mode**: at most 100 listed test users, and refresh tokens expire after **7 days**, so every user must reconnect weekly. Today's `GMAIL_ALLOWED_EMAILS` matches this.
  - **Production**: Google's verification plus an annual **CASA** security assessment by an approved lab (cost and effort; the tier depends on Google's decision).
  - Options: stay in Testing for personal use; drop to `gmail.readonly` + `gmail.send` (still restricted, but read-only reduces scope); or use IMAP with an app password for Gmail, which avoids OAuth verification but requires 2-step verification on the Google account.
  - **Microsoft** `Mail.ReadWrite` needs no audit. Multitenant apps show "unverified" until publisher verification (needs a Microsoft Partner ID; free).
- **In-memory Gmail quota budget** (`gmail/provider.ts:73-79`). It's per process, so two app replicas (or a deploy overlap, or app + future worker) each think they have 5,400 units/min. The result is 429s, which are handled by retry, so this is degraded, not broken. Fix when adding the worker: a budget row per account in Postgres (`UPDATE … RETURNING` token bucket) or a single sync worker owning all Gmail calls.
- **Browser-driven sync.** Mail only syncs while a tab is open. Gmail history expires after about 7 days and Graph delta tokens can expire too. A user away for a week triggers a full 90-day resync (handled: `emails.service.ts:56-59`, 410 → reset). No notifications are possible without a server-side process.
- **Data migrations.** `008` deleted cached mail. Future migrations on `emails` (FTS column, `user_id`, `folder_id`) touch the biggest table: use `ADD COLUMN` without a volatile default, backfill in batches, and build indexes `CONCURRENTLY`. Always take a backup before deploying a migration (Phase 1 automates this).
- **Single VPS.** No HA. Restores must be rehearsed (Phase 1/3).
- **Credential concentration.** One `TOKEN_ENCRYPTION_KEY` on the VPS decrypts every user's mailbox. Root on the box means full access to all connected mail. That's why Phase 3 matters, and why L2 (key versioning) is needed for rotation after an incident.

---

## 6. Concrete first tasks this week

1. Review this file and the draft `CLAUDE.md` (shown in chat). Commit both on this branch → PR #1.
2. Decide the questions in §7.
3. `chore/rename-leftovers` (small, no data risk).
4. `chore/lint-format` (config first, mechanical reformat in a separate commit).
5. `ci/pin-and-scan` (SHA pins + gitleaks/Semgrep/Trivy/actionlint).

Deployment comes last (decided 2026-10-20). Server details (Contabo plan, Ubuntu version, which registrar holds `ecomforge.site`) are only needed then.

---

## 7. Decisions needed from you (asked one at a time in chat)

1. Lint/format: ESLint + typescript-eslint + Prettier (same as Outreach Tracker) **(recommended)**, or Biome.
2. Add `zod`, `pino`, `pino-http` as dependencies (required by your standard). Yes/no for each.
3. `helmet`: keep the hand-written headers + an ADR **(recommended)**, or switch to helmet.
4. Frontend typing: **vanilla JS + JSDoc `// @ts-check`** checked by the existing `tsc` (no new dependency, no build step) **(recommended)**; TypeScript compiled by `tsc` into `public/js` (adds a build step); or a small framework (Preact/Lit, adds dependencies and a bundler).
5. Optimistic locking: add it when the first real conflict exists (drafts/settings) **(recommended)**, or retrofit `version` columns now.
6. Is there a Render deployment with real users? It decides whether `render.yaml` stays and whether a data move is needed.
7. Deploy trigger: merge to `main`, or `v*` tag (asked in Phase 2).
8. Commit `total-project-description.md` (currently untracked) to `docs/`, or keep it local?
