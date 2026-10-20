import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionCookie } from '../src/middleware/session.middleware.js';

test('production pins the session cookie to this host over HTTPS with the __Host- prefix', () => {
    assert.deepEqual(sessionCookie(true), { name: '__Host-session', secure: true });
    assert.deepEqual(sessionCookie(false), { name: 'session', secure: false }, 'plain HTTP in development cannot use the prefix');
});
