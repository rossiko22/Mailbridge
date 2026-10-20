import type { AvatarImage } from './users.types.js';

export const MAX_AVATAR_BYTES = 512 * 1024;

const signatures: Record<AvatarImage['contentType'], (data: Buffer) => boolean> = {
    'image/png': data => data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'image/jpeg': data => data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff,
    'image/webp': data => data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP',
};

// Accepts only a base64 data URL of a real PNG, JPEG or WebP no larger than 512 KiB.
// The browser shrinks photos before uploading; this is the server's own check, not a trust in the label.
export function parseAvatar(value: unknown): { contentType: AvatarImage['contentType']; data: Buffer } | null {
    if (typeof value !== 'string' || value.length > Math.ceil((MAX_AVATAR_BYTES * 4) / 3) + 64) return null;
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (!match) return null;
    const contentType = match[1] as AvatarImage['contentType'];
    const data = Buffer.from(match[2]!, 'base64');
    if (data.length === 0 || data.length > MAX_AVATAR_BYTES || !signatures[contentType](data)) return null;
    return { contentType, data };
}
