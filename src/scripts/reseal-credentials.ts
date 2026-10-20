import { createPool } from '../config/database.js';
import { env } from '../config/env.js';
import { createAccountsRepository } from '../modules/accounts/accounts.repository.js';
import { createTokenVault } from '../security/token-vault.js';

// Step 2 of rotating TOKEN_ENCRYPTION_KEY: re-encrypts every stored mailbox credential with the current key.
// Run it after deploying with the new TOKEN_ENCRYPTION_KEY and the old one in TOKEN_ENCRYPTION_KEY_PREVIOUS;
// when it reports 0 failed, TOKEN_ENCRYPTION_KEY_PREVIOUS can be removed.
const pool = createPool(env);
try {
    const accounts = createAccountsRepository(pool, createTokenVault(env.TOKEN_ENCRYPTION_KEY, env.TOKEN_ENCRYPTION_KEY_PREVIOUS));
    const { resealed, failed } = await accounts.resealAll();
    console.log(`Re-encrypted ${resealed} credential(s); ${failed} could not be read with either key and need reconnecting.`);
    if (failed) process.exitCode = 2;
} catch (error) {
    console.error('Re-encryption failed:', error instanceof Error ? error.name : 'unknown error');
    process.exitCode = 1;
} finally {
    await pool.end();
}
