import nodemailer from 'nodemailer';

export interface SmtpConfig { host: string; port: number; secure: boolean; user: string | undefined; password: string | undefined; from: string }
export interface Mailer { sendPasswordReset(to: string, link: string, minutes: number): Promise<void> }

const text = (link: string, minutes: number) => `Someone asked to reset the password for this email address.

Open this link to choose a new password (valid for ${minutes} minutes, one use):
${link}

If this was not you, ignore this message. Your password stays the same.`;

const html = (link: string, minutes: number) => `<p>Someone asked to reset the password for this email address.</p>
<p><a href="${link}">Choose a new password</a> (valid for ${minutes} minutes, one use).</p>
<p>If this was not you, ignore this message. Your password stays the same.</p>`;

// Without SMTP settings, development prints the link to the server console so the flow can still be tried.
// Production never prints a reset link.
export function createMailer(smtp: SmtpConfig | undefined, nodeEnv: string, log: Pick<Console, 'log' | 'warn'> = console): Mailer {
    if (!smtp) {
        return {
            async sendPasswordReset(to, link) {
                if (nodeEnv === 'production') log.warn('SMTP is not configured; a password reset email was not sent.');
                else log.log(`[mail disabled] Password reset link for ${to}: ${link}`);
            },
        };
    }
    const transport = nodemailer.createTransport({
        host: smtp.host, port: smtp.port, secure: smtp.secure,
        ...(smtp.user ? { auth: { user: smtp.user, pass: smtp.password ?? '' } } : {}),
    });
    return {
        async sendPasswordReset(to, link, minutes) {
            await transport.sendMail({ from: smtp.from, to, subject: 'Reset your password', text: text(link, minutes), html: html(link, minutes) });
        },
    };
}
