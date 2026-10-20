# 11. Optimistic locking only where two edits can clash

Status: Accepted (2026-10-20)

## Context

The standard asks for a version column and 409 where two tabs can edit the same thing. Today nothing in Mailbridge is edited that way: the display name is last-write-wins and harmless, and the read flag is idempotent with the provider as the source of truth.

## Decision

Add `version` columns and 409 answers with the first feature that needs them (drafts, labels, rules, settings), not before.

## Consequences

No unused columns or code now; the first editing feature carries the pattern and its tests.
