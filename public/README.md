# Frontend

Express serves these files. Open the application through HTTP/HTTPS, not `file://`.

- `index.html`: working login and validation messages.
- `app.html`, `unassigned.html`, `assigned.html`, `assigned-to-me.html`, `finished.html`: live API-backed mailbox views.
- `settings.html`: Outlook connection, password change, manager-only user creation.
- `compose.html`: plain-text new messages with To/Cc/Bcc and author-only request history.
- `reply.html`, `export.html`, `login-error.html`: compatibility redirects to the working screens.

`js/app-client.js` handles the session, JSON requests, downloads, sidebar counts and synchronization. `js/mailbox.js` implements list/detail views, filters, ticket actions, reply/forward, EML and attachments. List and metadata values use `textContent`. Original HTML is fetched through the scoped `/emails/:id/body` endpoint, sanitized on the server and displayed in a sandboxed iframe with its own restrictive CSP. External images require per-message opt-in; scripts/forms and network-capable CSS are removed. Stored text remains available offline. Outlook actions require a configured connection; local mode supports stored ticket operations and text export.

The original design-preview `mail-feed.js` is retained for reference and is not loaded by application pages. Production mailbox pages use `mailbox.js`. See [component documentation](js/components/README.md), [setup](../documentation/vzpostavitev.md), and [features](../documentation/funkcionalnosti.md).
