import "dotenv/config";

function required(name: string): string {
    const value = process.env[name];

    if (value === undefined || value.trim() === "") {
        throw new Error(`Missing environment variable: ${name}`);
    }

    return value;
}

const postgresPort = Number(required("POSTGRES_PORT"));
const nodeEnv = required('NODE_ENV');
if (!['development','test','production'].includes(nodeEnv)) throw new Error('NODE_ENV must be development, test or production');
if (nodeEnv === 'production') {
    if ([required('SESSION_SECRET'), required('TOKEN_ENCRYPTION_KEY')].some(value => value.length < 32 || value.startsWith('REPLACE_'))) throw new Error('Production session and encryption secrets must each contain at least 32 characters');
    const origin = new URL(required('PUBLIC_ORIGIN'));
    if (origin.protocol !== 'https:' || origin.origin !== process.env.PUBLIC_ORIGIN) throw new Error('PUBLIC_ORIGIN must be an HTTPS origin without a trailing slash');
    if (!['oauth','application'].includes(process.env.GRAPH_AUTH_MODE || '')) throw new Error('Production requires GRAPH_AUTH_MODE=oauth or application.');
    required('GRAPH_OWNER_EMAIL');
}

if (
    !Number.isInteger(postgresPort) ||
    postgresPort < 1 ||
    postgresPort > 65535
) {
    throw new Error("POSTGRES_PORT must be an integer between 1 and 65535");
}

export const env = {
    LOCAL_MAILBOX: process.env.LOCAL_MAILBOX?.trim().toLowerCase() || 'demo@example.test',
    LOCAL_OWNER_EMAIL: process.env.LOCAL_OWNER_EMAIL?.trim().toLowerCase() || 'manager@example.test',
    POSTGRES_HOST: required("POSTGRES_HOST"),
    POSTGRES_PORT: postgresPort,
    POSTGRES_DB: required("POSTGRES_DB"),
    POSTGRES_USER: required("POSTGRES_USER"),
    POSTGRES_PASSWORD: required("POSTGRES_PASSWORD"),
    NODE_ENV: nodeEnv,
    TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY || required('SESSION_SECRET'),
    SESSION_SECRET: required("SESSION_SECRET"),
} as const;
