import { Pool } from "pg";
import { env } from "./env.js";

export const pool = new Pool({
    host: env.POSTGRES_HOST,
    port: env.POSTGRES_PORT,
    database: env.POSTGRES_DB,
    user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,

    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
});

// Handles unexpected errors from connections sitting idle in the pool.
pool.on("error", (error) => {
    console.error("Unexpected PostgreSQL pool error:", error.message);
});

// Call and await this during startup, before app.listen().
export async function checkDatabaseConnection(): Promise<void> {
    await pool.query("SELECT 1");
    for (const table of ['users','sessions','login_attempts','password_resets','user_avatars','mail_accounts','emails','email_bodies','outgoing_messages']) {
        const result = await pool.query('SELECT to_regclass($1) AS relation', [table]);
        if (!result.rows[0].relation) throw new Error(`Missing database table ${table}. Run migrations before starting the server.`);
    }
    console.log("PostgreSQL connection and schema checks successful");
}