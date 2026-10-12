# Shared components

Production pages load `app-sidebar.js`, `app-navbar.js`, and (for mailboxes) `ticket-card.js` before their page controller.

- `app-sidebar`: navigation, counts, synchronization and logout. `active` accepts `all`, `unassigned`, `assigned`, `mine`, `finished`, `compose`, or `settings`.
- `app-navbar`: current account and role.
- `ticket-card`: a selectable message summary. Assign its `ticket` property with API data; `selected` reflects the currently open ticket. Untrusted text uses `textContent`.

The components use light DOM and the shared CSS. `app-client.js` fills account data and handles shared actions; `mailbox.js` creates the live filter/list controls and detail view. Actual pages use `<mail-feed id="mail-feed">` as a container without loading the legacy preview component.

`mail-feed.js` and the optional fixture lookup in `ticket-card.js` belong to the original design preview. They are not the production data source. Do not load the legacy feed script alongside the live mailbox controller: it would replace live controls with sample markup. Static sample names/counts do not describe real accounts.

Real pages require an authenticated API session. Opening HTML files directly is not a supported functional preview.
