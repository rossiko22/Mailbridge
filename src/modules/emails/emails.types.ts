import type { MailFolder } from '../../integrations/mail/types.js';
import type { PageCursor } from './emails.schemas.js';

export interface MailFilters {
    // Continue after this row; null for the first page.
    after: PageCursor | null;
    // null means every connected account ("All mail").
    accountId: string | null;
    folder: MailFolder;
    unreadOnly: boolean;
    search: string;
    sort: 'newest' | 'oldest';
}
export const defaultFilters: MailFilters = { after: null, accountId: null, folder: 'inbox', unreadOnly: false, search: '', sort: 'newest' };

export const PAGE_SIZE = 50;
