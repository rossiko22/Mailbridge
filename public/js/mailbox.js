(() => {
  const { api, json, ready, setMeta, download } = window.mailApp;
  const feed = document.querySelector('#mail-feed, mail-feed');
  const detail = document.querySelector('#ticket-detail');
  const view = document.body.dataset.page;
  feed.innerHTML = `<form class="feed-controls" id="mail-filters" role="search">
    <label class="field-label" for="mail-search">Search sender, subject or message</label><input class="input" id="mail-search" type="search" maxlength="200" placeholder="Search mail…">
    <details class="mail-filter-options"><summary>Filter tickets</summary><div class="feed-selects"><div><label class="field-label" for="ticket-status">Status</label>
      <select class="input" id="ticket-status"><option value="all">All statuses</option><option value="unassigned">Unassigned</option><option value="progress">In progress</option><option value="finished">Finished</option></select></div>
      <div><label class="field-label" for="sort-order">Sort</label><select class="input" id="sort-order"><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></div></div>
    <div class="feed-selects"><div><label class="field-label" for="assignee-filter">Assigned to</label><select class="input" id="assignee-filter"><option value="">Anyone</option></select></div>
      <div><label class="field-label" for="closed-filter">Closed by</label><select class="input" id="closed-filter"><option value="">Anyone</option></select></div></div>
    <div class="row"><button type="submit" class="button">Search</button><button type="reset" class="button">Reset filters</button></div>
    </details><p id="mail-feedback" role="status"></p></form>
    <div class="feed-list" id="live-emails"></div><button class="button" id="more-emails" type="button" hidden>Load more</button>`;
  const $ = selector => feed.querySelector(selector);
  const form = $('#mail-filters'); const list = $('#live-emails'); const more = $('#more-emails'); const status = $('#ticket-status');
  const feedback = $('#mail-feedback'); const search = $('#mail-search');
  const defaultStatus = ['unassigned','finished'].includes(view) ? view : 'all';
  status.value = defaultStatus;
  if (defaultStatus !== 'all') status.disabled = true;
  let readerObserver;
  const shortDate = value => { const date = new Date(value); return date.toDateString() === new Date().toDateString() ? date.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : date.toLocaleDateString([], {month:'short',day:'numeric'}); };
  const cleanPreview = value => (value || '').replace(/\[https?:\/\/[^\]]+\]/g, '').replace(/<https?:\/\/[^>]+>/g, '').replace(/https?:\/\/\S+/g, '[link]').replace(/\s+/g, ' ').trim();
  let metadata; let currentUser; let offset = 0; let listVersion = 0; let detailVersion = 0; let selectedId; let loading = false; let sendInFlight = false;
  const say = message => { feedback.textContent = message; };
  function options(select, users, allLabel) {
    const current = select.value; select.replaceChildren(new Option(allLabel, ''));
    for (const user of users) select.add(new Option(`${user.email}${user.active ? '' : ' (inactive)'}`, user.id));
    select.value = current;
  }
  async function meta() {
    metadata = await api('/emails/meta'); setMeta(metadata);
    options($('#assignee-filter'), metadata.users, 'Anyone'); options($('#closed-filter'), metadata.users, 'Anyone');
    document.querySelector('#mail-count').textContent = `${metadata.counts[view === 'all' ? 'all' : view] ?? 0} emails`;
  }
  function query() {
    const q = new URLSearchParams({ status: status.value, sort: $('#sort-order').value, view: ['assigned','mine'].includes(view) ? view : 'all', search: search.value });
    if ($('#assignee-filter').value) q.set('assignee', $('#assignee-filter').value);
    if ($('#closed-filter').value) q.set('closedBy', $('#closed-filter').value);
    return q;
  }
  async function load(reset = true) {
    const request = ++listVersion; const q = query(); q.set('offset', reset ? '0' : String(offset));
    loading = true; more.disabled = true; list.setAttribute('aria-busy', 'true'); say('Loading emails…');
    try {
      const data = await api(`/emails?${q}`);
      if (request !== listVersion) return;
      if (reset) { list.replaceChildren(); offset = 0; }
      for (const email of data.emails) {
        const card = document.createElement('ticket-card');
        card.ticket = { id: email.id, sender: email.senderName || email.senderAddress, subject: email.subject || '(No subject)', preview: cleanPreview(email.preview),
          time: email.receivedAt ? shortDate(email.receivedAt) : '', status: email.status, unread: false,
          footer: email.status === 'finished' ? `Closed by ${email.closedByEmail}` : email.assigneeEmail ? `Assigned to ${email.assigneeEmail}` : 'Unassigned' };
        card.toggleAttribute('selected', email.id === selectedId);
        card.addEventListener('click', () => openEmail(email.id)); list.append(card);
      }
      offset += data.emails.length; more.hidden = !data.hasMore;
      say(offset ? `${offset} emails shown${data.hasMore ? ' · more available' : ''}` : 'No matching emails. Try different filters or sync your mailbox.');
    } catch (error) { if (request === listVersion) say(error.message); }
    finally { if (request === listVersion) { loading = false; more.disabled = false; list.removeAttribute('aria-busy'); } }
  }
  async function openEmail(id) {
    if (sendInFlight) { say('Please wait for the current message to finish sending.'); return; }
    const request = ++detailVersion;
    try {
      const { email } = await api(`/emails/${id}`);
      if (request !== detailVersion) return;
      selectedId = id;
      for (const card of list.querySelectorAll('ticket-card')) card.toggleAttribute('selected', card.ticket.id === id);
      readerObserver?.disconnect();
      detail.innerHTML = `<div class="ticket-toolbar" aria-label="Ticket actions"><button class="button" data-compose="reply">Reply</button><button class="button" data-compose="forward">Forward</button><details class="dropdown export-dropdown"><summary class="button" aria-label="Download email">Download ⌄</summary><div class="dropdown-menu"><button class="button" id="export-text">Export text EML</button><button class="button" id="export-original">Original EML</button></div></details><span class="toolbar-divider" aria-hidden="true"></span><details class="dropdown assign-dropdown"><summary class="button button--secondary" id="assign-summary">Assign to… <span aria-hidden="true">⌄</span></summary><div class="dropdown-menu"><form class="ticket-assignment" id="assign-form"><label>Assign to<select class="input" id="assign-user"><option value="">Unassigned</option></select></label><button class="button button--primary" type="submit">Save assignment</button><button class="button button--secondary" id="assign-me" type="button">Assign to me</button></form></div></details><span class="toolbar-spacer"></span><button class="button button--primary" id="finish-ticket">Mark finished</button><button class="button" id="reopen-ticket">Reopen</button></div>
        <div class="ticket-scroll"><div class="ticket-content"><section class="panel message-summary"><div class="ticket-tags"><span id="detail-status" class="badge"></span></div><h2 id="detail-title"></h2>
          <div class="sender-line"><span id="sender-avatar" class="sender-avatar" aria-hidden="true"></span><div class="sender-identity"><strong id="sender-name"></strong><p id="detail-sender"></p><span class="muted">to this mailbox</span></div><time id="detail-date" class="muted"></time></div><p id="detail-closed" class="muted"></p>
          <p id="detail-assignee" class="muted"></p><p id="ticket-feedback" role="status"></p></section>
        <section id="compose-panel" class="panel" hidden></section><article class="panel email-paper"><div class="reader-options"><span id="reader-status" role="status">Saved message</span><button id="show-images" class="button" hidden>Show images</button><button id="retry-format" class="button" hidden>Retry Outlook</button><button id="toggle-format" class="button" hidden>Plain text</button></div><div id="detail-body" class="message-body mail-body-text"></div><iframe id="email-frame" title="Email content" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" hidden></iframe><details class="message-attachments"><summary>Attachments</summary><p id="attachment-note" class="muted"></p><button class="button" id="load-attachments" type="button">Load attachments</button><ul id="attachments"></ul></details></article>
        <section class="panel conversation-history"><h3>Conversation</h3><ul id="outgoing-history" class="mail-history"></ul></section>
        <details class="panel ticket-activity"><summary>Ticket activity</summary><ul id="activity-history" class="mail-history"></ul></details></div></div>`;
      const d = selector => detail.querySelector(selector);
      const names = { unassigned: 'Unassigned', progress: 'In progress', finished: 'Finished' };
      d('#detail-status').textContent = names[email.status]; d('#detail-status').classList.add(`badge--${email.status}`);
      d('#detail-title').textContent = email.subject || '(No subject)';
      d('#sender-name').textContent = email.senderName || email.senderAddress;
      d('#sender-avatar').textContent = (email.senderName || email.senderAddress || '?').slice(0, 1).toUpperCase();
      d('#detail-sender').textContent = email.senderAddress;
      d('#detail-date').textContent = email.receivedAt ? new Date(email.receivedAt).toLocaleString() : '';
      d('#detail-closed').textContent = email.closedByEmail ? `Closed by ${email.closedByEmail} · ${new Date(email.closedAt).toLocaleString()}` : '';
      d('#detail-body').textContent = email.body;
      d('.message-attachments').open = Boolean(email.hasAttachments);
      d('#attachment-note').textContent = '';
      const frame = d('#email-frame'); const format = d('#toggle-format'); const images = d('#show-images');
      let formatted = true;
      function fitReader() {
        if (!frame.isConnected || frame.hidden) return;
        const body = frame.contentDocument?.body;
        if (body?.dataset.emailDocument) frame.style.height = `${Math.max(160, Math.min(30000, body.scrollHeight + 8))}px`;
      }
      frame.addEventListener('load', () => {
        if (!frame.isConnected) return;
        const body = frame.contentDocument?.body;
        if (!body?.dataset.emailDocument) {
          frame.hidden = true; d('#detail-body').hidden = false; format.hidden = true; images.hidden = true;
          d('#reader-status').textContent = 'Showing saved text · formatted message unavailable'; return;
        }
        frame.hidden = !formatted; d('#detail-body').hidden = formatted;
        format.hidden = false; format.textContent = formatted ? 'Plain text' : 'Formatted email';
        images.hidden = body.dataset.remoteImages !== 'true' || frame.src.includes('images=true') || !formatted;
        d('#reader-status').textContent = body.dataset.remoteImages === 'true' && !frame.src.includes('images=true') ? 'External images are hidden' : 'Email message';
        if (body.dataset.warning) d('#reader-status').textContent = `Showing readable saved text. ${body.dataset.warning}`;
        d('#retry-format').hidden = !body.dataset.warning || !metadata.outlookConfigured;
        readerObserver?.disconnect(); readerObserver = new ResizeObserver(fitReader); readerObserver.observe(body);
        fitReader();
      });
      format.addEventListener('click', () => {
        formatted = !formatted; frame.hidden = !formatted; d('#detail-body').hidden = formatted;
        format.textContent = formatted ? 'Plain text' : 'Formatted email';
        images.hidden = !formatted || frame.contentDocument?.body.dataset.remoteImages !== 'true' || frame.src.includes('images=true');
        fitReader();
      });
      d('#retry-format').addEventListener('click', () => { d('#reader-status').textContent = 'Loading email…'; frame.src = `/emails/${id}/body`; });
      images.addEventListener('click', () => { images.hidden = true; frame.src = `/emails/${id}/body?images=true`; });
      d('#reader-status').textContent = 'Loading email…'; frame.src = `/emails/${id}/body`;

      d('#export-text').addEventListener('click', () => download(`/emails/${id}/export`, `ticket-${id}-text.eml`).catch(error => { d('#ticket-feedback').textContent = error.message; }));
      d('#export-original').hidden = !metadata.outlookConfigured;
      d('#export-original').addEventListener('click', () => download(`/emails/${id}/export?original=true`, `ticket-${id}-original.eml`).catch(error => { d('#ticket-feedback').textContent = error.message; }));
      d('#load-attachments').hidden = !metadata.outlookConfigured;
      d('#load-attachments').addEventListener('click', async event => {
        const button = event.currentTarget; button.disabled = true;
        try {
          const data = await api(`/emails/${id}/attachments`); d('#attachments').replaceChildren();
          for (const item of data.attachments) {
            const li = document.createElement('li'); const link = document.createElement('button'); link.className = 'button';
            link.textContent = `${item.name} (${Math.ceil(item.size / 1024)} KiB)`;
            link.addEventListener('click', () => download(`/emails/${id}/attachments/${encodeURIComponent(item.id)}`, item.name).catch(error => { d('#attachment-note').textContent = error.message; }));
            li.append(link); d('#attachments').append(li);
          }
          d('#attachment-note').textContent = data.attachments.length ? 'Select an attachment to download.' : 'No attachments.';
        } catch (error) { d('#attachment-note').textContent = error.message; }
        finally { button.disabled = false; }
      });
      detail.querySelectorAll('[data-compose]').forEach(button => { button.hidden = !metadata.outlookConfigured; });
      for (const user of metadata.users.filter(user => user.active)) d('#assign-user').add(new Option(user.email, user.id));
      d('#assign-user').value = email.assignedTo || '';
      d('#detail-assignee').textContent = email.assigneeEmail ? `Assigned to ${email.assigneeEmail}` : 'No assignee yet';
      d('#finish-ticket').hidden = email.status !== 'progress'; d('#finish-ticket').disabled = email.assignedTo !== currentUser.userId;
      d('#finish-ticket').title = email.assignedTo !== currentUser.userId ? 'Only the assignee can finish this ticket' : '';
      d('#reopen-ticket').hidden = email.status !== 'finished';
      let mutating = false;
      async function change(action, assignee) {
        if (mutating) return; mutating = true;
        const controls = [...detail.querySelectorAll('button,select')]; controls.forEach(el => { el.disabled = true; });
        d('#ticket-feedback').textContent = 'Saving…';
        try {
          await api(`/emails/${id}/ticket`, json('PATCH', { action, version: email.version, ...(action === 'assign' ? { assignee } : {}) }));
          await meta(); await load();
          // Assignment can intentionally transfer this user's access to a teammate.
          if (!metadata.canManage && action === 'assign' && assignee !== currentUser.userId) { selectedId = undefined; detail.innerHTML = '<p class="empty-state">Assignment saved. This ticket is now with your teammate.</p>'; }
          else await openEmail(id);
        } catch (error) { d('#ticket-feedback').textContent = error.message; controls.forEach(el => { el.disabled = false; }); d('#finish-ticket').disabled = email.assignedTo !== currentUser.userId; }
        finally { mutating = false; }
      }
      d('#assign-form').addEventListener('submit', event => { event.preventDefault(); change('assign', d('#assign-user').value || null); });
      d('#assign-me').addEventListener('click', () => change('assign', currentUser.userId));
      d('#finish-ticket').addEventListener('click', () => change('finish'));
      d('#reopen-ticket').addEventListener('click', () => change('reopen'));
      for (const item of email.activity) {
        const li = document.createElement('li'); li.textContent = `${item.description} · ${item.actor} · ${new Date(item.createdAt).toLocaleString()}`; d('#activity-history').append(li);
      }
      if (!email.activity.length) d('#activity-history').textContent = 'No ticket changes yet.';
      for (const item of email.outgoing) {
        const li = document.createElement('li'); const header = document.createElement('strong'); const content = document.createElement('p');
        header.textContent = `${item.action === 'reply' ? 'Reply' : 'Forward'} · ${item.state === 'accepted' ? 'Accepted by Outlook' : item.state} · ${item.actor}`;
        content.className = 'mail-body-text'; content.textContent = item.comment;
        const recipient = document.createElement('small'); recipient.textContent = `${item.recipients.join(', ') || 'Original sender / Reply-To'} · ${new Date(item.createdAt).toLocaleString()}`;
        li.append(header,recipient,content); d('#outgoing-history').append(li);
      }
      if (!email.outgoing.length) d('.conversation-history').hidden = true;
      let sending = false;
      for (const button of detail.querySelectorAll('[data-compose]')) button.addEventListener('click', () => {
        if (sending) return;
        const action = button.dataset.compose; const panel = d('#compose-panel'); panel.hidden = false;
        panel.innerHTML = `<form class="mail-compose"><h3>${action === 'reply' ? 'Reply' : 'Forward'}</h3>
          ${action === 'forward' ? '<label>To (separate addresses with commas)<input name="recipients" class="input" required autocomplete="off"></label>' : '<p>Your reply will use the original message’s Reply-To address, or its sender.</p>'}
          <label>Message<textarea class="input" name="comment" maxlength="20000" ${action === 'reply' ? 'required' : ''}></textarea></label>
          <p role="status" data-send-status></p><div class="row"><button class="button button--primary" type="submit">Send ${action}</button><button class="button" type="button" data-cancel>Cancel</button></div></form>`;
        const compose = panel.querySelector('form'); const sendStatus = panel.querySelector('[data-send-status]');
        const requestId = crypto.randomUUID();
        panel.querySelector('[data-cancel]').addEventListener('click', () => { panel.hidden = true; });
        compose.addEventListener('submit', async event => {
          event.preventDefault(); if (sending) return; sending = true; sendInFlight = true;
          const recipients = action === 'forward' ? compose.elements.recipients.value.split(/[,;]/).map(value => value.trim()).filter(Boolean) : [];
          const controls = [...detail.querySelectorAll('button,select,textarea,input')]; controls.forEach(el => { el.disabled = true; });
          sendStatus.textContent = 'Sending…';
          try {
            await api(`/emails/${id}/send`, json('POST', { action, requestId, comment: compose.elements.comment.value, recipients }));
            sendInFlight = false; await openEmail(id); say('Message accepted by Outlook.');
          } catch (error) { sendStatus.textContent = error.message; controls.forEach(el => { el.disabled = false; }); d('#finish-ticket').disabled = email.assignedTo !== currentUser.userId; }
          finally { sending = false; sendInFlight = false; }
        });
        panel.scrollIntoView({ block: 'nearest' }); panel.querySelector('input,textarea').focus();
      });
    } catch (error) { say(error.message); }
  }
  form.addEventListener('submit', event => { event.preventDefault(); load(); });
  form.addEventListener('change', () => load());
  let timer;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => load(), 250); });
  form.addEventListener('reset', () => { setTimeout(() => { status.value = defaultStatus; load(); }, 0); });
  more.addEventListener('click', () => { if (!loading) load(false); });
  window.addEventListener('mailbox-updated', () => { meta().then(() => load()).catch(error => say(error.message)); });
  ready.then(async user => { currentUser = user; await meta(); await load(); }).catch(error => say(error.message));
})();
