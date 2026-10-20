import { AppError, type ErrorCode } from '../../http/errors.js';

const codeFor = (status: number): ErrorCode =>
    (
        ({
            400: 'validation_failed',
            403: 'provider_denied',
            404: 'not_found',
            409: 'conflict',
            410: 'sync_expired',
            413: 'body_too_large',
            429: 'rate_limited',
            503: 'unavailable',
        }) as Record<number, ErrorCode>
    )[status] ?? 'provider_error';

// An error whose message is safe to show to the person using the app.
// Anything else thrown while talking to a provider is treated as an uncertain outcome.
// `reconnect` means the stored sign-in no longer works and the account must be connected again.
export class MailError extends AppError {
    constructor(
        status: number,
        message: string,
        public reconnect = false,
        code: ErrorCode = reconnect ? 'reconnect_required' : codeFor(status),
    ) {
        super(status, code, message);
    }
}
