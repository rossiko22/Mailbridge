import { readFile } from "node:fs/promises";
import { env } from "../config/env.js";
import {pool} from "../config/database.js";

async function main(): Promise<void> {
    try {
        if (process.env.NODE_ENV !== "development") {
            throw new Error(
                "Development seeding requires NODE_ENV=development.",
            );
        }

        const seedFile = new URL(
            "../../database/seeds/development.sql",
            import.meta.url,
        );

        const sql = await readFile(seedFile, "utf8");
        await pool.query(sql);

        // Demo data has its own mailbox and never mixes with imported Outlook mail.
        await pool.query(`INSERT INTO emails(mailbox,graph_id,subject,sender_name,sender_address,preview,body_text,received_at)
            VALUES ($1,'demo-vpn','VPN access request','Ana Novak','ana@example.test','Cannot connect to VPN','Hello, I need help connecting to the company VPN. Thank you, Ana.', '2026-10-01T09:00:00Z'),
                   ($1,'demo-printer','Printer not responding','Luka Kovač','luka@example.test','Office printer is offline','The office printer has been offline since this morning. Please investigate.', '2026-10-02T10:00:00Z'),
                   ($1,'demo-account','Account permissions','Maja Horvat','maja@example.test','Please review permissions','Please review the permissions on my development account.', '2026-10-03T11:00:00Z')
            ON CONFLICT (mailbox,graph_id) DO NOTHING`, [env.LOCAL_MAILBOX]);
        console.log("Development seed completed (two accounts and three local demo tickets).");
    } finally {
        await pool.end();
    }
}

main().catch((error: unknown) => {
    console.error("Development seed failed:", error);
    process.exitCode = 1;
});