# 8. An insert-only audit log and a least-privilege database role

Status: Accepted (2026-10-20)

## Context

Anyone with the app's database credentials could update or delete audit rows and hide what they did. The app connected as the table owner, which can do anything.

## Decision

Migration 010 adds triggers: audit rows are never updated or truncated, and only deleted past the 90-day retention or when their user is deleted (erasure). `deploy/db-roles.sql` creates `mailbridge_app`, which can only read and write rows; migrations keep using the owner.

## Consequences

Deleting a user still removes their history, so an attacker who can delete the victim's account can erase that account's trail; that is accepted in favour of the right to erasure. Off-server log shipping (server phase) is the next layer.
