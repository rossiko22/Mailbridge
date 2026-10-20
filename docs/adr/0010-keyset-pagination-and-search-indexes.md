# 10. Keyset pagination and indexed search

Status: Accepted (2026-10-20)

## Context

The inbox paged with OFFSET and searched with a substring scan over every saved body: 2.8 s per search on 100,000 messages, and pages shifted when new mail arrived.

## Decision

Pages continue after an opaque cursor (sort, received time with microseconds, ID). Each account's rows come from an index in inbox order (LATERAL) and only those are merged. Search combines a `simple` full-text index (word prefixes, any language) with a trigram index on subject and sender.

## Consequences

Searches take 1 to 25 ms and pages under 1 ms at that size. Search no longer finds the middle of a word inside the body text (it still does in subject and sender). Mail without a date counts as the oldest.
