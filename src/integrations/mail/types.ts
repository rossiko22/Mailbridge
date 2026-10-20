export type ProviderId = 'outlook' | 'gmail';
export const providerIds: readonly ProviderId[] = ['outlook', 'gmail'];

// First sync only fetches recent mail so a large mailbox appears quickly.
export const INITIAL_SYNC_DAYS = 90;

// Providers send partial updates. Only keys present in `fields` overwrite stored values.
export interface SyncedFields {
    subject: string;
    sender: { name: string; address: string };
    preview: string;
    bodyText: string;
    receivedAt: string | null;
    hasAttachments: boolean;
    isRead: boolean;
}
export interface SyncedMessage {
    id: string;
    removed?: boolean;
    fields: Partial<SyncedFields>;
}
export interface SyncPage {
    messages: SyncedMessage[];
    cursor: string;
    hasMore: boolean;
}

export interface MailBody {
    contentType: 'html' | 'text';
    content: string;
}
export interface MailAttachment {
    id: string;
    name: string;
    size: number;
    contentType: string;
    cloudLink?: boolean;
}
export interface NewMessage {
    subject: string;
    body: string;
    to: string[];
    cc: string[];
    bcc: string[];
}

// What the rest of the application may ask of any connected account, whichever provider it uses.
export interface MailClient {
    sync(cursor: string | null): Promise<SyncPage>;
    body(id: string): Promise<MailBody>;
    attachments(id: string): Promise<MailAttachment[]>;
    attachment(id: string, attachmentId: string): Promise<{ name: string; data: Buffer }>;
    mime(id: string): Promise<Buffer>;
    send(id: string, action: 'reply' | 'forward', comment: string, recipients: string[]): Promise<void>;
    compose(message: NewMessage): Promise<void>;
    setRead(id: string, isRead: boolean): Promise<void>;
}

// A sign-in that has been started but not yet completed. Kept in the user's session.
export interface PendingAuth {
    provider: ProviderId;
    state: string;
    verifier: string;
    expiresAt: number;
}

// `credentials` is plain JSON here; the credential store encrypts it before it reaches the database.
export interface ConnectedProfile {
    email: string;
    displayName: string;
    credentials: string;
}

export interface MailProvider {
    begin(): Promise<{ url: string; pending: PendingAuth }>;
    complete(code: string, pending: PendingAuth): Promise<ConnectedProfile>;
    client(accountId: string): MailClient;
}

// Decrypted credentials of one account. Plain values in and out; the store handles encryption.
export interface StoredCredentials {
    value: string;
    // Saves new credentials only if nobody changed them since they were loaded (compare-and-swap).
    // Returns false when another request saved first; its credentials are just as fresh, so this is not an error.
    replace(next: string): Promise<boolean>;
}

// No lock is held while a provider talks to the network: credentials are read, a refresh (rarely) happens,
// and the result is written back with compare-and-swap.
export interface CredentialStore {
    load(accountId: string): Promise<StoredCredentials | null>;
}

// Runs at most one `work` per key at a time in this process; concurrent callers share its result.
export function singleFlight<T>() {
    const running = new Map<string, Promise<T>>();
    return (key: string, work: () => Promise<T>): Promise<T> => {
        const existing = running.get(key);
        if (existing) return existing;
        const started = work().finally(() => running.delete(key));
        running.set(key, started);
        return started;
    };
}

// Download size ceiling shared by every provider.
export const DOWNLOAD_LIMIT = 25 * 1024 * 1024;
