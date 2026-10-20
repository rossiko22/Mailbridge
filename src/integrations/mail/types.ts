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

// Lets a provider refresh tokens safely: the account row stays locked while credentials change.
// Values passed in and out are plain; the store handles encryption.
export interface CredentialStore {
    withCredentials<T>(accountId: string, work: (current: string | null, save: (next: string) => Promise<void>) => Promise<T>): Promise<T>;
}

// Download size ceiling shared by every provider.
export const DOWNLOAD_LIMIT = 25 * 1024 * 1024;
