// The mail page: one inbox across every connected account, in an Outlook-style three-pane layout.
(() => {
  const { icon, api, json, download, avatar, toast, popover, shortDate, longDate, providerName, whoAmI } = window.App;
  window.App.mountAppbar({ search: true });

  const $ = selector => document.querySelector(selector);
  const workspace = $('#workspace'); const sidebar = $('#sidebar'); const list = $('#message-list');
  const listState = $('#list-state'); const listBanner = $('#list-banner'); const moreWrap = $('#list-more');
  const reader = $('#reader'); const scroller = $('#list-scroll'); const title = $('#list-title');
  const dialog = $('#compose-dialog');

  const state = {
    accounts: [], providers: {}, filter: 'all', accountId: null, search: '', sort: 'newest',
    selectedId: null, offset: 0, hasMore: false, listVersion: 0, detailVersion: 0,
    syncing: false, lastSync: 0, syncMessage: '', shownErrors: new Map(), current: null,
  };
  const account = id => state.accounts.find(item => item.id === id);
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  const cleanPreview = value => (value || '').replace(/\[https?:\/\/[^\]]+\]/g, '').replace(/<https?:\/\/[^>]+>/g, '').replace(/https?:\/\/\S+/g, '[link]').replace(/\s+/g, ' ').trim();

  $('#sync-button').innerHTML = icon('refresh');
  $('#sort-button').innerHTML = icon('arrow-up-down');
  dialog.querySelectorAll('[data-close]').forEach(button => { if (button.classList.contains('icon-btn')) button.innerHTML = icon('x'); });
  $('#compose-send').innerHTML = `${icon('send')}Send`;

  // ---------- Sidebar ----------
  function buildSidebar() {
    const compose = el('button', 'btn btn--primary btn--block sidebar__compose'); compose.type = 'button';
    compose.innerHTML = `${icon('edit')}New mail`;
    compose.addEventListener('click', openCompose);

    const all = el('button', 'nav-item'); all.type = 'button'; all.dataset.nav = 'all';
    all.innerHTML = `${icon('inbox')}<span class="nav-item__text"><span>All mail</span></span><span class="count" data-total hidden></span>`;
    all.addEventListener('click', () => selectAccount(null));

    const heading = el('div', 'sidebar__heading');
    heading.append(el('span', '', 'Accounts'));
    const anchor = el('div', 'menu-anchor');
    const add = el('button', 'icon-btn'); add.type = 'button'; add.setAttribute('aria-label', 'Add an account'); add.title = 'Add an account'; add.innerHTML = icon('plus', 'icon--sm');
    const menu = el('div', 'menu'); menu.setAttribute('role', 'menu'); menu.id = 'add-menu';
    anchor.append(add, menu); heading.append(anchor);
    popover(add, menu);

    const accountsBox = el('div', ''); accountsBox.id = 'account-list';
    const foot = el('div', 'sidebar__foot');
    const status = el('p', 'sync-status'); status.id = 'sync-status'; status.setAttribute('role', 'status');
    foot.append(status);
    sidebar.append(compose, all, heading, accountsBox, foot);
  }

  function renderAddMenu() {
    const menu = $('#add-menu'); menu.replaceChildren();
    menu.append(el('div', 'menu__title', 'Add an account'));
    const hints = { outlook: 'Outlook.com or Microsoft 365', gmail: 'Gmail or Google Workspace' };
    for (const provider of ['outlook', 'gmail'].filter(item => item in state.providers)) {
      const available = state.providers[provider];
      const item = el(available ? 'a' : 'button', 'menu__item provider-option'); item.setAttribute('role', 'menuitem');
      const text = el('span', 'provider-option__text');
      text.append(el('span', '', providerName(provider)), el('small', '', available ? hints[provider] : 'Not set up on this server'));
      item.append(el('span', `provider-badge provider-badge--${provider}`, providerName(provider)[0]), text);
      if (available) item.href = `/accounts/connect/${provider}`; else { item.type = 'button'; item.disabled = true; item.title = 'This server has no app credentials for this provider.'; }
      menu.append(item);
    }
  }

  function renderAccounts() {
    const unread = state.accounts.reduce((sum, item) => sum + item.unread, 0);
    const total = sidebar.querySelector('[data-total]'); total.textContent = unread > 999 ? '999+' : unread; total.hidden = unread === 0;
    sidebar.querySelector('[data-nav="all"]').toggleAttribute('aria-current', false);
    if (state.accountId === null) sidebar.querySelector('[data-nav="all"]').setAttribute('aria-current', 'page');
    const box = $('#account-list'); box.replaceChildren();
    for (const item of state.accounts) {
      const button = el('button', 'nav-item nav-item--account'); button.type = 'button'; button.dataset.color = item.color; button.dataset.account = item.id;
      if (state.accountId === item.id) button.setAttribute('aria-current', 'page');
      button.innerHTML = '<span class="dot dot--lg"></span>';
      const text = el('span', 'nav-item__text');
      text.append(el('span', 'truncate', item.email), el('small', 'truncate', item.needsReconnect ? 'Sign-in expired' : item.isDemo ? `${providerName(item.provider)} · demo` : providerName(item.provider)));
      button.append(text);
      if (item.needsReconnect) { const warn = el('span', 'subtle'); warn.innerHTML = icon('alert', 'icon--sm'); warn.title = 'Reconnect this account'; button.append(warn); }
      else if (item.unread) button.append(el('span', 'count', item.unread > 999 ? '999+' : String(item.unread)));
      button.addEventListener('click', () => selectAccount(item.id));
      box.append(button);
    }
    renderTitle();
    renderSyncStatus();
  }

  function renderTitle() {
    const selected = account(state.accountId);
    title.textContent = state.search ? `Results for “${state.search}”` : selected ? selected.email : 'All mail';
    document.title = `${selected && !state.search ? selected.email : 'Mail'} · ${window.App.APP_NAME}`;
  }

  function renderSyncStatus() {
    const status = $('#sync-status'); if (!status) return;
    status.replaceChildren();
    if (!state.accounts.length) return;
    if (state.syncing) { status.append(el('span', 'spinner'), el('span', '', 'Syncing…')); return; }
    status.textContent = state.syncMessage || (state.lastSync ? `Updated ${new Date(state.lastSync).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '');
  }

  async function loadAccounts() {
    const data = await api('/accounts');
    state.accounts = data.accounts; state.providers = data.providers; state.notice = data.notice;
    if (state.accountId && !account(state.accountId)) state.accountId = null;
    renderAddMenu(); renderAccounts(); renderBanner();
  }

  function selectAccount(id) {
    state.accountId = id; state.selectedId = null;
    const url = new URL(location.href); url.search = id ? `?account=${id}` : ''; history.replaceState(null, '', url);
    renderAccounts(); renderBanner(); clearReader(); workspace.dataset.view = 'list';
    window.App.setNav(false);
    loadList();
  }

  function renderBanner() {
    listBanner.replaceChildren();
    const selected = account(state.accountId) ?? state.accounts.find(item => item.needsReconnect);
    if (selected?.needsReconnect) {
      const banner = el('div', 'banner banner--warning');
      banner.innerHTML = icon('alert');
      const text = el('div', 'banner__text', `Sign-in expired for ${selected.email}. Reconnect to keep receiving mail.`);
      const link = el('a', 'btn', 'Reconnect'); link.href = `/accounts/connect/${selected.provider}`;
      banner.append(text, link); listBanner.append(banner);
    }
  }

  // ---------- Message list ----------
  function messageNode(email) {
    const item = el('li');
    const button = el('button', `msg${email.isRead ? '' : ' msg--unread'}`); button.type = 'button'; button.dataset.id = email.id;
    if (email.id === state.selectedId) button.setAttribute('aria-current', 'true');
    const sender = email.senderName || email.senderAddress || 'Unknown sender';
    const body = el('span', 'msg__body');
    const top = el('span', 'msg__top');
    if (state.accountId === null && state.accounts.length > 1) {
      const dot = el('span', 'dot'); dot.dataset.color = account(email.accountId)?.color ?? 'gray'; dot.title = account(email.accountId)?.email ?? ''; top.append(dot);
    }
    top.append(el('span', 'msg__sender truncate', sender), el('time', 'msg__time', shortDate(email.receivedAt)));
    body.append(top, el('span', 'msg__subject truncate', email.subject || '(No subject)'), el('span', 'msg__preview truncate', cleanPreview(email.preview)));
    const meta = el('span', 'msg__meta'); if (email.hasAttachments) { meta.innerHTML = icon('paperclip', 'icon--sm'); meta.title = 'Has attachments'; }
    button.append(avatar({ name: sender, key: email.senderAddress || sender }), body, meta);
    button.addEventListener('click', () => openMessage(email.id));
    item.append(button);
    return item;
  }

  function renderListState(loading) {
    listState.replaceChildren();
    if (loading && !list.children.length) {
      for (let i = 0; i < 6; i++) { const row = el('div', 'skeleton'); row.append(el('i'), el('i'), el('i')); listState.append(row); }
      return;
    }
    if (list.children.length) return;
    const empty = el('div', 'empty');
    if (!state.accounts.length) {
      empty.innerHTML = `${icon('mail')}<h2>Bring all your mail together</h2><p>Connect an account to see every inbox in one place.</p>`;
      const row = el('div', 'row row--wrap'); row.style.justifyContent = 'center';
      for (const provider of ['outlook', 'gmail'].filter(item => item in state.providers)) {
        const link = el(state.providers[provider] ? 'a' : 'span', state.providers[provider] ? 'btn btn--primary' : 'chip', state.providers[provider] ? `Connect ${providerName(provider)}` : `${providerName(provider)} not set up`);
        if (state.providers[provider]) link.href = `/accounts/connect/${provider}`;
        row.append(link);
      }
      empty.append(row);
    } else if (state.search) {
      empty.innerHTML = `${icon('search')}<h2>No results</h2><p>Nothing matches “”. Try different words.</p>`;
      empty.querySelector('p').textContent = `Nothing matches “${state.search}”. Try different words.`;
    } else if (state.filter === 'unread') {
      empty.innerHTML = `${icon('check-circle')}<h2>You’re all caught up</h2><p>There are no unread messages here.</p>`;
    } else {
      empty.innerHTML = `${icon('inbox')}<h2>Nothing here yet</h2><p>${state.syncing ? 'Syncing your mail…' : 'New messages will appear here.'}</p>`;
    }
    listState.append(empty);
  }

  async function loadList({ reset = true } = {}) {
    const version = ++state.listVersion;
    if (reset) { state.offset = 0; if (!list.children.length) renderListState(true); }
    const query = new URLSearchParams({ sort: state.sort, offset: String(reset ? 0 : state.offset) });
    if (state.accountId) query.set('account', state.accountId);
    if (state.filter === 'unread') query.set('unread', 'true');
    if (state.search) query.set('search', state.search);
    try {
      const data = await api(`/emails?${query}`);
      if (version !== state.listVersion) return;
      if (reset) list.replaceChildren();
      for (const email of data.emails) list.append(messageNode(email));
      state.offset = (reset ? 0 : state.offset) + data.emails.length; state.hasMore = data.hasMore;
      moreWrap.hidden = !data.hasMore;
      renderListState(false);
    } catch (error) {
      if (version === state.listVersion) { listState.replaceChildren(); toast(error.message, 'error'); }
    }
  }

  // ---------- Reading pane ----------
  function clearReader() {
    state.current = null; state.detailVersion++;
    reader.replaceChildren();
    const empty = el('div', 'empty reader-empty');
    empty.innerHTML = `${icon('mail-open')}<h2>Select an item to read</h2><p>Nothing is selected.</p>`;
    reader.append(empty);
  }

  function markRow(id, read) {
    const row = list.querySelector(`.msg[data-id="${id}"]`);
    if (row) row.classList.toggle('msg--unread', !read);
  }

  async function setRead(id, read) {
    markRow(id, read);
    try { await api(`/emails/${id}/read`, json('PATCH', { isRead: read })); }
    catch (error) { markRow(id, !read); toast(error.message, 'error'); return false; }
    if (state.current?.id === id) { state.current.isRead = read; paintReadToggle(); }
    loadAccounts().catch(() => {});
    return true;
  }

  function paintReadToggle() {
    const button = reader.querySelector('[data-act="toggle-read"]'); if (!button || !state.current) return;
    button.innerHTML = state.current.isRead ? `${icon('mail-unread')}Mark as unread` : `${icon('mail-open')}Mark as read`;
  }

  async function openMessage(id) {
    const version = ++state.detailVersion;
    state.selectedId = id;
    for (const row of list.querySelectorAll('.msg')) { if (row.dataset.id === id) row.setAttribute('aria-current', 'true'); else row.removeAttribute('aria-current'); }
    workspace.dataset.view = 'reader';
    let email;
    try { ({ email } = await api(`/emails/${id}`)); }
    catch (error) { toast(error.message, 'error'); return; }
    if (version !== state.detailVersion) return;
    state.current = email;
    renderReader(email, version);
    if (!email.isRead) setTimeout(() => { if (state.selectedId === id && state.detailVersion === version) setRead(id, true); }, 600);
  }

  function renderReader(email, version) {
    reader.replaceChildren();
    const toolbar = el('div', 'reader-toolbar');
    toolbar.innerHTML = `
      <button type="button" class="icon-btn reader-toolbar__back" data-act="back" aria-label="Back to messages">${icon('chevron-left')}</button>
      <button type="button" class="btn btn--subtle" data-act="reply">${icon('reply')}Reply</button>
      <button type="button" class="btn btn--subtle" data-act="forward">${icon('forward')}Forward</button>
      <span class="reader-toolbar__sep" aria-hidden="true"></span>
      <button type="button" class="btn btn--subtle" data-act="toggle-read"></button>
      <div class="menu-anchor">
        <button type="button" class="btn btn--subtle" data-act="download">${icon('download')}Download${icon('chevron-down', 'icon--sm')}</button>
        <div class="menu menu--left" role="menu" hidden>
          <button type="button" class="menu__item" role="menuitem" data-act="eml-text">Saved text (.eml)</button>
          <button type="button" class="menu__item" role="menuitem" data-act="eml-original">Original message (.eml)</button>
        </div>
      </div>`;
    const scroll = el('div', 'reader-scroll'); const inner = el('article', 'reader-inner'); scroll.append(inner);
    reader.append(toolbar, scroll);
    paintReadToggle();
    popover(toolbar.querySelector('[data-act="download"]'), toolbar.querySelector('.menu'));

    const selectedAccount = account(email.accountId);
    const sender = email.senderName || email.senderAddress || 'Unknown sender';

    inner.append(el('h2', 'reader-subject', email.subject || '(No subject)'));
    const from = el('div', 'reader-from');
    const who = el('div', 'reader-from__who');
    who.append(el('strong', '', sender));
    if (email.senderAddress) who.append(el('span', '', email.senderAddress));
    const to = el('span', 'row'); const dot = el('span', 'dot'); dot.dataset.color = email.accountColor;
    to.append(el('span', '', 'To:'), dot, el('span', '', `${email.accountEmail} · ${providerName(email.provider)}`));
    who.append(to);
    from.append(avatar({ name: sender, key: email.senderAddress || sender, size: 'lg' }), who, el('time', '', longDate(email.receivedAt)));
    inner.append(from);

    // The message itself: sandboxed document from the server, with a plain-text fallback.
    const notice = el('div', 'reader-notice'); const status = el('span', '', 'Loading message…'); notice.append(status);
    const frameBox = el('div', 'reader-frame'); const frame = document.createElement('iframe');
    frame.title = 'Message content'; frame.setAttribute('sandbox', 'allow-same-origin allow-popups allow-popups-to-escape-sandbox'); frame.referrerPolicy = 'no-referrer';
    const plain = el('pre', '', email.body); plain.hidden = true;
    frameBox.append(frame, plain);
    inner.append(notice, frameBox);

    let formatted = true; let observer;
    const imagesButton = el('button', 'btn btn--subtle', 'Show images'); imagesButton.type = 'button'; imagesButton.hidden = true;
    const formatButton = el('button', 'btn btn--subtle', 'Plain text'); formatButton.type = 'button'; formatButton.hidden = true;
    const retryButton = el('button', 'btn btn--subtle', 'Retry'); retryButton.type = 'button'; retryButton.hidden = true;
    notice.append(imagesButton, formatButton, retryButton);
    const fit = () => {
      const body = frame.contentDocument?.body;
      if (!frame.hidden && body?.dataset.emailDocument) frame.style.height = `${Math.max(160, Math.min(30000, body.scrollHeight + 8))}px`;
    };
    frame.addEventListener('load', () => {
      const body = frame.contentDocument?.body;
      if (!body?.dataset.emailDocument) { frame.hidden = true; plain.hidden = false; formatButton.hidden = true; imagesButton.hidden = true; status.textContent = 'Showing saved text'; return; }
      frame.hidden = !formatted; plain.hidden = formatted; formatButton.hidden = false;
      const blocked = body.dataset.remoteImages === 'true' && !frame.src.includes('images=true');
      imagesButton.hidden = !blocked || !formatted;
      status.textContent = body.dataset.warning ? `Showing saved text. ${body.dataset.warning}` : blocked ? 'Images are hidden to protect your privacy.' : '';
      retryButton.hidden = !body.dataset.warning || email.isDemo;
      observer?.disconnect(); observer = new ResizeObserver(fit); observer.observe(body); fit();
    });
    formatButton.addEventListener('click', () => {
      formatted = !formatted; frame.hidden = !formatted; plain.hidden = formatted; formatButton.textContent = formatted ? 'Plain text' : 'Formatted';
      imagesButton.hidden = !formatted || frame.contentDocument?.body.dataset.remoteImages !== 'true' || frame.src.includes('images=true'); fit();
    });
    imagesButton.addEventListener('click', () => { imagesButton.hidden = true; frame.src = `/emails/${email.id}/body?images=true`; });
    retryButton.addEventListener('click', () => { status.textContent = 'Loading message…'; frame.src = `/emails/${email.id}/body`; });
    frame.src = `/emails/${email.id}/body`;

    // Attachments
    const attachments = el('div', 'attachments'); inner.append(attachments);
    if (email.hasAttachments) {
      if (email.isDemo) attachments.append(el('span', 'muted', 'This demo message has an attachment that is not stored.'));
      else api(`/emails/${email.id}/attachments`).then(data => {
        if (state.detailVersion !== version) return;
        for (const item of data.attachments) {
          const chip = el('button', 'attachment'); chip.type = 'button'; chip.innerHTML = icon('paperclip', 'icon--sm');
          chip.append(el('span', 'truncate', item.name), el('small', '', item.size ? `${Math.max(1, Math.round(item.size / 1024))} KB` : ''));
          chip.addEventListener('click', () => download(`/emails/${email.id}/attachments/${encodeURIComponent(item.id)}`, item.name).catch(error => toast(error.message, 'error')));
          attachments.append(chip);
        }
      }).catch(error => attachments.append(el('span', 'muted', error.message)));
    }

    // Replies and forwards sent from this app
    if (email.conversation.length) {
      const sent = el('div', 'sent-list');
      for (const item of email.conversation) {
        const box = el('div', 'sent');
        const stateLabel = item.state === 'accepted' ? 'Sent' : item.state === 'failed' ? 'Not sent' : 'Check your Sent folder';
        box.append(el('strong', '', `${item.action === 'reply' ? 'You replied' : 'You forwarded'} · ${stateLabel}`),
          el('small', '', `${item.payload.recipients?.length ? `To ${item.payload.recipients.join(', ')} · ` : ''}${longDate(item.createdAt)}`),
          el('p', '', item.payload.comment ?? ''));
        sent.append(box);
      }
      inner.append(sent);
    }

    const replyHolder = el('div'); inner.append(replyHolder);
    const canSend = !email.isDemo && selectedAccount && !selectedAccount.needsReconnect;
    for (const act of ['reply', 'forward']) {
      const button = toolbar.querySelector(`[data-act="${act}"]`);
      button.disabled = !canSend; button.title = canSend ? '' : email.isDemo ? 'Demo mailboxes cannot send mail.' : 'Reconnect this account to send.';
    }
    toolbar.querySelector('[data-act="eml-original"]').disabled = email.isDemo;

    toolbar.addEventListener('click', event => {
      const act = event.target.closest('[data-act]')?.dataset.act;
      if (act === 'back') workspace.dataset.view = 'list';
      else if (act === 'toggle-read') setRead(email.id, !state.current.isRead);
      else if (act === 'reply' || act === 'forward') openReplyBox(replyHolder, email, act);
      else if (act === 'eml-text') download(`/emails/${email.id}/export`, `mail-${email.id}-text.eml`).catch(error => toast(error.message, 'error'));
      else if (act === 'eml-original') download(`/emails/${email.id}/export?original=true`, `mail-${email.id}-original.eml`).catch(error => toast(error.message, 'error'));
    });
    reader.scrollTop = 0; scroll.scrollTop = 0;
  }

  function openReplyBox(holder, email, action) {
    holder.replaceChildren();
    const box = el('form', 'reply-box'); box.noValidate = true;
    box.append(el('h3', '', action === 'reply' ? 'Reply' : 'Forward'));
    if (action === 'forward') {
      const field = el('div', 'field'); const label = el('label', 'label', 'To'); label.htmlFor = 'forward-to';
      const input = el('input', 'input'); input.id = 'forward-to'; input.name = 'recipients'; input.autocomplete = 'off'; input.placeholder = 'name@example.com, other@example.com';
      field.append(label, input, el('p', 'help', 'Separate addresses with commas. Attachments are not included in forwards from Gmail.')); box.append(field);
    } else box.append(el('p', 'help', 'Your reply goes to the sender and keeps the conversation together.'));
    const area = el('textarea', 'textarea'); area.name = 'comment'; area.maxLength = 20000; area.setAttribute('aria-label', 'Message'); area.rows = 6;
    const actions = el('div', 'row');
    const send = el('button', 'btn btn--primary'); send.type = 'submit'; send.innerHTML = `${icon('send')}Send`;
    const cancel = el('button', 'btn', 'Discard'); cancel.type = 'button';
    actions.append(send, cancel); box.append(area, actions);
    holder.append(box);
    (box.elements.recipients ?? area).focus(); box.scrollIntoView({ block: 'nearest' });
    // One request ID per attempt: retrying a failed send after edits is a new send, never a duplicate.
    let requestId = crypto.randomUUID(); let attempted = false;
    box.addEventListener('input', () => { if (attempted) { requestId = crypto.randomUUID(); attempted = false; } });
    cancel.addEventListener('click', () => holder.replaceChildren());
    box.addEventListener('submit', async event => {
      event.preventDefault();
      const recipients = action === 'forward' ? box.elements.recipients.value.split(/[,;]/).map(item => item.trim()).filter(Boolean) : [];
      if (action === 'forward' && !recipients.length) { toast('Enter at least one recipient.', 'error'); return; }
      if (action === 'reply' && !area.value.trim()) { toast('Write a message first.', 'error'); return; }
      send.disabled = true; send.setAttribute('aria-busy', 'true'); attempted = true;
      try {
        await api(`/emails/${email.id}/send`, json('POST', { action, requestId, comment: area.value, recipients }));
        toast(action === 'reply' ? 'Reply sent.' : 'Message forwarded.', 'success');
        if (state.selectedId === email.id) { const keep = state.current; await openMessage(email.id); if (keep) state.current.isRead = true; }
      } catch (error) { toast(error.message, 'error'); send.disabled = false; send.removeAttribute('aria-busy'); }
    });
  }


  // ---------- Compose ----------
  const composeBody = $('#compose-body'); const composeStatus = $('#compose-status'); const composeForm = $('#compose-form');
  let composeRequest = crypto.randomUUID(); let composeAttempted = false; let composeBusy = false;

  function openCompose() {
    const senders = state.accounts.filter(item => !item.isDemo && !item.needsReconnect);
    composeStatus.textContent = ''; composeBody.replaceChildren();
    $('#compose-send').disabled = !senders.length;
    if (!senders.length) {
      const banner = el('div', 'banner banner--warning'); banner.innerHTML = icon('info');
      banner.append(el('div', 'banner__text', state.accounts.length ? 'Your accounts here are demo mailboxes or need to be reconnected. Connect an Outlook or Gmail account to send mail.' : 'Connect an Outlook or Gmail account first, then you can send mail from it.'));
      composeBody.append(banner); dialog.showModal(); return;
    }
    composeBody.innerHTML = `
      <div class="compose-row"><label for="c-from">From</label><select class="select" id="c-from" name="accountId"></select></div>
      <div class="compose-row"><label for="c-to">To</label><input class="input" id="c-to" name="to" autocomplete="off" placeholder="name@example.com"></div>
      <div class="compose-row" data-extra hidden><label for="c-cc">Cc</label><input class="input" id="c-cc" name="cc" autocomplete="off"></div>
      <div class="compose-row" data-extra hidden><label for="c-bcc">Bcc</label><input class="input" id="c-bcc" name="bcc" autocomplete="off"></div>
      <div class="compose-row"><span></span><button type="button" class="btn btn--subtle" id="c-more" aria-expanded="false">Add Cc and Bcc</button></div>
      <div class="compose-row"><label for="c-subject">Subject</label><input class="input" id="c-subject" name="subject" maxlength="250" autocomplete="off"></div>
      <textarea class="textarea" name="body" rows="10" maxlength="20000" aria-label="Message"></textarea>`;
    const select = composeBody.querySelector('#c-from');
    for (const item of senders) { const option = new Option(`${item.email} (${providerName(item.provider)})`, item.id); select.add(option); }
    if (senders.some(item => item.id === state.accountId)) select.value = state.accountId;
    composeBody.querySelector('#c-more').addEventListener('click', event => {
      composeBody.querySelectorAll('[data-extra]').forEach(row => { row.hidden = false; }); event.currentTarget.closest('.compose-row').hidden = true;
    });
    composeRequest = crypto.randomUUID(); composeAttempted = false;
    dialog.showModal(); composeBody.querySelector('#c-to').focus();
  }

  for (const button of dialog.querySelectorAll('[data-close]')) button.addEventListener('click', () => { if (!composeBusy) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (composeBusy) event.preventDefault(); });
  composeForm.addEventListener('input', () => { if (composeAttempted) { composeRequest = crypto.randomUUID(); composeAttempted = false; } });
  composeForm.addEventListener('submit', async event => {
    event.preventDefault(); if (composeBusy || !composeForm.elements.accountId) return;
    const list = name => composeForm.elements[name].value.split(/[,;]/).map(item => item.trim()).filter(Boolean);
    const payload = { accountId: composeForm.elements.accountId.value, requestId: composeRequest, subject: composeForm.elements.subject.value,
      body: composeForm.elements.body.value, to: list('to'), cc: list('cc'), bcc: list('bcc') };
    if (!payload.to.length || !payload.subject.trim() || !payload.body.trim()) { composeStatus.textContent = 'Add a recipient, a subject and a message.'; return; }
    composeBusy = true; composeAttempted = true; composeStatus.textContent = 'Sending…';
    const send = $('#compose-send'); send.disabled = true; send.setAttribute('aria-busy', 'true');
    try {
      await api('/emails/compose', json('POST', payload));
      dialog.close(); toast('Message sent.', 'success');
    } catch (error) { composeStatus.textContent = error.message; }
    finally { composeBusy = false; send.disabled = false; send.removeAttribute('aria-busy'); }
  });

  // ---------- Sync ----------
  async function syncAccount(item) {
    let pages = 0; let processed = 0; let result;
    do { result = await api(`/accounts/${item.id}/sync`, json('POST')); processed += result.processed + (result.removed ?? 0); pages++; }
    while (result.hasMore && pages < 40);
    return processed;
  }

  async function syncAll({ auto = false } = {}) {
    if (state.syncing) return;
    const targets = state.accounts.filter(item => !item.isDemo && !item.needsReconnect);
    if (!targets.length) { if (!auto) toast(state.accounts.length ? 'Demo mailboxes have nothing to sync.' : 'Connect an account first.'); return; }
    state.syncing = true; state.syncMessage = ''; renderSyncStatus();
    $('#sync-button').disabled = true;
    let changed = 0;
    const results = await Promise.allSettled(targets.map(syncAccount));
    results.forEach((result, index) => {
      const target = targets[index];
      if (result.status === 'fulfilled') { changed += result.value; state.shownErrors.delete(target.id); return; }
      // Repeat failures from background syncs are shown once, not every two minutes.
      if (state.shownErrors.get(target.id) !== result.reason.message) { state.shownErrors.set(target.id, result.reason.message); toast(`${target.email}: ${result.reason.message}`, 'error'); }
    });
    state.syncing = false; state.lastSync = Date.now(); $('#sync-button').disabled = false;
    if (results.some(result => result.status === 'rejected')) state.syncMessage = 'Some accounts could not sync';
    try { await loadAccounts(); } catch { /* The next sync retries. */ }
    // New mail jumps into view only when the person is already at the top of the list.
    if (changed) {
      if (scroller.scrollTop < 40 || !list.children.length) await loadList();
      else toast('New mail arrived. Scroll up to see it.');
    }
    renderSyncStatus();
  }

  $('#sync-button').addEventListener('click', () => syncAll());
  setInterval(() => { if (!document.hidden) syncAll({ auto: true }); }, 120_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - state.lastSync > 60_000) syncAll({ auto: true }); });

  // ---------- Controls ----------
  for (const tab of document.querySelectorAll('[data-filter]')) tab.addEventListener('click', () => {
    state.filter = tab.dataset.filter;
    for (const item of document.querySelectorAll('[data-filter]')) item.setAttribute('aria-selected', String(item === tab));
    loadList();
  });
  popover($('#sort-button'), $('#sort-menu'));
  for (const item of document.querySelectorAll('[data-sort]')) item.addEventListener('click', () => {
    state.sort = item.dataset.sort;
    for (const option of document.querySelectorAll('[data-sort]')) option.setAttribute('aria-checked', String(option === item));
    loadList();
  });
  $('#more-button').addEventListener('click', () => loadList({ reset: false }));

  const searchInput = $('#search-input'); let searchTimer;
  const runSearch = () => { state.search = searchInput.value.trim(); renderTitle(); loadList(); };
  searchInput.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 250); });
  $('#search-form').addEventListener('submit', event => { event.preventDefault(); clearTimeout(searchTimer); runSearch(); });
  searchInput.addEventListener('keydown', event => { if (event.key === 'Escape' && searchInput.value) { searchInput.value = ''; clearTimeout(searchTimer); runSearch(); } });

  // Arrow keys move through the list like Outlook.
  list.addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const rows = [...list.querySelectorAll('.msg')]; const index = rows.indexOf(document.activeElement);
    const next = rows[index + (event.key === 'ArrowDown' ? 1 : -1)];
    if (next) { event.preventDefault(); next.focus(); }
  });

  // ---------- Start ----------
  const connectMessages = {
    ok: ['Account connected. Syncing your mail…', 'success'], renewed: ['Sign-in renewed.', 'success'], denied: ['Sign-in was cancelled.', 'error'],
    'invalid-state': ['That sign-in expired. Please try connecting again.', 'error'], unavailable: ['That provider is not set up on this server.', 'error'],
  };
  async function start() {
    buildSidebar(); clearReader();
    const params = new URLSearchParams(location.search);
    state.accountId = params.get('account');
    const connect = params.get('connect');
    // Only fixed texts are shown for a result named in the address; the reason for a failure comes from the server.
    if (connectMessages[connect]) toast(...connectMessages[connect]);
    if (params.has('connect') || params.has('message')) { const url = new URL(location.href); url.search = state.accountId ? `?account=${state.accountId}` : ''; history.replaceState(null, '', url); }
    try { await whoAmI(); await loadAccounts(); }
    catch (error) { toast(error.message, 'error'); return; }
    if (state.notice || (connect && !connectMessages[connect])) toast(state.notice || 'Could not connect the account.', 'error');
    await loadList();
    if (['ok', 'renewed'].includes(connect) || state.accounts.some(item => !item.isDemo && !item.syncedAt)) syncAll({ auto: true });
    else if (state.accounts.some(item => !item.isDemo)) syncAll({ auto: true });
  }
  start();
})();
