import { z } from 'zod';
import { recipient, uuid } from '../../http/validate.js';

// Request input of /emails, as in contracts/openapi.yaml.

export const MAX_RECIPIENTS = 20;
const recipientsRule = `Enter valid recipient email addresses (maximum ${MAX_RECIPIENTS}).`;
const recipients = z.array(recipient, { error: recipientsRule }).max(MAX_RECIPIENTS, { error: recipientsRule });

export const emailIdParams = z.object({ id: uuid('Invalid email ID.') });

export const listQuery = z.strictObject({
    cursor: z
        .string()
        .regex(/^[A-Za-z0-9_-]{1,200}$/, { error: 'Invalid page cursor.' })
        .optional(),
    sort: z.enum(['newest', 'oldest'], { error: 'Invalid mailbox filters.' }).default('newest'),
    search: z.string({ error: 'Invalid mailbox filters.' }).max(200, { error: 'Search for at most 200 characters.' }).trim().default(''),
    account: uuid('Invalid mailbox filters.').optional(),
    unread: z.enum(['true', 'false'], { error: 'Invalid mailbox filters.' }).optional(),
});

export const composeBody = z
    .strictObject({
        accountId: uuid('Choose an account to send from.'),
        requestId: uuid('Invalid request ID.'),
        subject: z
            .string({ error: 'Enter a subject.' })
            .max(250, { error: 'Use a subject of at most 250 characters.' })
            .regex(/^[^\r\n]*$/, { error: 'A subject cannot contain line breaks.' })
            .refine(value => value.trim() !== '', { error: 'Enter a subject.' }),
        body: z
            .string({ error: 'Enter a message.' })
            .max(20_000, { error: 'Use a message of at most 20,000 characters.' })
            .refine(value => value.trim() !== '', { error: 'Enter a message.' }),
        to: recipients.min(1, { error: 'Add at least one recipient.' }),
        cc: recipients.default([]),
        bcc: recipients.default([]),
    })
    .refine(message => message.to.length + message.cc.length + message.bcc.length <= MAX_RECIPIENTS, {
        error: `Send to at most ${MAX_RECIPIENTS} people in total.`,
        path: ['to'],
    });

export const readBody = z.strictObject({ isRead: z.boolean({ error: 'isRead must be true or false.' }) });

export const bodyQuery = z.strictObject({ images: z.literal('true', { error: 'images must be true or omitted.' }).optional() });
export const exportQuery = z.strictObject({ original: z.literal('true', { error: 'original must be true or omitted.' }).optional() });

export const attachmentParams = z.object({
    id: uuid('Invalid email ID.'),
    attachmentId: z
        .string()
        .min(1)
        .max(2048, { error: 'Invalid attachment ID.' })
        .regex(/^[^\r\n\x00]+$/, { error: 'Invalid attachment ID.' }),
});

const comment = z.string({ error: 'Enter a message.' }).max(20_000, { error: 'Use a message of at most 20,000 characters.' });
export const sendBody = z.discriminatedUnion(
    'action',
    [
        z.strictObject({
            action: z.literal('reply'),
            requestId: uuid('Invalid request ID.'),
            comment: comment.refine(value => value.trim() !== '', { error: 'Enter a message.' }),
            recipients: z.array(z.string()).max(0, { error: 'A reply goes to the sender; do not add recipients.' }).default([]),
        }),
        z.strictObject({
            action: z.literal('forward'),
            requestId: uuid('Invalid request ID.'),
            comment,
            recipients: recipients.min(1, { error: 'Add at least one recipient.' }),
        }),
    ],
    { error: 'Choose reply or forward.' },
);

// The page cursor is opaque to clients: base64url of the sort it belongs to and the last row's sort key and ID.
// The key is the received time in UTC with microseconds, or -infinity for mail without a date (the oldest).
// Its exact format is checked because it goes back into SQL as a timestamp.
const sortKey = z.string().regex(/^(-infinity|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z)$/);
const cursorPayload = z.tuple([
    z.enum(['newest', 'oldest']),
    sortKey,
    z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
]);
export type PageCursor = { sort: 'newest' | 'oldest'; key: string; id: string };

export function encodeCursor(cursor: PageCursor): string {
    return Buffer.from(JSON.stringify([cursor.sort, cursor.key, cursor.id])).toString('base64url');
}

export function decodeCursor(value: string): PageCursor | null {
    try {
        const parsed = cursorPayload.safeParse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
        return parsed.success ? { sort: parsed.data[0], key: parsed.data[1], id: parsed.data[2] } : null;
    } catch {
        return null;
    }
}
