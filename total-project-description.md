# Mailbridge: Total Project Description

> **How to use this document:** It describes the Mailbridge project as it stands (October 2026): what it does, how it is built, the conventions it follows, and where it is inconsistent or unfinished. Paste it into Claude together with the description of the standards I use in my other apps (section 14). Then ask for an analysis and a plan for how to continue building it.

---

## 1. What the project is

**Mailbridge** is a self-hosted web mail client that puts **Outlook (Microsoft Graph) and Gmail (Gmail API)** mailboxes in one inbox. A user signs up, connects any number of Outlook and Gmail accounts through OAuth, and reads them together. Each account is also listed separately in the sidebar.

Core features that work today:

- Combined inbox across all connected accounts, colour-coded per account. It has per-account views, an All/Unread filter, search, newest/oldest sorting and "load more" pagination.
- Safe reading. HTML mail is sanitized and rendered in a sandboxed iframe with its own CSP. Remote images stay blocked until the user opts in.
- Reply, forward and compose from any connected account. Read/unread state is written back to the provider.
- Attachment download. Export of any message as `.eml`, either a text reconstruction or the original MIME.
- User accounts: register, sign in, forgot/reset password by email, change password, display name, profile photo, light/dark theme.
- "Recent activity" in Settings: the user's own security audit log (sign-ins, password changes, connections, sends, downloads).
- Demo mode. A seeded demo user has two demo mailboxes, so the whole UI works without OAuth apps.

### History (important context)

The project started as **"Ticket Mail"**, an internal ticketing tool. In that version one shared server-wide Outlook mailbox was worked by a team: emails had statuses (unassigned/progress/finished), were assigned to users, and users had roles (SOFTWARE_DEVELOPER / IT_MANAGER). Migration `008_unified_mailboxes.sql` pivoted it to the current personal multi-account mail client. It dropped the ticket schema and is irreversible. Leftovers of the old name remain (see section 12).

- Repo: `github.com/rossiko22/Mailbridge`
- 21 commits, single developer, Conventional Commits style (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `ci:`, `refactor:`).
- Size: about 6,000 lines total across `src/`, `public/` and `tests/`. The backend is about 2,600 lines of TypeScript. The frontend is about 1,000 lines of JS, about 550 lines of CSS and 6 HTML pages.

---

## 2. Tech stack

| Layer | Choice |
|---|---|
| Runtime | Node.js **24** (`engines: >=24`), ES modules (`"type": "module"`) |
| Language | TypeScript **7**, very strict (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedModules`, `module: nodenext`, target ES2023) |
| HTTP | **Express 5** (async errors propagate natively) |
| Database | **PostgreSQL 18**, raw SQL through `pg` (no ORM, no query builder) |
| Migrations | `node-pg-migrate` runner over plain `.sql` files in `database/migrations/` (`-- Up Migration` / `-- Down Migration` sections) |
| Sessions | `express-session` + `connect-pg-simple` (sessions table in Postgres) |
| Passwords | `argon2` (Argon2id, 128 MiB, 3 passes) |
| OAuth | Hand-written PKCE flows. Outlook uses `@azure/msal-node` with an encrypted token cache. Gmail calls Google's token endpoint directly |
| HTML sanitizing | `sanitize-html` (tight allowlist) |
| Outgoing system mail | `nodemailer` (password resets only) |
| Frontend | **No framework, no build step.** Hand-written HTML + CSS + vanilla JS (IIFE modules on `window.App`), served as static files by Express |
| Tests | Node built-in test runner (`node --test`) + `tsx`. **Playwright** (Chromium) for browser tests. No Jest/Vitest |
| Dev tools | `tsx watch`, Docker Compose (Postgres, pgAdmin, Mailpit) |
| CI/CD | GitHub Actions, CodeQL, Dependabot, GHCR image publishing with build-provenance attestation |
| Hosting | Docker. Either `compose.production.yaml` (app + Postgres + Caddy auto-HTTPS on one host) or a Render Blueprint (`render.yaml`, free plan, Frankfurt) |

Production dependencies (10): `@azure/msal-node`, `argon2`, `connect-pg-simple`, `dotenv`, `express`, `express-session`, `node-pg-migrate`, `nodemailer`, `pg`, `sanitize-html`. The dependency footprint is kept deliberately small.

---

## 3. Repository layout

```
src/
  app.ts                    Express wiring: middleware order, throttles, routers, static files (composition root)
  server.ts                 Startup: DB/schema check, listen, graceful shutdown on SIGINT/SIGTERM
  config/
    env.ts                  All env parsing/validation in one place; exports a frozen `env` object
    database.ts             pg Pool + startup check that every required table exists
  middleware/
    security.middleware.ts  Security headers, request ID, JSON request log (prod), DB-backed `throttle()`
    json.middleware.ts      `requireSameSiteJson`: CSRF defence (state-changing requests must be same-site application/json)
    session.middleware.ts   express-session config
    auth.middleware.ts      `requireAuth`: loads the user, enforces 7-day absolute session age
    error.middleware.ts     Maps MailError / known errors to JSON, hides internals, logs as JSON
  modules/                  Feature modules
    auth/                   controller, routes, service (password reset), validation
    users/                  controller, routes, service, repository, types, avatar parsing
    accounts/               connected mailboxes: repository (incl. encrypted credential store), routes (OAuth connect/callback, sync, delete)
    emails/                 routes, service, repository, types, presentation (sanitize + CSP), eml export
    audit/                  audit.ts: record/recent security events, 90-day retention
  integrations/
    mail/                   Provider-agnostic contract: types.ts (MailClient, MailProvider, CredentialStore), registry, errors, http, mime
    gmail/                  api.ts (Gmail REST client + quota budget), provider.ts (OAuth)
    outlook/                graph.ts (Graph client + delta sync), provider.ts (MSAL OAuth)
    mailer.ts               nodemailer wrapper for system email (logs links to console in dev when no SMTP)
  security/
    password.ts             argon2 hash/verify
    token-vault.ts          AES-256-GCM with account ID as AAD
  scripts/                  migrate, seed-development, demo-data, reset-password (admin CLI)
  types/                    express-session and express Request augmentation
public/
  index.html, register.html, forgot.html, reset.html   Public auth pages
  app.html                  Main 3-pane mail UI
  settings.html             Profile, password, connected accounts, recent activity
  css/tokens.css            Design tokens (single source of truth; Fluent/Outlook-like look, light+dark)
  css/components.css, layout.css
  js/core.js                Shared client lib (api(), json(), toast, popover, avatar, app bar, dates) → window.App
  js/mail.js                Mail page (~530 lines)
  js/settings.js, auth.js, theme.js
  assets/icons.svg (sprite), logo.svg, logo-dark.svg
database/migrations/        001–009 SQL migrations
tests/                      unit tests at top level; integration/, e2e/, support/harness.ts
deploy/                     Caddyfile, backup.sh (pg_dump), smoke-test.sh (used by CI)
docs/screenshots/           Generated by the e2e suite
.github/                    ci.yml, codeql.yml, dependabot.yml
```

---

## 4. Architecture and code conventions

### 4.1 Backend layering

`routes → (controller) → service → repository → pg Pool`, plus `integrations/` for external APIs.

- **Factory functions with dependency injection, no classes.** Most modules export `createXxx(deps)` that returns an object of functions. The exported type is taken with `ReturnType<typeof createXxx>`. Examples: `createEmailService(pool, repository, accounts, registry)`, `createAccountsRepository(pool, secret)`, `createAudit(pool, now)`. Time (`now`), `fetch` (`request`) and `wait` are injectable for tests.
- **Composition root** is `src/app.ts`. All wiring happens there by hand. There is no DI container.
- **Validation is inline in route handlers**: hand-written type checks and regexes (UUID, email address, lengths, control characters). There is no schema library (no zod). Auth has a small `auth.validation.ts`.
- **Errors:** `MailError(status, userSafeMessage, reconnect?)` is the user-facing error type. The error middleware turns it into `{ message }` JSON. Any other error becomes a generic 500 with a JSON log line (no stack, no internals).
- **Responses** are plain JSON objects (`{ emails, hasMore }`, `{ accounts, providers }`, `{ message }`). There is no envelope standard and no versioned `/api` prefix. Routes sit at `/auth`, `/users`, `/accounts`, `/emails`, `/health`.
- **SQL**: raw parameterized SQL in repositories. Columns are aliased to camelCase in `SELECT` (`e.sender_name AS "senderName"`). Transactions use explicit `BEGIN/COMMIT/ROLLBACK` on a checked-out client. Postgres advisory locks serialize per-account work (sync, account upsert). `SELECT … FOR UPDATE` locks the row during token refresh.
- **Comments** explain *why*, in plain English sentences, sparingly. Code is dense: many short one-liners and long lines.
- **Logging**: `console.log/error` with `JSON.stringify({ event, … })`. There is no logger library.

### 4.2 Mail provider abstraction (the core design)

`src/integrations/mail/types.ts` defines:

```ts
interface MailClient {
  sync(cursor: string | null): Promise<SyncPage>;      // incremental, paged
  body(id): Promise<MailBody>;
  attachments(id); attachment(id, attachmentId); mime(id);
  send(id, 'reply' | 'forward', comment, recipients); compose(message);
  setRead(id, isRead);
}
interface MailProvider { begin(); complete(code, pending); client(accountId): MailClient }
interface CredentialStore { withCredentials(accountId, work(current, save)) }  // row-locked, encrypts transparently
```

- `registry.ts` builds the providers that have OAuth app credentials configured. The rest of the app never branches on the provider.
- **Sync**: the first sync fetches the last 90 days of the **Inbox only**. After that it is incremental: Graph delta links for Outlook, `historyId` for Gmail. An expired cursor (`410`) resets and rebuilds automatically. Stored cursors are validated (host/path allowlist) so a tampered cursor cannot send a token elsewhere.
- **Partial updates**: providers send `Partial<SyncedFields>`. The repository upsert only overwrites keys that are present (`$11::jsonb ? 'subject'`).
- **Gmail quota budget**: Gmail allows 6,000 units per mailbox per minute. There is a sliding-window budget per account plus a pause until the quota minute resets. It lives **in process memory** (a `Map` in the provider).
- **Send idempotency**: the client generates a `requestId` (UUID). The server inserts `outgoing_messages` as `pending` *before* calling the provider. A retry of an accepted request returns success without resending. A non-`MailError` failure is recorded as `unknown` and the user is told to check Sent instead of retrying.

### 4.3 Who triggers sync

Sync is **driven by the browser**. `mail.js` calls `POST /accounts/:id/sync` repeatedly per account until `hasMore` is false. It runs on page load, on the manual Sync button and on an automatic timer (every 2 minutes, only while the tab is visible). There is **no background worker, job queue, webhook, or push notification** (no Graph subscriptions, no Gmail Pub/Sub watch).

### 4.4 Frontend conventions

- Multi-page app. Each page loads `theme.js` (sync, sets theme before paint), then `core.js` and its own page script with `defer`.
- Each script is an IIFE. Shared helpers are exposed on `window.App`. Pages destructure from it.
- DOM is built with `document.createElement` + `textContent` (XSS-safe). `innerHTML` is used only for trusted static templates and icon sprites (`<svg><use href="assets/icons.svg#name">`).
- Page state is a plain object (`state = { accounts, filter, selectedId, offset, … }`) plus `render*` functions. Version counters (`listVersion`, `detailVersion`) discard stale async responses.
- Strict CSP with no inline scripts or styles. All styling uses CSS custom properties from `tokens.css`. The tokens file says "nothing else may hard-code a value". Light/dark come from tokens with a `data-theme` toggle.
- Accessible patterns: skip link, ARIA roles on menus/tabs, focus return, Escape handling, `role="status"` live regions, a responsive 3-pane layout that becomes a drawer below 960px.
- Look: Microsoft Fluent / Outlook on the web.

---

## 5. Data model (PostgreSQL, after migration 009)

| Table | Purpose / key columns |
|---|---|
| `users` | `user_id uuid`, `email` (unique on `lower(email)`), `password_hash`, `display_name ≤80`, `is_active`, timestamps (trigger keeps `updated_at` current) |
| `user_avatars` | `user_id` PK/FK, `content_type` (png/jpeg/webp), `data bytea ≤512 KB` (images stored in DB) |
| `sessions` | connect-pg-simple store (`sid`, `sess json`, `expire`) |
| `login_attempts` | Throttle counters: HMAC-hashed `key`, `attempts`, `window_start` (15-min window) |
| `password_resets` | `token_hash` PK, `user_id`, `expires_at` (30 min), `used_at` |
| `mail_accounts` | `account_id`, `user_id`, `provider` (outlook/gmail), `email`, `display_name`, `color`, `credentials` (AES-GCM ciphertext; NULL for demo), `sync_cursor`, `synced_at`, `last_error`, `needs_reconnect`, `is_demo`. Unique `(user_id, provider, lower(email))` |
| `emails` | `email_id`, `account_id`, `provider_id`, `subject`, `sender_name`, `sender_address`, `preview`, `body_text`, `received_at`, `has_attachments`, `is_read`. Unique `(account_id, provider_id)`, index on `(account_id, received_at DESC)`, partial index for unread |
| `email_bodies` | Cached full body per email (`html`/`text`), fetched lazily on first open |
| `outgoing_messages` | Idempotency + send history: `request_id` PK, `account_id`, `email_id?`, `action` (compose/reply/forward), `payload jsonb`, `state` (pending/accepted/failed/unknown) |
| `audit_events` | `event`, `outcome` (success/failure/denied), `ip inet`, `user_agent`, `request_id`, `target`, `detail jsonb`. 90-day retention, pruned by the app at most once an hour |

Cached mail is treated as a **rebuildable copy** of provider data. The provider is the source of truth.

Not modelled yet: folders/labels (Inbox only), threads/conversations (only local reply history), drafts, contacts, calendar, recipients (to/cc) of incoming mail, flags/stars, attachments metadata (fetched live).

---

## 6. HTTP API surface

| Method & path | Notes |
|---|---|
| `GET /auth/config` | `{ registration }` |
| `POST /auth/login` · `/register` · `/forgot` · `/reset` · `/logout` | Throttled. Session regenerated on login |
| `POST /auth/password` | Change password; destroys all sessions |
| `GET /auth/me` · `GET /auth/activity` | Current user · own audit events (last 50) |
| `PATCH /users/me` | Display name |
| `GET/PUT/DELETE /users/me/avatar` | Photo as a JSON data URL (800 KB body limit on this route only) |
| `GET /accounts` | Accounts with total/unread counts + which providers are available to this user |
| `GET /accounts/connect/:provider` · `GET /accounts/callback/:provider` | Browser navigations for OAuth (PKCE + single-use state in session) |
| `POST /accounts/:id/sync` | One sync page; `{ processed, removed, hasMore }`. 409 if already syncing |
| `DELETE /accounts/:id` | Removes account and its cached mail (cascade) |
| `GET /emails?offset&account&unread&search&sort` | Page size 50, offset pagination |
| `POST /emails/compose` | `{ accountId, requestId, subject, body, to, cc, bcc }`, max 20 recipients |
| `GET /emails/:id` · `PATCH /emails/:id/read` | Detail (+ local reply history) · read state (written to provider) |
| `GET /emails/:id/body?images=true` | Sanitized HTML document for the sandboxed iframe, with its own CSP |
| `GET /emails/:id/export?original=true` · `GET /emails/:id/attachments[/:attachmentId]` | `.eml` export · attachment list/download (25 MB limit) |
| `POST /emails/:id/send` | Reply/forward with `requestId` |
| `GET /health` | `SELECT 1` |

All state-changing requests must be same-site `application/json` (otherwise 415).

---

## 7. Security model (a strong point of the project)

The full OWASP Top 10 (2021) mapping is in `SECURITY.md`. Summary:

- Argon2id passwords. A decoy hash for unknown emails keeps login timing uniform. Reset tokens are single-use, hashed and sent in the URL fragment.
- Server-side sessions: HttpOnly, SameSite=Lax, Secure in prod, 8 h idle, 7 days absolute. All sessions are revoked on password change or reset.
- CSRF defence through the same-site JSON requirement (no tokens).
- DB-backed throttling per IP, per account email and per user, with HMAC-hashed keys.
- OAuth tokens are AES-256-GCM encrypted, bound to the account row through AAD, and never sent to the browser.
- Strict CSP, `X-Frame-Options: DENY`, nosniff, no-referrer, COOP/CORP and HSTS in production.
- Mail HTML: allowlist sanitizing, sandboxed iframe, a separate CSP per body, remote images opt-in and loaded by the browser, never by the server.
- SSRF: only fixed Google/Microsoft hosts, `redirect: 'error'`, cursor validation, download size limits.
- Every query is scoped to the user. Foreign IDs return 404.
- The audit log never stores mail content, recipients, passwords or tokens.
- Container: non-root, read-only filesystem, `cap_drop: ALL`, `no-new-privileges`. The DB sits on an internal network.
- Production refuses to start with secrets shorter than 32 characters or a non-HTTPS `PUBLIC_ORIGIN`.

Known, documented limits: no 2FA, no email verification at sign-up, registration reveals whether an email is taken, throttling can lock a victim out for 15 minutes, passwords are checked for length only (no breached-password check), and there is no alerting on audit spikes.

---

## 8. Testing

| Layer | Command | Needs | Covers |
|---|---|---|---|
| Unit | `npm test` | nothing | Gmail/Outlook clients against recorded responses, quota budget/backoff, cursor validation, MIME, sanitizing, token vault, validation, avatar parsing |
| Integration | `npm run test:integration` | Postgres | Real app over HTTP + real DB: auth, sessions, throttling, reset, CSRF, headers, isolation between users, OAuth flow, sync, send idempotency, audit |
| E2E | `npm run test:e2e` | Postgres + Chromium | Sign-in, inbox, reading, filters/search, themes, settings, sign-out, mobile layout. Any console error or CSP violation fails the test. Also generates README screenshots |

- `tests/support/harness.ts` creates and migrates a separate `<db>_test` database. It replaces global `fetch` before the app loads, so any unexpected outbound request fails the test. Google/Microsoft are faked in process.
- Coverage is enforced in CI: lines ≥90%, branches ≥75%, functions ≥85% (currently about 93/81/89).
- `npm run check` runs typecheck (src + tests), unit tests and build.

---

## 9. CI/CD and operations

- `ci.yml` runs parallel jobs: types+unit+build · integration+coverage (migrations run twice to prove they are re-runnable) · Playwright e2e (screenshots uploaded as an artifact) · `npm audit` + dependency review on PRs · Docker build + smoke test (non-root check, read-only filesystem, waits for `/health`).
- On `main` or a `v*` tag, after everything passes: push to `ghcr.io/rossiko22/mailbridge` (latest / sha / semver tags) with signed build provenance. A `v*` tag also creates a GitHub release.
- CodeQL runs weekly and on every push/PR. Dependabot sends weekly grouped updates (npm, actions, docker; Node major bumps are done by hand).
- Deploy option A: `compose.production.yaml` (app + postgres + caddy). Migrations are run manually with `exec app node dist/scripts/migrate.js`. `deploy/backup.sh` writes a `pg_dump`.
- Deploy option B: Render Blueprint. Migrations run on every start (`start:render`) because the free plan has no pre-deploy step. The latest commit (`a4045fc render`) added this.
- Admin: `npm run admin:reset-password` (env-driven).
- Observability: JSON request logs to stdout in production (request ID, user, status, duration). There are no metrics, tracing, error tracker (Sentry etc.) or alerting.

---

## 10. Configuration

Everything is set through env vars, parsed and validated in `src/config/env.ts` (fail fast on startup). Key vars: `NODE_ENV`, `PORT`, `PUBLIC_ORIGIN`, `TRUST_PROXY`, `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY` (falls back to SESSION_SECRET), `POSTGRES_*`, `ALLOW_REGISTRATION`, `MICROSOFT_CLIENT_ID/SECRET/TENANT`, `GOOGLE_CLIENT_ID/SECRET`, `GMAIL_ALLOWED_EMAILS` (invite list while the Google app is unverified), `SMTP_*`. A provider without credentials is simply not offered.

Provider constraints worth knowing:
- Gmail scopes (`gmail.modify`, `gmail.send`) are *restricted*. Public use needs Google verification (and likely a CASA security assessment). In "Testing" mode only listed test users can connect, and tokens expire after 7 days.
- A large Gmail inbox syncs at about 270 messages/min because of quota.
- Gmail forwards do not include original attachments.

---

## 11. Development workflow

```sh
npm ci
cp .env-example .env
docker compose up -d postgres       # + pgadmin (:5050) and mailpit (:8025) optional
npm run migration
npm run seed                        # demo@example.test / Demo-Password-123!
npm run dev                         # http://localhost:3000
```

---

## 12. Inconsistencies, leftovers and technical debt I'm aware of

These are the things an analysis should weigh when proposing how to standardize:

1. **Old name everywhere.** `package.json` name is `ticket-mail`. DB/user default is `ticket_mail` (also in `render.yaml`). The compose project is `ticket-mail`. Container/volume names are `ticket-mail-*`. The `.idea` module is `Okta-Ticketing-System.iml`. Migration file names and comments refer to ticket concepts.
2. **Mixed module styles.** `users.repository.ts` exports plain functions that import the global `pool`. `accounts`/`emails`/`audit` repositories use `createXxx(pool)` factories. `session.middleware.ts` also imports the global pool and env directly, which makes parts of the app hard to instantiate twice or test in isolation.
3. **Mixed controller styles.** The `auth` and `users` modules have separate controllers with verbose `try { … } catch (e) { next(e) }` (Express 4 style). The `accounts` and `emails` routers put logic directly in route handlers and rely on Express 5 async error propagation. Formatting also varies: `{a}` vs `{ a }`, `"` vs `'` quotes, some trailing-semicolon gaps. **There is no linter or formatter configured** (no ESLint/Prettier/Biome).
4. **Validation is ad-hoc**, written inline with regexes duplicated across routers (the UUID regex is defined in several files). There is no shared schema layer and no request/response types shared with the frontend.
5. **No API contract.** No OpenAPI spec, no `/api/v1` prefix, no consistent error codes (only `{ message }`).
6. **Frontend scale.** `mail.js` is about 530 lines in one IIFE with imperative DOM rendering. It works and is well tested by e2e, but each new feature (folders, threads, drafts) will grow it. There is no type checking on the frontend JS (no JSDoc `// @ts-check`).
7. **Sync architecture.** Sync only happens while a browser tab is open. There is no server-side scheduler, no provider push (Graph change notifications / Gmail `watch` + Pub/Sub), and no new-mail notifications. The Gmail quota budget is in memory, so it is wrong if more than one app instance runs.
8. **Scaling limits.** Search is `strpos(lower(...))` over subject/sender/body. That is a sequential scan, with no full-text index (`tsvector`/`pg_trgm`). Pagination is `OFFSET`-based. Account counts are computed per request with a lateral `count(*)`.
9. **Mail feature gaps.** Inbox only (no Sent/Archive/folders/labels). No threading. No delete/archive/move. No drafts. No rich-text compose (plain text only). No attachments on compose. No to/cc stored for incoming mail. No contacts/autocomplete. No keyboard shortcuts. No per-user settings beyond theme.
10. **Auth gaps.** No 2FA/passkeys, no email verification, no "sign in with Google/Microsoft" for the app itself, no session list / "sign out other devices" UI, no account deletion / data export for the user (GDPR).
11. **Ops gaps.** Migrations are manual in compose deploys. No metrics or error tracking. Backups are a manual script. The audit log is pruned from inside request handling.
12. **Repo hygiene.** `dist/` and `.idea/` exist locally (both gitignored). The README still uses the "Ticket" DB names in examples.

---

## 13. Strengths to preserve

- A clean provider abstraction (`MailClient` / `MailProvider` / `CredentialStore`). Adding a third provider (IMAP/JMAP, Yahoo, iCloud) should touch only `integrations/` and the registry.
- A serious, documented security posture with tests for each protection.
- Real integration and browser tests against a real database, with no network access, and enforced coverage.
- Very small dependency surface and no frontend build, so the app is easy to audit and run.
- A production-grade CI/CD pipeline and container hardening already in place.
- Fail-fast configuration and schema checks at startup.

---

## 14. What I want from the analysis

> **[Paste or describe here the system/standards I use in my other apps: folder structure, framework choices, linting/formatting, validation library, API conventions, error format, logging, testing setup, frontend stack, deployment, naming, commit/branch rules, etc.]**

Using the description above and my standards, please:

1. Compare Mailbridge against my standards and list every place it deviates, ordered by how much it matters.
2. Propose a **migration plan** to bring it in line: what to change first, what can stay, and what to leave alone because it is better than the standard. Keep the app working and tests green at every step.
3. Propose a **feature roadmap** for continuing development (for example folders/labels, threading, archive/delete, drafts, rich compose with attachments, background sync and push, notifications, 2FA, IMAP provider). Order it by value vs. effort and say which architectural changes each one requires (schema, sync engine, frontend structure).
4. Point out risks: Google verification for restricted scopes, multi-instance scaling, data-migration concerns.
5. Suggest concrete first tasks I can start with this week.
