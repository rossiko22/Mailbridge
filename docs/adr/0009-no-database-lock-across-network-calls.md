# 9. No database lock or connection held across a provider call

Status: Accepted (2026-10-20)

## Context

Token refresh opened a transaction with `SELECT … FOR UPDATE` for every provider call, and sync held a transaction and an advisory lock while downloading a page. With a pool of 10 connections, a few slow provider answers could block the whole app.

## Decision

Credentials are read without a lock and saved with compare-and-swap; refreshes are shared per account within a process. A sync claims its account with a five-minute lease (one UPDATE), fetches with no connection held and saves in a short transaction only if the lease is still valid.

## Consequences

Two processes may occasionally refresh the same token at once; both results are valid, and the first save wins. A crashed sync blocks its account for at most five minutes.
