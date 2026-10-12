import { pool } from '../config/database.js';
import { env } from '../config/env.js';
import { graphConfig } from '../config/graph.js';
import { createOutlookConnection } from '../integrations/outlook/connection.js';
try {
    const config = graphConfig();
    if (!config) throw new Error('Configure GRAPH_* or connect Outlook in Settings first.');
    const connection = createOutlookConnection(pool, config, env.TOKEN_ENCRYPTION_KEY);
    const { rows } = await pool.query('SELECT cursor FROM mailbox_sync WHERE mailbox=$1', [config.mailbox]);
    const page = await connection.page(rows[0]?.cursor);
    if (page['@odata.nextLink']) await connection.page(page['@odata.nextLink']);
    console.log(`Outlook read check passed (${page.value.length} changes in the current page${page['@odata.nextLink'] ? '; continuation also verified' : ''}). No messages sent, imported, or modified; checkpoint unchanged.`);
    console.log('Mail.Send must be verified separately with a controlled recipient after deployment.');
} catch (error) { console.error(error instanceof Error ? error.message : 'Outlook check failed'); process.exitCode = 1; }
finally { await pool.end(); }
