import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// AES-256-GCM with the account ID bound in as associated data, so a stored
// credential cannot be copied onto a different account row and still decrypt.
export function tokenVault(secret: string, context: string) {
    const key = createHash('sha256').update(`mail-credentials-v1:${secret}`).digest();
    return {
        encrypt(value: string) {
            const iv = randomBytes(12);
            const cipher = createCipheriv('aes-256-gcm', key, iv);
            cipher.setAAD(Buffer.from(context));
            const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
            return [iv, cipher.getAuthTag(), data].map(item => item.toString('base64')).join('.');
        },
        decrypt(value: string) {
            const [iv, tag, data] = value.split('.').map(item => Buffer.from(item, 'base64'));
            if (!iv || !tag || !data) throw new Error('Invalid encrypted credentials');
            // GCM would otherwise accept a shortened tag (down to 4 bytes), which makes forging a ciphertext far easier.
            if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid encrypted credentials');
            const cipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
            cipher.setAAD(Buffer.from(context));
            cipher.setAuthTag(tag);
            return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8');
        },
    };
}
