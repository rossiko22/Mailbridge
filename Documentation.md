# Ticket Mail — Project Handoff for Claude

This file gives Claude enough context to understand the repository and prepare a clear implementation prompt for Codex or Claude Code. It is a project handoff, not a replacement for the source code or the detailed operational documents under `documentation/`.

## What I want Claude to do

Read this file and inspect the current repository before writing anything. Then help me turn the goal I provide into one practical, self-contained coding prompt that I can paste into Codex or Claude Code. The prompt should be specific to this project, identify the relevant existing files and behavior, include acceptance criteria and useful verification commands, and warn the coding agent to preserve the existing application behavior and security. Do not make up features, file contents, test results, credentials, or deployment claims. If I have not yet provided the goal, ask me what change I want the coding agent to make.

Claude should return the final prompt in a single Markdown code block, ready to copy and paste. It should not implement the change unless I explicitly ask it to.

## Project at a glance

**Ticket Mail – Outlook Ticketing System** is a single-mailbox support application. It imports a Microsoft Outlook inbox and lets an IT team work on messages as tickets. Managers manage the mailbox and team; team members work on messages assigned to them.

The application uses Node.js 24, Express 5, TypeScript, PostgreSQL 18, server-rendered static HTML/CSS/JavaScript, native Web Components, PostgreSQL-backed sessions, and Microsoft Graph. It is a modular monolith: the Express process serves both the browser UI and JSON API.

Repository source is the final authority. The project also has operational and assignment documentation:

- `README.md` — overview and local quick start.
- `documentation/izbira-projekta.md` — project choice and scope for the assignment.
- `documentation/vzpostavitev.md` — local requirements, setup, demo credentials, and troubleshooting.
- `documentation/funkcionalnosti.md` — user-facing behavior, feature list, and current limits.
- `documentation/microsoft-graph.md` — real Outlook and Microsoft 365 configuration, permissions, HTML reader, and Graph behavior.
- `documentation/produkcija.md` — production deployment, HTTPS, secrets, backups, upgrades, and rollback.
- `documentation/api.md` — API routes and access rules.
- `documentation/stanje-testiranja-in-zagotavljanja-kakovosti.md` — QA inventory, evidence, test state, and limitations.
- `documentation/uporaba-ui.md` — disclosure of AI assistance.

## Current functionality

The application currently includes local sign-in and sign-out, role-based access, manager-created team members, password changes, rate-limited login, session security, and audit history. Mail features include Outlook Inbox synchronization with Graph delta cursors, mailbox views and search/filtering, ticket assignment, finishing and reopening, replies, forwards, new text messages, outgoing-message history, text/original EML downloads, and Outlook attachment downloads.

Microsoft connection modes include personal Microsoft OAuth, Microsoft 365 application credentials, and a development access-token mode. Tokens and OAuth cache are encrypted in PostgreSQL. A real Outlook HTML reader uses an authenticated message-body API, sanitizes the untrusted HTML, applies a restrictive Content Security Policy, and shows it in a sandboxed iframe. External images are hidden until the reader's “Show images” control is used. Plain-text reading, Outlook error feedback, and an existing HTML-body cache are supported. The inbox previews use shorter dates and readable link labels instead of printing long tracking URLs.

The interface has a browser-local light/dark theme preference. The theme control is a small switch with “Light” and “Dark” labels and a sun/moon symbol in its moving knob. It is available on the sign-in screen and the shared app navigation.

The project includes a Docker production image, PostgreSQL-backed deployment, Caddy TLS configuration, backup/restore scripts, GitHub Actions CI configuration, demo seed data, admin bootstrap/reset scripts, and documented feature limitations.

## Current implementation and verification state

A recent review fixed the Microsoft synchronization-cursor validation bug caused by Graph OData continuations such as `mailFolders('inbox')`. It was verified against a real mailbox at the time the token was valid. The later HTML-reader review found that the current saved token and environment token had both expired. The application now explains that error, renders a readable saved-text fallback, and stores successfully fetched original HTML bodies for later viewing. The original HTML for messages that have only ever been imported as plain text still requires a valid Outlook token to fetch.

The last full recorded checks before the newest small visual theme-switch refinement were 61 unit tests, TypeScript build, PostgreSQL and HTTP integration checks, Playwright browser workflow, clean database setup, production Docker startup/backup restore, and `npm audit --omit=dev --audit-level=high`. The email HTML reader was previously verified in a browser against real Outlook messages. The very latest theme sizing and sun/moon labels were only syntax/diff checked; the development server was not reachable during that final pass, so do not claim a live visual verification of the newest switch markup.

The earlier real-mail checks were read-only. No real email was sent. Live OAuth renewal, actual message delivery, public-domain HTTPS, and production tenant configuration were not proven. The actual token has expired and is not included in this repository handoff.

## Important implementation and safety notes

- Do not read, copy, print, commit, or ask the user to paste the contents of `.env`, saved tokens, OAuth caches, real message bodies, or private mailbox data into a prompt. `.env` may contain live secrets. Ask for a sanitized description when necessary.
- Never send a real email during a coding task unless the user explicitly authorizes the test recipient and message. Use the existing synthetic Graph fixtures for automated tests.
- Preserve the OAuth callback/state/PKCE checks, mailbox access scoping, opaque Graph continuation handling, token encryption, rate limiting, same-origin JSON protections, restrictive HTML-email rendering, and no-retry policy for uncertain sends.
- The email body is untrusted input. Never inject raw email HTML into the main app DOM. Keep the sanitizer allowlist, iframe isolation, restrictive CSP, and default-blocked remote images.
- New database structures require a numbered migration under `database/migrations/`; do not edit old migrations that may already have run in a deployed database.
- Do not describe Graph Explorer access tokens as a production authentication method. The production path should use the documented Microsoft OAuth or application registration.
- The development demo uses a local mailbox and demo credentials; do not use demo credentials or seeding for production.
- User-facing documentation should describe current behavior honestly and distinguish implemented, simulated, live-tested, and unverified behavior.
- Keep the existing plain HTML/CSS/JavaScript and Express/TypeScript architecture unless my requested change justifies a migration. Avoid bringing in a large UI framework for a small feature.
- Inspect the current working tree before editing. It can contain uncommitted user changes. Do not reset, overwrite, commit, push, publish, or deploy changes without my request.

## Useful commands

The development environment used Node 24. If `node` or `npm` is not on PATH, this installation may be available at:

```sh
export PATH=/home/markospasovski/.nvm/versions/node/v24.21.0/bin:$PATH
```

Common commands:

```sh
npm ci
npm run dev
npm run typecheck
npm test
npm run build
npm run check
npm run test:database
npm run test:browser
npm run test:setup
npm run test:deployment
npm audit --omit=dev --audit-level=high
```

Database integration tests use PostgreSQL. `test:setup` needs permission to create a temporary database. `test:deployment` needs Docker. Browser tests use Playwright/Chromium. Before running commands, check the actual environment, package scripts, current database, and current server state. Do not stop or reset a server or database that the user is using.

## Prompt-writing instructions for Claude

When I state my next task, create a prompt that begins with the outcome I want, then gives the coding agent the essential repository context. The prompt should:

1. Tell the agent to inspect `Documentation.md`, relevant files, the working tree, and any applicable `AGENTS.md` instructions first.
2. State the existing behavior and the specific requested change without asserting that the desired change already exists.
3. Identify likely files and interfaces to inspect, while allowing the coding agent to follow evidence in the codebase.
4. Include concrete acceptance criteria, accessibility and responsive expectations when relevant, and security/data-handling constraints.
5. Ask for narrowly relevant tests only when useful or requested, and require the agent to report exactly what it actually ran.
6. Ask for documentation updates when behavior or setup changes.
7. Explicitly say not to expose real secrets or email content, send actual mail, or perform destructive git/deployment actions without authorization.
8. End with the requested final response: changed files, verification performed, any unverified behavior, and next steps.

If I ask for an implementation directly, do not only return a prompt: help me implement it in the repository.
