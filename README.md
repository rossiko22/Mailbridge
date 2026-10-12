# Mailbridge – unified mail client

Read Outlook and Gmail in one place. All mail from every connected account appears together, and each mailbox is also listed on its own in the sidebar. Node.js 24, Express 5, TypeScript, PostgreSQL, plain HTML/CSS/JS (no build step for the front end).

## Features

- Sign in, **create an account**, **forgot / reset password** (single-use link, valid 30 minutes, emailed over SMTP).
- Connect any number of **Outlook** (Microsoft Graph) and **Gmail** accounts with OAuth. Tokens are stored encrypted.
- One inbox for all accounts, per-account views, unread filter, search, sorting, unread counts.
- Read mail safely (sandboxed body, remote images off by default), attachments, conversation history, `.eml` download.
- Reply, forward and compose from any connected account. Mark read/unread (written back to the provider).
- **Settings**: profile photo, display name, connected accounts, password, light/dark theme.

## Quick start

```sh
npm ci
cp .env-example .env
docker compose up -d postgres
npm run migration
npm run seed        # demo user demo@example.test / Demo-Password-123! with two demo mailboxes
npm run dev         # http://localhost:3000
```

Without OAuth credentials the demo mailboxes still work; the Connect buttons are disabled until a provider is configured. Without SMTP, reset links are printed to the server log (development only).

## Connecting real mailboxes

Register an app with each provider and set the redirect URIs:

| Provider | Redirect URI | Env vars | Scopes |
| --- | --- | --- | --- |
| Microsoft (Azure app registration) | `<PUBLIC_ORIGIN>/accounts/callback/outlook` | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT` (default `common`) | `User.Read Mail.ReadWrite Mail.Send offline_access` |
| Google (Cloud console, OAuth client "Web") | `<PUBLIC_ORIGIN>/accounts/callback/gmail` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Gmail API: read/modify and send |

Notes:
- `GMAIL_ALLOWED_EMAILS=a@x.com,b@y.com` limits the Gmail option to those app users, which fits an unverified Google app limited to test users. Outlook stays open to everyone.
- Gmail's mail scopes are *restricted*. While the Google app is in "Testing" only listed test users can connect (and tokens expire after 7 days); public use needs Google's verification.
- First sync loads the last 90 days of the inbox; later syncs are incremental. If Gmail's history window expires, the sync rebuilds itself.
- Gmail forwards do not include the original attachments.
- Migration `008_unified_mailboxes.sql` replaces the old ticket schema and **deletes previously cached emails** (they are re-synced from the provider). It is not reversible.

## Configuration

See `.env-example` and `.env.production.example`. Key variables: `PUBLIC_ORIGIN`, `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`, `ALLOW_REGISTRATION`, `MICROSOFT_*`, `GOOGLE_*`, `SMTP_*`, `POSTGRES_*`. Production deployment files (Docker, Caddy HTTPS, backups) are `Dockerfile`, `compose.production.yaml` and `deploy/`.

## Checks

```sh
npm run check    # typecheck, unit tests, build
```
