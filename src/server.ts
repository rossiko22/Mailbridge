import { app } from './app.js';
import { pool, checkDatabaseConnection } from './config/database.js';

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535');

try {
    await checkDatabaseConnection();
    const server = app.listen(port, () => console.log(`Server running on http://localhost:${port}`));
    server.on('error', async error => { console.error('Server startup failed:', error.message); await pool.end(); process.exitCode = 1; });
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
        server.close(async () => { await pool.end(); });
        server.closeIdleConnections();
    });
} catch (error) {
    console.error('Database unavailable. Check configuration and run migrations.', error instanceof Error ? error.message : '');
    await pool.end();
    process.exitCode = 1;
}
