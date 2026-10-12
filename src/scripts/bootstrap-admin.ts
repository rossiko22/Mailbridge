import { pool } from '../config/database.js';
import { hashPassword } from '../security/password.js';

try {
    const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length < 16 || password.length > 1024) {
        throw new Error('Provide BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD (16–1024 characters) through the environment.');
    }
    const hash = await hashPassword(password);
    const result = await pool.query(`INSERT INTO users(email,password_hash,role,avatar_path)
        VALUES ($1,$2,2,'/assets/images/company-mail-logo.png') ON CONFLICT (lower(email)) DO NOTHING RETURNING user_id`, [email,hash]);
    console.log(result.rowCount ? 'Administrator created. Remove bootstrap credentials from your environment.' : 'Account already exists; it was not modified.');
} catch (error) { console.error(error instanceof Error ? error.message : 'Administrator setup failed'); process.exitCode = 1; }
finally { await pool.end(); }
