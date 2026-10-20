import { z } from 'zod';
import { displayName } from '../../http/validate.js';
import { MAX_AVATAR_BYTES } from './avatar.js';

// Request input of /users, as in contracts/openapi.yaml.

export const updateProfileBody = z.strictObject({ displayName });

export const avatarRule = `Choose a PNG, JPEG or WebP image of up to ${MAX_AVATAR_BYTES / 1024} KB.`;
// Only the outer shape is checked here; parseAvatar() checks the data URL and the real file signature.
export const avatarBody = z.strictObject({
    image: z.string({ error: avatarRule }).max(Math.ceil((MAX_AVATAR_BYTES * 4) / 3) + 64, { error: avatarRule }),
});

export const avatarQuery = z.strictObject({
    v: z
        .string()
        .regex(/^\d{1,16}$/)
        .optional(),
});
