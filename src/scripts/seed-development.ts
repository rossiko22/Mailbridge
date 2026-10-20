import { pool } from '../config/database.js';
import { DEMO_EMAIL, DEMO_PASSWORD, seedDemoData } from './demo-data.js';

async function main(): Promise<void> {
    try {
        if (process.env.NODE_ENV !== 'development') {
            throw new Error('Development seeding requires NODE_ENV=development.');
        }

        await seedDemoData(pool);
        console.log(`Development seed completed. Sign in as ${DEMO_EMAIL} / ${DEMO_PASSWORD} (two demo mailboxes).`);
    } finally {
        await pool.end();
    }
}

main().catch((error: unknown) => {
    console.error('Development seed failed:', error);
    process.exitCode = 1;
});
