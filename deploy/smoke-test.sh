#!/bin/sh
# Starts the production image against the database in POSTGRES_* and checks that it comes up healthy.
# Usage: deploy/smoke-test.sh <image> [port]
set -eu
image="$1"
port="${2:-3000}"
name="mailbridge-smoke-$$"

run() {
    docker run --rm --network host \
        -e NODE_ENV=production -e PORT="$port" \
        -e POSTGRES_HOST="${POSTGRES_HOST:-127.0.0.1}" -e POSTGRES_PORT="${POSTGRES_PORT:-5432}" \
        -e POSTGRES_DB -e POSTGRES_USER -e POSTGRES_PASSWORD \
        -e PUBLIC_ORIGIN=https://mailbridge.example \
        -e SESSION_SECRET=smoke-test-session-secret-0123456789abcdef \
        -e TOKEN_ENCRYPTION_KEY=smoke-test-encryption-key-0123456789abcdef \
        "$@"
}

if [ "$(docker run --rm "$image" id -u)" = 0 ]; then
    echo "The image must not run as root." >&2
    exit 1
fi

run "$image" node dist/scripts/migrate.js
run -d --name "$name" --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true "$image" >/dev/null
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT

for attempt in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:$port/health" 2>/dev/null | grep -q '"status":"ok"'; then
        headers="$(curl -fsSI "http://127.0.0.1:$port/index.html")"
        echo "$headers" | grep -qi '^strict-transport-security:' || { echo "Missing HSTS header in production." >&2; exit 1; }
        echo "$headers" | grep -qi '^content-security-policy:' || { echo "Missing Content-Security-Policy header." >&2; exit 1; }
        echo "Image is healthy after ${attempt}s."
        exit 0
    fi
    sleep 1
done
echo "The container did not become healthy:" >&2
docker logs "$name" >&2
exit 1
