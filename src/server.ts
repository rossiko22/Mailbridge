import { createApp } from './app.js';
import { checkDatabaseConnection, createPool } from './config/database.js';
import { env } from './config/env.js';

const pool = createPool(env);
try {
    await checkDatabaseConnection(pool);
    console.log('PostgreSQL connection and schema checks successful');
    const server = createApp({ pool, env }).listen(env.PORT, () => console.log(`Server running on http://localhost:${env.PORT}`));
    server.on('error', async error => {
        console.error('Server startup failed:', error.message);
        await pool.end();
        process.exitCode = 1;
    });
    for (const signal of ['SIGINT', 'SIGTERM'] as const)
        process.once(signal, () => {
            server.close(async () => {
                await pool.end();
            });
            server.closeIdleConnections();
        });
} catch (error) {
    console.error('Database unavailable. Check configuration and run migrations.', error instanceof Error ? error.message : '');
    await pool.end();
    process.exitCode = 1;
}
