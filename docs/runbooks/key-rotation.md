# Rotating secrets

Three secrets protect Mailbridge. They are independent: rotate each one on its own schedule, and always after a
suspected leak. Generate every new value with `openssl rand -hex 32` and never reuse one.

| Secret | Protects | What rotating it costs |
| --- | --- | --- |
| `SESSION_SECRET` | Signs session cookies and keys the throttle counters | Everyone is signed out once |
| `TOKEN_ENCRYPTION_KEY` | Encrypts stored Outlook and Gmail sign-ins (AES-256-GCM) | Nothing, if you follow the steps below |
| `POSTGRES_PASSWORD` | The database | A short restart of the app |

## `TOKEN_ENCRYPTION_KEY`, without anyone reconnecting

Each stored credential records which key sealed it (`v2.<key id>.…`), so the app can read with the old key while
writing with the new one.

1. Generate the new key. In the production env file, move the current value to `TOKEN_ENCRYPTION_KEY_PREVIOUS` and
   put the new value in `TOKEN_ENCRYPTION_KEY`. Restart the app.
   From now on, every credential the app reads with the old key is re-encrypted with the new key on the spot.
2. Re-encrypt the rest (accounts nobody used since step 1):

   ```sh
   docker compose -f compose.production.yaml run --rm app node dist/scripts/reseal-credentials.js
   ```

   It prints how many credentials it re-encrypted and how many it could not read. Run it again until it reports
   `0 re-encrypted`.
3. Remove `TOKEN_ENCRYPTION_KEY_PREVIOUS` from the env file and restart. The old key is now useless: destroy every
   copy of it (password manager history, backups of the env file).

If the script reports credentials it could not read, those accounts were sealed with a key that is no longer
configured. Their owners have to reconnect them (Settings → Accounts); nothing else breaks.

**After a suspected leak of the key and the database together**, rotating is not enough: whoever has both can already
read every refresh token. Also revoke the tokens at the providers (each user removes Mailbridge under their Google
account's third-party access and Microsoft's app permissions, or you remove the accounts in the app, which deletes
the stored tokens) and ask users to reconnect.

## `SESSION_SECRET`

Replace the value and restart. Every session cookie stops verifying, so everyone signs in again. Throttle counters
start fresh. There is no "previous" value: a session secret only needs to be valid for one session's lifetime.

## Database password

1. `ALTER ROLE mailbridge PASSWORD '<new>';` as the database superuser.
2. Update `POSTGRES_PASSWORD` in the env file and restart the app.
