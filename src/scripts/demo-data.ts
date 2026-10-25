import type { Pool } from 'pg';
import { hashPassword } from '../security/password.js';

// The demo user and its two saved mailboxes. Shared by the development seed and the browser tests.
export const DEMO_EMAIL = 'demo@example.test';
export const DEMO_PASSWORD = 'Demo-Password-123!';

interface DemoMail {
    id: string;
    // Inbox when omitted.
    folder?: 'sent' | 'junk';
    // The To line of sent mail.
    to?: string;
    hoursAgo: number;
    from: string;
    address: string;
    subject: string;
    preview: string;
    body: string;
    read: boolean;
    attachment?: boolean;
}

const outlookMail: DemoMail[] = [
    {
        id: 'o1',
        hoursAgo: 1,
        from: 'Priya Nair',
        address: 'priya.nair@contoso.example',
        subject: 'Q4 roadmap review — slides attached',
        preview: 'Hi team, attaching the latest roadmap deck ahead of tomorrow’s review.',
        body: 'Hi team,\n\nAttaching the latest roadmap deck ahead of tomorrow’s review. Please add comments directly in the file by end of day.\n\nThanks,\nPriya',
        read: false,
        attachment: true,
    },
    {
        id: 'o2',
        hoursAgo: 3,
        from: 'Microsoft Teams',
        address: 'noreply@teams.example',
        subject: 'You have 3 missed messages in Design Review',
        preview: 'Marcus and 2 others posted in Design Review while you were away.',
        body: 'Marcus and 2 others posted in Design Review while you were away.\n\nOpen Teams to catch up.',
        read: false,
    },
    {
        id: 'o3',
        hoursAgo: 7,
        from: 'Daniel Okafor',
        address: 'daniel.okafor@fabrikam.example',
        subject: 'Re: Contract renewal',
        preview: 'Thanks for sending this over. Legal has signed off on the revised terms.',
        body: 'Thanks for sending this over. Legal has signed off on the revised terms, so we can proceed with the renewal as discussed.\n\nBest,\nDaniel',
        read: true,
    },
    {
        id: 'o4',
        hoursAgo: 26,
        from: 'IT Service Desk',
        address: 'servicedesk@contoso.example',
        subject: 'Scheduled maintenance this Saturday',
        preview: 'The mail gateway will be unavailable between 02:00 and 04:00 UTC.',
        body: 'The mail gateway will be unavailable between 02:00 and 04:00 UTC this Saturday while we apply security updates.\n\nNo action is required.',
        read: true,
    },
    {
        id: 'o5',
        hoursAgo: 50,
        from: 'Sofia Lindgren',
        address: 'sofia.lindgren@northwind.example',
        subject: 'Lunch on Thursday?',
        preview: 'Are you free for lunch on Thursday? I found a new place near the office.',
        body: 'Are you free for lunch on Thursday? I found a new place near the office and would love to catch up.\n\nSofia',
        read: false,
    },
    {
        id: 'o6',
        hoursAgo: 120,
        from: 'Expense Reports',
        address: 'expenses@contoso.example',
        subject: 'Your expense report was approved',
        preview: 'Report #4821 for $312.40 has been approved and will be paid on Friday.',
        body: 'Report #4821 for $312.40 has been approved and will be paid on Friday.',
        read: true,
    },
    {
        id: 'o7',
        hoursAgo: 200,
        from: 'Hannah Becker',
        address: 'hannah.becker@fabrikam.example',
        subject: 'Welcome aboard!',
        preview: 'We are delighted to have you on the team. Here is what to expect this week.',
        body: 'We are delighted to have you on the team. Here is what to expect this week:\n\n- Monday: orientation\n- Tuesday: meet your buddy\n- Wednesday: first project kickoff',
        read: true,
    },
    {
        id: 'o-sent-1',
        folder: 'sent',
        hoursAgo: 8,
        from: 'Demo User',
        address: 'demo.work@outlook.example',
        to: 'Daniel Okafor',
        subject: 'Contract renewal',
        preview: 'Hi Daniel, please find the revised terms below.',
        body: 'Hi Daniel,\n\nPlease find the revised terms below. Let me know if legal has any questions.\n\nBest regards',
        read: true,
    },
    {
        id: 'o-junk-1',
        folder: 'junk',
        hoursAgo: 5,
        from: 'Account Security',
        address: 'security@micros0ft-verify.example',
        subject: 'Your mailbox is almost full — verify now',
        preview: 'Verify your account to avoid losing messages.',
        body: 'Verify your account to avoid losing messages. This is a demo of a phishing message in Junk.',
        read: false,
    },
];

const gmailMail: DemoMail[] = [
    {
        id: 'g1',
        hoursAgo: 2,
        from: 'Alex Rivera',
        address: 'alex.rivera@gmail.example',
        subject: 'Weekend hike — are you in?',
        preview: 'The forecast looks great for Saturday. Want to take the ridge trail?',
        body: 'The forecast looks great for Saturday. Want to take the ridge trail? We would leave around 8am.\n\nAlex',
        read: false,
    },
    {
        id: 'g2',
        hoursAgo: 5,
        from: 'Northwind Airlines',
        address: 'bookings@northwind-air.example',
        subject: 'Your boarding pass for flight NW 214',
        preview: 'Check-in is now open. Your boarding pass is attached.',
        body: 'Check-in is now open for flight NW 214. Your boarding pass is attached.\n\nHave a pleasant journey.',
        read: false,
        attachment: true,
    },
    {
        id: 'g3',
        hoursAgo: 14,
        from: 'GitHub',
        address: 'notifications@github.example',
        subject: '[mail-app] Pull request #128: Add unread filter',
        preview: 'maria-dev opened a pull request that adds an unread-only filter to the list.',
        body: 'maria-dev opened a pull request that adds an unread-only filter to the message list.\n\nView it on GitHub.',
        read: true,
    },
    {
        id: 'g4',
        hoursAgo: 30,
        from: 'Mom',
        address: 'mom@gmail.example',
        subject: 'Sunday dinner',
        preview: 'Dad is making his famous pasta. Bring dessert if you can!',
        body: 'Dad is making his famous pasta. Bring dessert if you can!\n\nLove, Mom',
        read: true,
    },
    {
        id: 'g5',
        hoursAgo: 75,
        from: 'Spotify',
        address: 'no-reply@spotify.example',
        subject: 'Your weekly mix is ready',
        preview: 'Fresh tracks picked for you, updated every Monday.',
        body: 'Fresh tracks picked for you, updated every Monday.',
        read: true,
    },
    {
        id: 'g6',
        hoursAgo: 150,
        from: 'Library Services',
        address: 'library@city.example',
        subject: 'Reminder: 2 items due soon',
        preview: 'Two of your borrowed items are due in three days.',
        body: 'Two of your borrowed items are due in three days. You can renew them online.',
        read: false,
    },
    {
        id: 'g-sent-1',
        folder: 'sent',
        hoursAgo: 30,
        from: 'Demo User',
        address: 'demo.personal@gmail.example',
        to: 'Lena Fischer',
        subject: 'Re: Climbing on Sunday',
        preview: 'Count me in! I can bring the spare rope.',
        body: 'Count me in! I can bring the spare rope.\n\nSee you at 9.',
        read: true,
    },
    {
        id: 'g-junk-1',
        folder: 'junk',
        hoursAgo: 12,
        from: 'Prize Department',
        address: 'winner@lottery-claims.example',
        subject: 'You have WON a gift card — claim within 24 hours',
        preview: 'Confirm your details to receive your reward.',
        body: 'Confirm your details to receive your reward. This offer expires in 24 hours.',
        read: false,
    },
];

async function seedAccount(
    pool: Pool,
    userId: string,
    provider: 'outlook' | 'gmail',
    email: string,
    displayName: string,
    color: string,
    mail: DemoMail[],
) {
    const { rows } = await pool.query<{ account_id: string }>(
        `INSERT INTO mail_accounts (user_id, provider, email, display_name, color, is_demo, synced_at)
         VALUES ($1,$2,$3,$4,$5,TRUE,NOW())
         ON CONFLICT (user_id, provider, lower(email)) DO UPDATE SET display_name = EXCLUDED.display_name
         RETURNING account_id`,
        [userId, provider, email, displayName, color],
    );
    const accountId = rows[0]!.account_id;
    for (const item of mail) {
        await pool.query(
            `INSERT INTO emails (account_id, provider_id, subject, sender_name, sender_address, preview, body_text, received_at, has_attachments, is_read,
                folder, recipients)
             VALUES ($1,$2,$3,$4,$5,$6,$7, NOW() - make_interval(hours => $8::int), $9, $10, $11, $12)
             ON CONFLICT (account_id, provider_id) DO NOTHING`,
            [
                accountId,
                item.id,
                item.subject,
                item.from,
                item.address,
                item.preview,
                item.body,
                item.hoursAgo,
                item.attachment ?? false,
                item.read,
                item.folder ?? 'inbox',
                item.to ?? '',
            ],
        );
    }
}

// Safe to run repeatedly: existing rows are kept.
export async function seedDemoData(pool: Pool): Promise<void> {
    const user = await pool.query<{ user_id: string }>(
        `INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,'Demo User')
         ON CONFLICT (lower(email)) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING user_id`,
        [DEMO_EMAIL, await hashPassword(DEMO_PASSWORD)],
    );
    const userId = user.rows[0]!.user_id;

    // Demo mailboxes hold saved messages only; connecting a real account is done from the app.
    await seedAccount(pool, userId, 'outlook', 'demo.work@outlook.example', 'Work', 'blue', outlookMail);
    await seedAccount(pool, userId, 'gmail', 'demo.personal@gmail.example', 'Personal', 'teal', gmailMail);
}
