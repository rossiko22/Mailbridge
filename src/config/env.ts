import "dotenv/config";

function required(name: string): string {
    const value = process.env[name];

    if (value === undefined || value.trim() === "") {
        throw new Error(`Missing environment variable: ${name}`);
    }

    return value;
}

function optional(name: string): string | undefined {
    const value = process.env[name]?.trim();
    return value ? value : undefined;
}

// Both halves of an OAuth app registration must be present, or neither.
function oauthApp(prefix: string): { clientId: string; clientSecret: string } | undefined {
    const clientId = optional(`${prefix}_CLIENT_ID`);
    const clientSecret = optional(`${prefix}_CLIENT_SECRET`);
    if (!clientId && !clientSecret) return undefined;
    if (!clientId || !clientSecret) throw new Error(`Set both ${prefix}_CLIENT_ID and ${prefix}_CLIENT_SECRET, or neither.`);
    return { clientId, clientSecret };
}

const port = Number(process.env.PORT || 3000);
const postgresPort = Number(required("POSTGRES_PORT"));
const nodeEnv = required('NODE_ENV');
if (!['development','test','production'].includes(nodeEnv)) throw new Error('NODE_ENV must be development, test or production');
if (nodeEnv === 'production') {
    if ([required('SESSION_SECRET'), required('TOKEN_ENCRYPTION_KEY')].some(value => value.length < 32 || value.startsWith('REPLACE_'))) throw new Error('Production session and encryption secrets must each contain at least 32 characters');
    const origin = new URL(required('PUBLIC_ORIGIN'));
    if (origin.protocol !== 'https:' || origin.origin !== process.env.PUBLIC_ORIGIN) throw new Error('PUBLIC_ORIGIN must be an HTTPS origin without a trailing slash');
}

if (
    !Number.isInteger(postgresPort) ||
    postgresPort < 1 ||
    postgresPort > 65535
) {
    throw new Error("POSTGRES_PORT must be an integer between 1 and 65535");
}

const publicOrigin = optional('PUBLIC_ORIGIN') ?? `http://localhost:${port}`;

const microsoftApp = oauthApp('MICROSOFT');
const googleApp = oauthApp('GOOGLE');

const smtpHost = optional('SMTP_HOST');
const smtpPort = Number(optional('SMTP_PORT') ?? 587);
if (smtpHost && (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535)) throw new Error('SMTP_PORT must be an integer between 1 and 65535');

export const env = {
    POSTGRES_HOST: required("POSTGRES_HOST"),
    POSTGRES_PORT: postgresPort,
    POSTGRES_DB: required("POSTGRES_DB"),
    POSTGRES_USER: required("POSTGRES_USER"),
    POSTGRES_PASSWORD: required("POSTGRES_PASSWORD"),
    NODE_ENV: nodeEnv,
    TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY || required('SESSION_SECRET'),
    SESSION_SECRET: required("SESSION_SECRET"),
    PUBLIC_ORIGIN: publicOrigin,
    // Anyone may create an account unless this is switched off.
    ALLOW_REGISTRATION: process.env.ALLOW_REGISTRATION?.trim().toLowerCase() !== 'false',
    // Accounts from any Microsoft tenant or personal Microsoft account by default.
    MICROSOFT: microsoftApp ? { ...microsoftApp, tenant: optional('MICROSOFT_TENANT') ?? 'common' } : undefined,
    GOOGLE: googleApp,
    // Optional invite list for Gmail (comma-separated sign-in emails of this app's users). Empty means everyone.
    // Useful while the Google app is unverified and only a few people can connect anyway.
    GMAIL_ALLOWED_EMAILS: (optional('GMAIL_ALLOWED_EMAILS') ?? '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean),
    SMTP: smtpHost ? {
        host: smtpHost,
        port: smtpPort,
        secure: optional('SMTP_SECURE') ? optional('SMTP_SECURE') === 'true' : smtpPort === 465,
        user: optional('SMTP_USER'),
        password: optional('SMTP_PASSWORD'),
        from: required('SMTP_FROM'),
    } : undefined,
} as const;
