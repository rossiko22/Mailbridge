// Explicit local integration check; all test records are rolled back.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '../src/config/database.js';
import { createEmailRepository } from '../src/modules/emails/emails.repository.js';

const client = await pool.connect();
try {
    await client.query('BEGIN');
    const mailbox = `test-${randomUUID()}@example.invalid`;
    const repository = createEmailRepository(pool);
    await repository.save(client, mailbox, { id: 'same-message', subject: 'first', body: { contentType: 'text', content: 'body' } });
    await repository.save(client, mailbox, { id: 'same-message', subject: 'updated', body: { contentType: 'text', content: 'updated body' } });
    await repository.save(client, mailbox, { id: 'same-message', isRead: true });
    await repository.save(client, mailbox, { id: 'same-message', '@removed': { reason: 'deleted' } });
    const result = await client.query('SELECT subject, body_text FROM emails WHERE mailbox=$1', [mailbox]);
    assert.deepEqual(result.rows, [{ subject: 'updated', body_text: 'updated body' }]);
    console.log('PostgreSQL import: duplicate updates and deleted-message retention passed.');
} finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
}
