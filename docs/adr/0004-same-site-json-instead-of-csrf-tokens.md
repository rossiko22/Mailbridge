# 4. Same-site JSON checks instead of CSRF tokens

Status: Accepted (2026-10-20)

## Context

State-changing requests need protection from cross-site request forgery. Token schemes add state and code to every form and fetch.

## Decision

Every request that is not GET, HEAD or OPTIONS must be `Content-Type: application/json`, must not carry `Sec-Fetch-Site: cross-site`, and, if it sends `Origin`, must come from `PUBLIC_ORIGIN`. A browser cannot send cross-origin JSON without a CORS preflight, which the server never approves. The session cookie is `SameSite=Lax` on top.

## Consequences

No tokens anywhere. Every state-changing endpoint must keep accepting JSON only; a form-encoded endpoint would need its own protection.
