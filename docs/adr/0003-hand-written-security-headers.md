# 3. Hand-written security headers instead of helmet

Status: Accepted (2026-10-20)

## Context

The standard asks for helmet. Mailbridge already sets its headers in `security.middleware.ts`, and they are stricter than helmet's defaults (`default-src 'self'` with no inline styles, `frame-ancestors 'none'`, `Cache-Control: no-store` for API answers), and the integration tests check them.

## Decision

Keep the hand-written headers; do not add helmet.

## Consequences

One dependency fewer, and every header is visible in one place. Keeping up with new headers is our job; the smoke test and the integration tests catch removals.
