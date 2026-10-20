import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { register, startApp, type TestApp } from '../support/harness.js';

// Applies deploy/db-roles.sql to the test database and checks what the restricted role can and cannot do.
let app: TestApp;
let restricted: pg.Pool;
const password = 'test-only-app-role-password';

before(async () => {
    app = await startApp();
    await app.pool.query(await readFile(new URL('../../deploy/db-roles.sql', import.meta.url), 'utf8'));
    await app.pool.query(`ALTER ROLE mailbridge_app PASSWORD '${password}'`);
    // Applying it twice changes nothing and does not fail.
    await app.pool.query(await readFile(new URL('../../deploy/db-roles.sql', import.meta.url), 'utf8'));
    restricted = new pg.Pool({
        host: app.env.POSTGRES_HOST,
        port: app.env.POSTGRES_PORT,
        database: app.env.POSTGRES_DB,
        user: 'mailbridge_app',
        password,
        max: 2,
    });
});
beforeEach(() => app.reset());
after(async () => {
    await restricted?.end();
    await app.pool.query('DROP OWNED BY mailbridge_app');
    await app.pool.query('DROP ROLE mailbridge_app');
    await app.close();
});

const refused = async (sql: string, params: unknown[] = []) => {
    await assert.rejects(restricted.query(sql, params), (error: { code?: string }) => error.code === '42501', sql);
};

test('the app role can do what the app does', async () => {
    const { user } = await register(app, 'person@example.com');
    await restricted.query("INSERT INTO audit_events (user_id, event, outcome) VALUES ($1, 'sign-in', 'success')", [user.userId]);
    await restricted.query('UPDATE users SET display_name = $2 WHERE user_id = $1', [user.userId, 'Changed']);
    await restricted.query("INSERT INTO login_attempts (key, attempts, window_start) VALUES ('k', 1, NOW())");
    await restricted.query("DELETE FROM login_attempts WHERE key = 'k'");
    const { rows } = await restricted.query('SELECT count(*)::int AS n FROM audit_events WHERE user_id = $1', [user.userId]);
    assert.ok(rows[0].n >= 1);
});

test('the app role cannot rewrite or erase recent audit entries, nor switch the guard off', async () => {
    const { user } = await register(app, 'person@example.com');
    await refused('UPDATE audit_events SET outcome = $1', ['success']);
    await refused('TRUNCATE audit_events');
    await refused('ALTER TABLE audit_events DISABLE TRIGGER audit_events_guard_row');
    await refused('DROP TRIGGER audit_events_guard_row ON audit_events');
    await assert.rejects(restricted.query('DELETE FROM audit_events WHERE user_id = $1', [user.userId]), /insert-only/);
    const { rows } = await app.pool.query('SELECT count(*)::int AS n FROM audit_events WHERE user_id = $1', [user.userId]);
    assert.ok(rows[0].n >= 1, 'the entries are still there');
});

test('the app role cannot change the schema or other tables it does not need', async () => {
    await refused('CREATE TABLE stolen (data text)');
    await refused('DROP TABLE users');
    await refused('ALTER TABLE users ADD COLUMN is_admin boolean');
    await refused('TRUNCATE emails');
    await refused('SELECT * FROM pgmigrations');
    await refused('INSERT INTO pgmigrations (name, run_on) VALUES ($1, NOW())', ['999_fake']);
});

test('even the owner cannot update audit rows or delete recent ones; past-retention rows can go', async () => {
    const { user } = await register(app, 'person@example.com');
    await assert.rejects(app.pool.query("UPDATE audit_events SET outcome = 'success'"), /insert-only/);
    await assert.rejects(app.pool.query('DELETE FROM audit_events WHERE user_id = $1', [user.userId]), /insert-only/);
    await assert.rejects(app.pool.query('TRUNCATE audit_events'), /insert-only/);
    await app.pool.query(
        "INSERT INTO audit_events (user_id, event, outcome, occurred_at) VALUES ($1, 'sign-in', 'success', NOW() - INTERVAL '91 days')",
        [user.userId],
    );
    const removed = await restricted.query("DELETE FROM audit_events WHERE occurred_at < NOW() - INTERVAL '90 days'");
    assert.equal(removed.rowCount, 1);
});
