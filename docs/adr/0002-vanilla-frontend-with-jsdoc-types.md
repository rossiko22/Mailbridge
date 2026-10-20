# 2. A vanilla frontend, type-checked with JSDoc

Status: Accepted (2026-10-20)

## Context

The interface is a handful of pages with hand-written HTML, CSS and JavaScript and no build step. A framework would bring a bundler, many dependencies and a larger attack surface. Plain JavaScript, though, was not type-checked at all.

## Decision

Stay vanilla. Check `public/js` with the TypeScript compiler the project already has (`checkJs`, `tsconfig.public.json`) and JSDoc casts where the DOM is ambiguous; declare the two shared globals in `types/browser.d.ts`. No new dependency, no build step, files shipped as written.

## Consequences

Type errors in the browser code fail `npm run typecheck`. `strict` is off for now; turning on `strictNullChecks` is the next step. If the interface grows into many interactive views, revisit this (a small framework such as Preact or Lit, with a bundler).
