import type { Response } from 'express';

// The complete list of error codes the API answers with. Clients and tests match on these, never on the text.
// Adding a code is an API change: add it to contracts/openapi.yaml (ErrorCode) as well.
export const errorCodes = [
    'validation_failed', // 400 the request body or query does not match the contract
    'invalid_json', // 400 the body is not valid JSON
    'invalid_reset_token', // 400 the reset link is unknown, used or expired
    'wrong_password', // 400 the current password given for a change is incorrect
    'demo_mailbox', // 400 the action is not possible on a demo mailbox
    'unauthenticated', // 401 no valid session
    'invalid_credentials', // 401 wrong email or password at sign-in
    'registration_disabled', // 403 sign-up is turned off on this server
    'provider_denied', // 403 the mail provider refused the action
    'not_found', // 404 does not exist, or belongs to someone else
    'email_taken', // 409 an account with this email already exists
    'conflict', // 409 the request clashes with the current state (a reused send request ID, a sync in progress)
    'sync_expired', // 410 the provider's sync checkpoint expired
    'body_too_large', // 413 the request body or a download is over the limit
    'unsupported_request', // 415 not a same-site application/json request
    'rate_limited', // 429 too many attempts; see Retry-After
    'internal_error', // 500 anything unexpected; details only in the server log
    'provider_error', // 502 the mail provider failed or the outcome is uncertain
    'reconnect_required', // 502 the stored sign-in no longer works; connect the account again
    'unavailable', // 503 the provider is not configured on this server, or the mailbox is a demo
] as const;
export type ErrorCode = (typeof errorCodes)[number];

export interface ErrorDetail {
    path: string;
    message: string;
}

// An error whose message is safe to show to the person using the app.
export class AppError extends Error {
    constructor(
        public status: number,
        public code: ErrorCode,
        message: string,
        public details?: ErrorDetail[],
    ) {
        super(message);
    }
}

export function sendError(res: Response, status: number, code: ErrorCode, message: string, details?: ErrorDetail[]): void {
    res.status(status).json({ error: { code, message, ...(details?.length ? { details } : {}) } });
}
