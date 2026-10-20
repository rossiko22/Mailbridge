import { Pool, type PoolClient } from 'pg';

export interface DatabaseConfig {
    POSTGRES_HOST: string;
    POSTGRES_PORT: number;
    POSTGRES_DB: string;
    POSTGRES_USER: string;
    POSTGRES_PASSWORD: string;
}

// Only entry points (server, scripts, tests) create a pool; everything else receives it as a parameter.
export function createPool(config: DatabaseConfig): Pool {
    const pool = new Pool({
        host: config.POSTGRES_HOST,
        port: config.POSTGRES_PORT,
        database: config.POSTGRES_DB,
        user: config.POSTGRES_USER,
        password: config.POSTGRES_PASSWORD,

        max: 10,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
    });
    // Handles unexpected errors from connections sitting idle in the pool.
    pool.on('error', error => {
        console.error('Unexpected PostgreSQL pool error:', error.message);
    });
    return pool;
}

// Runs `work` inside BEGIN/COMMIT on one connection. Any error rolls back and is rethrown.
export async function withTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

export const REQUIRED_TABLES = [
    'users',
    'sessions',
    'login_attempts',
    'password_resets',
    'user_avatars',
    'mail_accounts',
    'emails',
    'email_bodies',
    'outgoing_messages',
    'audit_events',
] as const;

// Call and await this during startup, before app.listen().
export async function checkDatabaseConnection(pool: Pool): Promise<void> {
    await pool.query('SELECT 1');
    const result = await pool.query<{ name: string }>('SELECT t AS name FROM unnest($1::text[]) AS t WHERE to_regclass(t) IS NULL', [
        REQUIRED_TABLES,
    ]);
    const missing = result.rows[0]?.name;
    if (missing) throw new Error(`Missing database table ${missing}. Run migrations before starting the server.`);
}
