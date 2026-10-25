# 12. Sent and Junk: one folder per saved message

Status: Accepted (2026-10-25)

## Context

The app showed only the inbox. People also want their sent mail and what the provider filed as junk. The two providers model this differently: Outlook keeps every message in exactly one folder and has a separate delta checkpoint per folder; Gmail puts labels on a message (one message can be in INBOX and SENT at once) and has one history for the whole mailbox.

## Decision

- Each saved message has one `folder` (`inbox`, `sent`, `junk`). The same table, indexes, paging and search serve every folder; the list index starts with `(account_id, folder, …)`.
- **Gmail**: one sync for the whole mailbox. The first sync lists `{in:inbox in:sent in:spam}` with `includeSpamTrash`; the history checkpoint already covers every label. Overlapping labels resolve as TRASH (hidden) → SPAM → INBOX → SENT, so mail to yourself appears once, in the inbox.
- **Outlook**: one delta per folder (Inbox, Sent Items, Junk Email), stored together as JSON in the existing `sync_cursor`; every call fetches one page of each. Every stored link is checked against its own folder's path before any request.
- A removal reported by a folder's delta only deletes the copy in that folder. Outlook reports a move as "removed" in one folder and "added" in the other, in either order across the two deltas, and immutable IDs stay the same across the move.
- Counts in the sidebar are inbox-only. Replying to a sent message is refused (it would go to yourself); forwarding works.

## Consequences

No reconnect is needed: the existing scopes (`gmail.modify`, `Mail.ReadWrite`) already read every folder. Migration 013 clears every sync checkpoint so the next sync fetches 90 days of Sent and Junk; for a large Gmail mailbox that resync takes a few minutes because of the quota. A Gmail message that is in both INBOX and SENT is not listed under Sent. Moving mail between folders from the app (mark as junk / not junk) is not built yet (BACKLOG.md).
