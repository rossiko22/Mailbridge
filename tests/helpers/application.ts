// Real Express + PostgreSQL, isolated synthetic records, simulated Microsoft Graph.
import { createHmac, randomUUID } from 'node:crypto';
import type { NewMessage } from '../../src/integrations/outlook/graph.js';

export async function applicationFixture() {
    const key = randomUUID();
    const mailbox = `qa-${key}@example.invalid`;
    const ownerEmail = `owner-${key}@example.invalid`;
    const teammateEmail = `teammate-${key}@example.invalid`;
    process.env.NODE_ENV = 'test';
    process.env.SESSION_SECRET = `qa-secret-${key}`;
    delete process.env.PUBLIC_ORIGIN;
    process.env.GRAPH_AUTH_MODE = 'access_token';
    process.env.GRAPH_ACCESS_TOKEN = 'synthetic-test-token';
    process.env.GRAPH_MAILBOX = mailbox;
    process.env.GRAPH_OWNER_EMAIL = ownerEmail;
    const realFetch = globalThis.fetch;
    const outlookState = { expired: false };
    const sent: { url: string; body: unknown }[] = [];
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    globalThis.fetch = async (input, init) => {
        const url = String(input);
        if (!url.startsWith('https://graph.microsoft.com/')) {
            if (!url.startsWith('http://127.0.0.1:')) throw new Error('Test blocked an unexpected external request');
            return realFetch(input, init);
        }
        if (outlookState.expired) return json({error:'Expired fixture token'},401);
        if (url.includes('/me?')) return json({ id: key, mail: mailbox });
        if (init?.method === 'POST') { sent.push({ url, body: JSON.parse(String(init.body)) }); return new Response(null, { status: 202 }); }
        if (url.includes('/attachments/file-1/$value')) return new Response('Synthetic attachment content');
        if (url.includes('/attachments')) return json({ value: [{ id: 'file-1', name: 'sample.txt', size: 28, contentType: 'text/plain', '@odata.type': '#microsoft.graph.fileAttachment' }] });
        if (url.endsWith('/$value')) return new Response('MIME-Version: 1.0\r\nSubject: Original fixture\r\n\r\nSynthetic MIME');
        if (url.includes('/messages/delta')) return json({ value: [{ id: 'fixture-message', subject: 'QA workflow message',
            from: { emailAddress: { name: 'Test Sender', address: 'sender@example.invalid' } },
            bodyPreview: 'Thanks for joining. Your workspace is ready. Manage subscription and view your receipt.',
            body: { contentType: 'text', content: '<script>unsafe()</script>\nSynthetic mail for automated verification.' },
            receivedDateTime: '2026-10-01T12:00:00Z', hasAttachments: true }],
            ...(url.includes('$skiptoken=fixture') || url.includes('$deltatoken=fixture')
                ? { '@odata.deltaLink': "https://graph.microsoft.com/v1.0/me/mailFolders('inbox')/messages/delta?$deltatoken=fixture" }
                : { '@odata.nextLink': "https://graph.microsoft.com/v1.0/me/mailFolders('inbox')/messages/delta?$skiptoken=fixture" }) });
        if (url.includes('/messages/fixture-message?$select=body')) {
            if (!String(new Headers(init?.headers).get('Prefer')).includes('outlook.body-content-type="html"')) throw new Error('HTML preference missing');
            return json({ body: { contentType: 'html', content: `<html><head><style>body{background:red}</style></head><body>
                <div style="max-width:600px;margin:0 auto;padding:24px"><img src="https://images.example.invalid/logo.png" alt="Acme" width="96">
                <h1 style="font-size:26px;color:#172b4d">Your subscription is confirmed</h1>
                <p>Thanks for joining. Your workspace is ready.</p><p><a href="https://example.invalid/account?tracking=long-token" style="display:inline-block;padding:12px 18px;background-color:#245bd7;color:#ffffff;border-radius:6px">Manage subscription</a></p>
                <table style="width:100%;border-collapse:collapse"><tr><th align="left">Plan</th><th align="right">Amount</th></tr><tr><td>Team subscription</td><td align="right">€18.85</td></tr><tr><td>Discount</td><td align="right">−€18.85</td></tr><tr><td><strong>Total</strong></td><td align="right"><strong>€0.00</strong></td></tr></table>
                <p style="color:#64748b;font-size:12px">Questions? <a href="https://example.invalid/help">Visit our help center</a>.</p></div>
                <script>parent.document.body.dataset.compromised='yes'</script><img src="https://images.example.invalid/tracker.png" onerror="alert(1)"><form action="https://example.invalid/steal"><input name="password"></form>
                </body></html>` } });
        }
        throw new Error(`Unhandled Microsoft fixture URL: ${url}`);
    };
    const { pool } = await import('../../src/config/database.js');
    const { hashPassword } = await import('../../src/security/password.js');
    const password = 'Automated-Test-Password-123!';
    const passwordHash = await hashPassword(password);
    const users = await pool.query(`INSERT INTO users(email,password_hash,role,avatar_path) VALUES ($1,$3,2,''),($2,$3,1,'') RETURNING user_id,email`,
        [ownerEmail,teammateEmail,passwordHash]);
    const owner = users.rows.find(row => row.email === ownerEmail).user_id;
    const teammate = users.rows.find(row => row.email === teammateEmail).user_id;
    const { app } = await import('../../src/app.js');
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server address');
    const base = `http://127.0.0.1:${address.port}`;
    const request = (path: string, method = 'GET', body?: unknown, cookie = '') => realFetch(`${base}${path}`, {
        method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    async function login(email = ownerEmail) {
        const response = await request('/auth/login', 'POST', { email, password });
        if (response.status !== 200) throw new Error(`Fixture login failed: ${response.status}`);
        return response.headers.get('set-cookie')!.split(';')[0]!;
    }
    async function cleanup() {
        await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
        globalThis.fetch = realFetch;
        try {
            await pool.query('DELETE FROM email_outgoing WHERE email_id IN (SELECT email_id FROM emails WHERE mailbox=$1)', [mailbox]);
            await pool.query('DELETE FROM email_activity WHERE email_id IN (SELECT email_id FROM emails WHERE mailbox=$1)', [mailbox]);
            await pool.query('DELETE FROM emails WHERE mailbox=$1', [mailbox]);
            await pool.query('DELETE FROM mailbox_outgoing WHERE mailbox=$1', [mailbox]);
            await pool.query('DELETE FROM mailbox_sync WHERE mailbox=$1', [mailbox]);
            await pool.query('DELETE FROM outlook_connections WHERE mailbox=$1', [mailbox]);
            const result = await pool.query('SELECT user_id FROM users WHERE email LIKE $1', [`%${key}@example.invalid`]);
            const ids = result.rows.map(row => row.user_id);
            await pool.query("DELETE FROM sessions WHERE sess->>'userId'=ANY($1::text[])", [ids]);
            await pool.query('DELETE FROM users WHERE user_id=ANY($1::uuid[])', [ids]);
            const keys = ['ip:127.0.0.1', `account:${ownerEmail}`, `account:${teammateEmail}`, `account:new-${key}@example.invalid`].map(value => createHmac('sha256', process.env.SESSION_SECRET!).update(value).digest('hex'));
            await pool.query('DELETE FROM login_attempts WHERE key=ANY($1::text[])', [keys]);
        } finally { await pool.end(); }
    }
    const message: NewMessage = { subject: 'A new QA message', body: 'Synthetic content', to: ['recipient@example.invalid'], cc: [], bcc: [] };
    return { key, mailbox, ownerEmail, teammateEmail, owner, teammate, password, base, pool, sent, outlookState, request, login, cleanup, message };
}
