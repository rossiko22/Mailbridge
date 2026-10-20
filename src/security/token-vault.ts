import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';

// Encrypts stored mailbox credentials with AES-256-GCM. The account ID is bound in as associated data, so a
// stored credential cannot be copied onto a different account row and still decrypt.
//
// Format: v2.<key id>.<iv>.<tag>.<data> (base64url parts). The key ID is a short fingerprint of the key, so the
// vault can tell which secret sealed a value and keys can be rotated: set the new secret as the current one and the
// old one as `previous`, let values be re-encrypted (on use, or with the rotation script), then drop `previous`.
// Values written before rotation existed (v1: <iv>.<tag>.<data>, base64) still decrypt and count as stale.

const KEY_INFO = 'mailbridge/mail-credentials/v2';
const IV_BYTES = 12;
const TAG_BYTES = 16;

interface Key {
    id: string;
    key: Buffer;
}

function deriveKey(secret: string): Key {
    // HKDF turns the configured secret into a 256-bit key that is used for nothing else.
    const key = Buffer.from(hkdfSync('sha256', secret, 'mailbridge', KEY_INFO, 32));
    const id = createHash('sha256').update(key).digest('base64url').slice(0, 8);
    return { id, key };
}

// The key derivation of the first version, kept only to read old values.
const legacyKey = (secret: string) => createHash('sha256').update(`mail-credentials-v1:${secret}`).digest();

function open(key: Buffer, iv: Buffer, tag: Buffer, data: Buffer, context: string): string {
    // GCM would otherwise accept a shortened tag (down to 4 bytes), which makes forging a ciphertext far easier.
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error('Invalid encrypted credentials');
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export interface Opened {
    value: string;
    // Sealed with an older key or format: re-encrypt it with the current key when convenient.
    stale: boolean;
}

export function createTokenVault(current: string, previous?: string) {
    const keys = [deriveKey(current), ...(previous ? [deriveKey(previous)] : [])];
    const [active] = keys as [Key, ...Key[]];
    const legacy = [current, ...(previous ? [previous] : [])].map(legacyKey);

    return {
        keyId: active.id,

        seal(value: string, context: string): string {
            const iv = randomBytes(IV_BYTES);
            const cipher = createCipheriv('aes-256-gcm', active.key, iv, { authTagLength: TAG_BYTES });
            cipher.setAAD(Buffer.from(context));
            const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
            return ['v2', active.id, ...[iv, cipher.getAuthTag(), data].map(part => part.toString('base64url'))].join('.');
        },

        open(sealed: string, context: string): Opened {
            const parts = sealed.split('.');
            if (parts[0] === 'v2' && parts.length === 5) {
                const key = keys.find(item => item.id === parts[1]);
                if (!key) throw new Error('Invalid encrypted credentials');
                const [iv, tag, data] = parts.slice(2).map(part => Buffer.from(part, 'base64url')) as [Buffer, Buffer, Buffer];
                return { value: open(key.key, iv, tag, data, context), stale: key !== active };
            }
            if (parts.length === 3) {
                const [iv, tag, data] = parts.map(part => Buffer.from(part, 'base64')) as [Buffer, Buffer, Buffer];
                for (const key of legacy) {
                    try {
                        return { value: open(key, iv, tag, data, context), stale: true };
                    } catch {
                        // Try the next configured secret.
                    }
                }
            }
            throw new Error('Invalid encrypted credentials');
        },
    };
}
export type TokenVault = ReturnType<typeof createTokenVault>;
