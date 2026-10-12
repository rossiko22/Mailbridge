#!/bin/sh
# Run from the repository root. Store backups off-host as well.
set -eu
umask 077
mkdir -p backups
output="backups/ticket-mail-$(date -u +%Y%m%dT%H%M%SZ).dump"
set -C
if docker compose --env-file .env.production -f compose.production.yaml exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$output"; then
    printf 'Backup created: %s\n' "$output"
else
    printf 'Backup failed. Do not use the partial file: %s\n' "$output" >&2
    exit 1
fi
