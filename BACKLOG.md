# Backlog

Ideas and planned work that are not being built yet. Architecture notes for each item are in `docs/analysis.md` §4.
Nothing here is built without the owner choosing it first.

## Features (ordered by value ÷ effort)
- [ ] Keyset (cursor) pagination for the mail list
- [ ] Archive / delete / move
- [ ] Full-text search (tsvector + pg_trgm)
- [ ] Session list and "sign out other sessions"
- [ ] Email verification at sign-up
- [ ] Two-factor sign-in: TOTP first, then passkeys
- [ ] Folders / labels beyond Inbox, Sent and Junk (custom Outlook folders, Gmail labels)
- [ ] Mark as junk / not junk from the app (Gmail: add or remove SPAM; Outlook: move to or from Junk Email)
- [ ] Search recipients of sent mail (the `recipients` column is not in `search_vector` yet)
- [ ] Threading
- [ ] Account deletion and data export
- [ ] Server-side background sync (worker + job table)
- [ ] Provider push: Graph subscriptions, Gmail watch + Pub/Sub
- [ ] Notifications (Web Push)
- [ ] Drafts (first real use of optimistic locking)
- [ ] Rich compose with attachments
- [ ] IMAP/SMTP provider (custom-domain mailboxes such as @ecomforge.site hosted outside Google/Microsoft)
- [ ] Choose a "send as" alias when composing

## Technical
- [ ] Move the Gmail quota budget into Postgres once there is more than one process
- [ ] Breached-password check at sign-up (k-anonymity range query, needs a decision on calling an external service)
- [ ] Alerts on audit-log spikes (part of the server-security phase)
- [ ] Throttle `GET /accounts/callback/:provider` per user (CodeQL alert #7; low risk: signed-in only, one-time OAuth state)
- [ ] A general per-user limit on signed-in read routes (inbox, search), so a stolen session cannot load the database
- [ ] Drop the dev dependency `@types/argon2`: argon2 ships its own types (`argon2.d.cts`)
