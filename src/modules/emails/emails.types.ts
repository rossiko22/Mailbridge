export interface MailFilters {
    offset: number;
    // null means every connected account ("All mail").
    accountId: string | null;
    unreadOnly: boolean;
    search: string;
    sort: 'newest' | 'oldest';
}
export const defaultFilters: MailFilters = { offset: 0, accountId: null, unreadOnly: false, search: '', sort: 'newest' };

export const PAGE_SIZE = 50;
