# 5. Biome for linting and formatting

Status: Accepted (2026-10-20)

## Context

The standard is ESLint with typescript-eslint (strict) and Prettier, or Biome. The project uses TypeScript 7, which typescript-eslint does not support yet (its peer range ends below 6.1).

## Decision

Use Biome (one exact-pinned dev dependency) with the recommended preset plus stricter rules (`noExplicitAny`, unused imports and variables, `useImportType`). Control-character regexes are intentional input sanitizing, so that rule is off. Exceptions are written next to the code with a reason.

## Consequences

Linting is fast and needs one tool. Type-aware rules such as un-awaited promises are not available; revisit typescript-eslint once it supports TypeScript 7.
