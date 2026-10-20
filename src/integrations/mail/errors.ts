// An error whose message is safe to show to the person using the app.
// Anything else thrown while talking to a provider is treated as an uncertain outcome.
// `reconnect` means the stored sign-in no longer works and the account must be connected again.
export class MailError extends Error {
    constructor(
        public status: number,
        message: string,
        public reconnect = false,
    ) {
        super(message);
    }
}
