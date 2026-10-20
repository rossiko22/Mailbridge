// Shared input rules for sign-up, sign-in and password changes.
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 1024;
export const EMAIL_MAX = 254;

// A format check only; it does not prove the address belongs to the person.
export function validEmail(value: unknown): value is string {
    return (
        typeof value === 'string' && value.trim().length > 0 && value.length <= EMAIL_MAX && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
    );
}

export function validNewPassword(value: unknown): value is string {
    return typeof value === 'string' && value.length >= PASSWORD_MIN && value.length <= PASSWORD_MAX;
}

export const passwordRule = `Use a password of ${PASSWORD_MIN}–${PASSWORD_MAX} characters.`;
