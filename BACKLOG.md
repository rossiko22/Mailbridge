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
- [ ] Folders / labels
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
