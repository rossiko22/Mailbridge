# 7. Stable error codes and a contract-first API

Status: Accepted (2026-10-20)

## Context

Errors were `{ message }` written in about forty places, and validation was hand-written per handler. Clients and tests matched on English text.

## Decision

Every error is `{"error":{"code","message","details?"}}` with a code from the fixed list in `src/http/errors.ts`. `contracts/openapi.yaml` describes every operation and is linted with Redocly; Zod schemas mirror it, request bodies are strict (unknown fields refused). Tests check that every documented operation exists and that the documented codes equal the server's.

## Consequences

API changes start in the contract. Adding an error code means changing the contract and the list together, or the contract test fails.
