# 6. Versioned credential encryption with key rotation

Status: Accepted (2026-10-20)

## Context

Mailbox refresh tokens are encrypted with AES-256-GCM. The first format had no key identifier, so changing `TOKEN_ENCRYPTION_KEY` would have forced every user to reconnect every mailbox, which discourages rotating it at all.

## Decision

Store `v2.<key id>.<iv>.<tag>.<data>` with an HKDF-derived key; the key ID is a fingerprint of the key. `TOKEN_ENCRYPTION_KEY_PREVIOUS` is accepted for reading during a rotation; stale values are re-encrypted on use and by `reseal-credentials`. The account ID stays the associated data, and the tag length is enforced. v1 values still open and are upgraded.

## Consequences

Rotation is a routine operation (docs/runbooks/key-rotation.md). The old key must be kept until the reseal reports nothing left.
