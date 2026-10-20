// Types for the browser scripts in public/js, checked by `npm run typecheck` (tsconfig.public.json). Not served.
// The scripts share code through two globals, set by core.js and theme.js.

interface MailbridgeUser {
    userId: string;
    email: string;
    displayName: string;
    avatarUrl: string | null;
}

interface MailbridgeApp {
    APP_NAME: string;
    icon(name: string, extra?: string): string;
    // biome-ignore lint/suspicious/noExplicitAny: responses are untyped JSON in the browser scripts; the API contract describes them.
    api(path: string, options?: RequestInit): Promise<any>;
    json(method: string, body?: unknown): RequestInit;
    download(path: string, fallbackName: string): Promise<void>;
    avatar(options: { name?: string; key?: string; url?: string | null; size?: string }): HTMLElement;
    initials(text: string): string;
    personColor(key: string): number;
    displayName(user: MailbridgeUser): string;
    toast(message: string, tone?: 'info' | 'success' | 'error'): void;
    popover(trigger: HTMLElement, menu: HTMLElement): { close(focus?: boolean): void };
    whoAmI(): Promise<MailbridgeUser>;
    mountAppbar(options?: { search?: boolean }): void;
    paintProfile(user: MailbridgeUser): void;
    setNav(open: boolean): void;
    shortDate(value: string | null): string;
    longDate(value: string | null): string;
    providerName(provider: string): string;
}

interface Window {
    App: MailbridgeApp;
    Theme: { apply(): void; set(theme: string): void; get(): string };
}
