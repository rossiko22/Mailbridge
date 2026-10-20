import { z } from 'zod';
import { AppError } from './errors.js';

// Checks input against a schema and returns the typed, cleaned value, or throws 400 validation_failed.
// The first problem's message becomes the error message people see; `details` lists every field that failed,
// by path only, never echoing the submitted value. `message` replaces the text where a hint would reveal too much.
export function parse<T extends z.ZodType>(schema: T, input: unknown, message?: string): z.output<T> {
    const result = schema.safeParse(input);
    if (result.success) return result.data;
    const details = result.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message }));
    throw new AppError(400, 'validation_failed', message ?? details[0]?.message ?? 'Invalid request.', details);
}

// Rules shared by several modules. They mirror contracts/openapi.yaml (components/schemas).
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 1024;
export const EMAIL_MAX = 254;
export const MAX_DISPLAY_NAME = 80;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const uuid = (message = 'Invalid ID.') => z.string({ error: message }).regex(UUID, { error: message });

// A format check only; it does not prove the address belongs to the person.
export const emailAddress = z
    .string({ error: 'Enter a valid email address.' })
    .max(EMAIL_MAX, { error: 'Enter a valid email address.' })
    .trim()
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { error: 'Enter a valid email address.' });

export const passwordRule = `Use a password of ${PASSWORD_MIN}–${PASSWORD_MAX} characters.`;
export const newPassword = z
    .string({ error: passwordRule })
    .min(PASSWORD_MIN, { error: passwordRule })
    .max(PASSWORD_MAX, { error: passwordRule });

const nameRule = `Enter a name of up to ${MAX_DISPLAY_NAME} characters.`;
export const displayName = z
    .string({ error: nameRule })
    .regex(/^[^\x00-\x1f\x7f]*$/, { error: nameRule })
    .trim()
    .max(MAX_DISPLAY_NAME, { error: nameRule });

// One recipient: no spaces, commas, semicolons or angle brackets, so it can never smuggle a second address or a header.
export const recipient = z
    .string({ error: 'Enter valid recipient email addresses.' })
    .max(EMAIL_MAX, { error: 'Enter valid recipient email addresses.' })
    .regex(/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/, { error: 'Enter valid recipient email addresses.' });

// A request body that may be empty or {} but nothing else (POSTs and DELETEs that take no input).
export const emptyBody = z.strictObject({}).optional();
