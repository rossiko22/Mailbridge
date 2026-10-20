import 'dotenv/config';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import pg from 'pg';

// Integration and browser tests get a database of their own, so they can never touch development data.
const base = process.env.POSTGRES_DB ?? 'mailbridge';
export const database = base.endsWith('_test') ? base : `${base}_test`;

Object.assign(process.env, {
    NODE_ENV: 'test',
    POSTGRES_DB: database,
    PUBLIC_ORIGIN: '',
    TRUST_PROXY: '',
    ALLOW_REGISTRATION: 'true',
    SESSION_SECRET: process.env.SESSION_SECRET || 'test-only-session-secret',
    TOKEN_ENCRYPTION_KEY: '',
    // A made-up Google app makes the OAuth redirect testable offline. Outlook stays unconfigured.
    GOOGLE_CLIENT_ID: 'test-client-id',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
    MICROSOFT_CLIENT_ID: '',
    MICROSOFT_CLIENT_SECRET: '',
    GMAIL_ALLOWED_EMAILS: '',
    SMTP_HOST: '',
});

const connection = () => ({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
});

async function prepareDatabase() {
    const admin = new pg.Client({ ...connection(), database: 'postgres' });
    await admin.connect();
    try {
        const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
        if (!existing.rowCount) await admin.query(`CREATE DATABASE "${database.replace(/"/g, '""')}"`);
    } finally {
        await admin.end();
    }
    await runner({
        databaseUrl: { ...connection(), database },
        dir: fileURLToPath(new URL('../../database/migrations', import.meta.url)),
        migrationsTable: 'pgmigrations',
        direction: 'up',
        checkOrder: true,
        singleTransaction: true,
        log: () => {},
    });
}

// Stands in for Google or Microsoft. Return undefined to let a request through to the real network.
export type Upstream = (url: URL, init: RequestInit) => Response | undefined | Promise<Response | undefined>;

export async function startApp() {
    let upstream: Upstream | undefined;
    const realFetch = globalThis.fetch;
    // Installed before the app loads, because the mail providers keep a reference to fetch.
    globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.hostname === '127.0.0.1') return realFetch(input, init);
        const answer = await upstream?.(url, init);
        if (answer) return answer;
        throw new Error(`Unexpected outbound request in a test: ${url.origin}${url.pathname}`);
    }) as typeof fetch;

    await prepareDatabase();
    const { app } = await import('../../src/app.js');
    const { pool } = await import('../../src/config/database.js');
    const { env } = await import('../../src/config/env.js');
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');

    return {
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        pool,
        env,
        setUpstream(next: Upstream | undefined) {
            upstream = next;
        },
        async reset() {
            upstream = undefined;
            await pool.query('TRUNCATE users, sessions, login_attempts CASCADE');
        },
        async close() {
            globalThis.fetch = realFetch;
            server.closeAllConnections();
            await new Promise(resolve => server.close(resolve));
            await pool.end();
        },
    };
}
export type TestApp = Awaited<ReturnType<typeof startApp>>;

// A small browser stand-in: sends JSON and keeps cookies between requests.
export function createClient(base: string) {
    const cookies = new Map<string, string>();
    async function request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
        const response = await fetch(base + path, {
            method,
            redirect: 'manual',
            headers: {
                ...(cookies.size ? { Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') } : {}),
                ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
                ...headers,
            },
            ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
        });
        for (const line of response.headers.getSetCookie()) {
            const pair = line.split(';')[0]!;
            const name = pair.slice(0, pair.indexOf('='));
            const value = pair.slice(pair.indexOf('=') + 1);
            if (!value || /expires=Thu, 01 Jan 1970/i.test(line)) cookies.delete(name);
            else cookies.set(name, value);
        }
        return response;
    }
    return {
        cookies,
        request,
        get: (path: string, headers?: Record<string, string>) => request('GET', path, undefined, headers),
        post: (path: string, body: unknown = {}, headers?: Record<string, string>) => request('POST', path, body, headers),
        patch: (path: string, body: unknown = {}) => request('PATCH', path, body),
        put: (path: string, body: unknown = {}) => request('PUT', path, body),
        delete: (path: string) => request('DELETE', path, {}),
    };
}
export type TestClient = ReturnType<typeof createClient>;

export const PASSWORD = 'correct-horse-battery';

export async function register(app: TestApp, email: string, password = PASSWORD) {
    const client = createClient(app.url);
    const response = await client.post('/auth/register', { email, password, displayName: 'Test Person' });
    if (response.status !== 201) throw new Error(`Could not register ${email}: ${response.status}`);
    const { user } = (await response.json()) as { user: { userId: string; email: string } };
    return { client, user };
}
