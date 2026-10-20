import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import { env } from '../config/env.js';

async function main(): Promise<void> {
    await runner({
        databaseUrl: {
            host: env.POSTGRES_HOST,
            port: env.POSTGRES_PORT,
            database: env.POSTGRES_DB,
            user: env.POSTGRES_USER,
            password: env.POSTGRES_PASSWORD,
            connectionTimeoutMillis: 5_000,
        },

        dir: fileURLToPath(new URL('../../database/migrations', import.meta.url)),

        migrationsTable: 'pgmigrations',
        direction: 'up',
        checkOrder: true,
        singleTransaction: true,
    });

    console.log('Database migrations completed.');
}

main().catch((error: unknown) => {
    console.error('Database migration failed:', error);
    process.exitCode = 1;
});
