import { pool } from '../config/database.js';
import { hashPassword } from '../security/password.js';
import { findByEmail, updatePassword } from '../modules/users/users.repository.js';

try {
    const email = process.env.RESET_USER_EMAIL?.trim();
    const password = process.env.RESET_USER_PASSWORD;
    if (!email || !password || password.length < 16 || password.length > 1024) throw new Error('Provide RESET_USER_EMAIL and RESET_USER_PASSWORD (16–1024 characters).');
    const user = await findByEmail(email);
    if (!user) throw new Error('Account not found.');
    await updatePassword(user.userId, await hashPassword(password));
    console.log('Password reset; existing sessions revoked. Remove reset credentials from the environment.');
} catch (error) { console.error(error instanceof Error ? error.message : 'Password reset failed'); process.exitCode = 1; }
finally { await pool.end(); }
