// Settings: profile photo, connected accounts, password, recent activity and appearance.
(() => {
  const { icon, api, json, avatar, toast, whoAmI, paintProfile, displayName, providerName, setNav } = window.App;
  window.App.mountAppbar();

  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
  const sections = [
    ['profile', 'user', 'Profile'], ['accounts', 'layers', 'Mail accounts'], ['security', 'lock', 'Password'], ['activity', 'eye', 'Recent activity'], ['appearance', 'palette', 'Appearance'],
  ];
  const root = document.querySelector('#settings');
  const nav = document.querySelector('#settings-nav');
  document.querySelector('[data-icon="mail"]').insertAdjacentHTML('afterbegin', icon('mail'));
  let user;

  async function busy(button, work) {
    button.disabled = true; button.setAttribute('aria-busy', 'true');
    try { return await work(); } catch (error) { toast(error.message, 'error'); } finally { button.disabled = false; button.removeAttribute('aria-busy'); }
  }

  function card(id, title, description) {
    const section = el('section', 'card'); section.id = id; section.setAttribute('aria-labelledby', `${id}-title`);
    const head = el('div', 'card__head'); const h = el('h2', null, title); h.id = `${id}-title`; head.append(h);
    if (description) head.append(el('p', 'muted', description));
    section.append(head); const body = el('div', 'card__body stack'); section.append(body);
    return { section, body };
  }
  function field(label, input, help) {
    const wrap = el('div', 'field'); const l = el('label', 'label', label); input.id ||= `f-${Math.random().toString(36).slice(2)}`; l.htmlFor = input.id;
    wrap.append(l, input); if (help) wrap.append(el('p', 'help', help)); return wrap;
  }
  const input = (type, name, attrs = {}) => { const i = el('input', 'input'); i.type = type; i.name = name; Object.assign(i, attrs); return i; };

  // ---------- Profile ----------
  // Pictures are scaled down in the browser so uploads stay small.
  // A data: URL is read instead of a blob: URL because the page's CSP only allows 'self' and data: images.
  function resize(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('That file could not be read.'));
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const size = 256; const side = Math.min(img.width, img.height);
          const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
          canvas.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
          resolve(canvas.toDataURL('image/jpeg', 0.88));
        };
        img.onerror = () => reject(new Error('That file is not a picture we can read.'));
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function profileCard() {
    const { section, body } = card('profile', 'Profile', 'Your name and photo appear in the app bar.');
    const row = el('div', 'profile-photo'); const preview = el('div');
    const actions = el('div', 'row'); const file = input('file', 'photo', { accept: 'image/png,image/jpeg,image/webp' }); file.hidden = true;
    const upload = el('button', 'btn btn--primary', 'Upload photo'); upload.type = 'button';
    const remove = el('button', 'btn', 'Remove'); remove.type = 'button';
    const paint = () => { preview.replaceChildren(avatar({ name: displayName(user), key: user.email, url: user.avatarUrl, size: 'xl' })); remove.hidden = !user.avatarUrl; paintProfile(user); };
    upload.addEventListener('click', () => file.click());
    file.addEventListener('change', () => {
      const chosen = file.files[0]; file.value = ''; if (!chosen) return;
      busy(upload, async () => {
        const image = await resize(chosen);
        const result = await api('/users/me/avatar', json('PUT', { image }));
        user.avatarUrl = result.avatarUrl ?? `/users/me/avatar?v=${Date.now()}`; paint(); toast('Photo updated.', 'success');
      });
    });
    remove.addEventListener('click', () => busy(remove, async () => { await api('/users/me/avatar', json('DELETE')); user.avatarUrl = null; paint(); toast('Photo removed.', 'success'); }));
    actions.append(upload, remove, file);
    const side = el('div', 'stack'); side.append(actions, el('p', 'help', 'PNG, JPEG or WebP. It is cropped to a square.'));
    row.append(preview, side);

    const form = el('form', 'stack'); form.noValidate = true;
    const name = input('text', 'displayName', { value: user.displayName ?? '', maxLength: 80, autocomplete: 'name' });
    const email = input('email', 'email', { value: user.email, disabled: true });
    const save = el('button', 'btn btn--primary', 'Save'); save.type = 'submit';
    const foot = el('div', 'row'); foot.append(save);
    form.append(field('Display name', name), field('Email', email), foot);
    form.addEventListener('submit', event => {
      event.preventDefault();
      busy(save, async () => {
        const result = await api('/users/me', json('PATCH', { displayName: name.value.trim() }));
        user = { ...user, ...(result.user ?? { displayName: name.value.trim() }) }; paint(); toast('Profile saved.', 'success');
      });
    });
    body.append(row, form); paint(); return section;
  }

  // ---------- Accounts ----------
  function accountsCard() {
    const { section, body } = card('accounts', 'Mail accounts', 'Every account you connect shows up in All mail and as its own mailbox.');
    const list = el('div'); const connect = el('div', 'connect-buttons'); body.append(list, connect);
    async function load() {
      const data = await api('/accounts');
      list.replaceChildren();
      if (!data.accounts.length) list.append(el('p', 'muted', 'No accounts yet. Connect one below.'));
      for (const item of data.accounts) {
        const row = el('div', 'account-row'); row.dataset.color = item.color;
        const dot = el('span', 'dot'); const info = el('div', 'account-row__info');
        info.append(el('strong', 'truncate', item.email), el('small', null, `${providerName(item.provider)}${item.isDemo ? ' · demo' : ''}${item.needsReconnect ? ' · sign-in expired' : item.lastError ? ` · ${item.lastError}` : ''} · ${item.total ?? 0} messages`));
        row.append(dot, info);
        if (item.needsReconnect) { const r = el('a', 'btn', 'Reconnect'); r.href = `/accounts/connect/${item.provider}`; row.append(r); }
        else if (!item.isDemo) { const s = el('button', 'btn', 'Sync now'); s.type = 'button'; s.addEventListener('click', () => busy(s, async () => { await api(`/accounts/${item.id}/sync`, json('POST')); toast('Synced.', 'success'); await load(); })); row.append(s); }
        const del = el('button', 'btn btn--danger', 'Remove'); del.type = 'button';
        del.addEventListener('click', () => {
          if (!confirm(`Remove ${item.email}? Its cached mail is deleted from here. Your mailbox at ${providerName(item.provider)} is not touched.`)) return;
          busy(del, async () => { await api(`/accounts/${item.id}`, json('DELETE')); toast('Account removed.', 'success'); await load(); });
        });
        row.append(del); list.append(row);
      }
      connect.replaceChildren();
      for (const provider of ['outlook', 'gmail'].filter(item => item in data.providers)) {
        const ok = data.providers[provider];
        const node = el(ok ? 'a' : 'button', ok ? 'btn' : 'btn', ok ? `Add ${providerName(provider)}` : `${providerName(provider)} not set up`);
        if (ok) node.href = `/accounts/connect/${provider}`; else { node.type = 'button'; node.disabled = true; }
        connect.append(node);
      }
    }
    load().catch(error => toast(error.message, 'error')); return section;
  }

  // ---------- Password ----------
  function securityCard() {
    const { section, body } = card('security', 'Password', 'Changing it signs you out everywhere.');
    const form = el('form', 'stack'); form.noValidate = true;
    const current = input('password', 'current', { autocomplete: 'current-password', maxLength: 1024 });
    const next = input('password', 'next', { autocomplete: 'new-password', maxLength: 1024 });
    const confirmInput = input('password', 'confirm', { autocomplete: 'new-password', maxLength: 1024 });
    const save = el('button', 'btn btn--primary', 'Change password'); save.type = 'submit';
    form.append(field('Current password', current), field('New password', next, 'At least 12 characters.'), field('Confirm new password', confirmInput), save);
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (next.value.length < 12) return toast('Use a password of at least 12 characters.', 'error');
      if (next.value !== confirmInput.value) return toast('The two passwords do not match.', 'error');
      busy(save, async () => { await api('/auth/password', json('POST', { currentPassword: current.value, newPassword: next.value })); location.assign('index.html'); });
    });
    body.append(form); return section;
  }

  // ---------- Recent activity ----------
  // Security events for this account, so a sign-in or change that was not yours stands out.
  function describe(item) {
    const d = item.detail ?? {}; const ok = item.outcome === 'success';
    const mailbox = d.email || (d.provider ? providerName(d.provider) : 'a mailbox');
    switch (item.event) {
      case 'sign-in': return ok ? 'Signed in' : 'Failed sign-in attempt';
      case 'sign-out': return 'Signed out';
      case 'register': return 'Account created';
      case 'password-change': return ok ? 'Password changed' : 'Password change refused: wrong current password';
      case 'password-reset-request': return 'Password reset link requested';
      case 'password-reset': return 'Password reset with an emailed link';
      case 'account-connect': return ok ? `${d.renewed ? 'Reconnected' : 'Connected'} ${mailbox}` : `Could not connect ${mailbox}`;
      case 'account-remove': return `Removed ${mailbox}`;
      case 'mail-send': return ok ? ({ reply: 'Replied to a message', forward: 'Forwarded a message' }[d.action] ?? 'Sent a message') : 'A message could not be sent';
      case 'mail-export': return 'Downloaded a message';
      case 'attachment-download': return 'Downloaded an attachment';
      case 'request-refused': return d.status === 429 ? 'Too many attempts: temporarily blocked' : 'Blocked a request from another site';
      default: return item.event;
    }
  }
  function device(userAgent) {
    const browser = [['Edg/', 'Edge'], ['Firefox/', 'Firefox'], ['Chrome/', 'Chrome'], ['Safari/', 'Safari']].find(([mark]) => userAgent.includes(mark))?.[1];
    const system = [['Windows', 'Windows'], ['Android', 'Android'], ['iPhone', 'iOS'], ['iPad', 'iOS'], ['Mac OS X', 'macOS'], ['Linux', 'Linux']].find(([mark]) => userAgent.includes(mark))?.[1];
    return [browser, system].filter(Boolean).join(' on ') || 'Unknown device';
  }
  function activityCard() {
    const { section, body } = card('activity', 'Recent activity', 'Sign-ins and changes on your account from the last 90 days. If something here was not you, change your password.');
    const list = el('div'); list.id = 'activity-list'; body.append(list);
    api('/auth/activity').then(data => {
      if (!data.events.length) { list.append(el('p', 'muted', 'Nothing yet.')); return; }
      for (const item of data.events) {
        const row = el('div', 'account-row'); row.dataset.color = item.outcome === 'success' ? 'green' : 'red';
        const info = el('div', 'account-row__info');
        info.append(el('strong', 'truncate', describe(item)),
          el('small', null, `${new Date(item.occurredAt).toLocaleString()} · ${device(item.userAgent)}${item.ip ? ` · ${item.ip}` : ''}`));
        row.append(el('span', 'dot'), info); list.append(row);
      }
    }).catch(error => toast(error.message, 'error'));
    return section;
  }

  // ---------- Appearance ----------
  function appearanceCard() {
    const { section, body } = card('appearance', 'Appearance', 'Choose how Mailbridge looks on this device.');
    const group = el('div', 'tabs'); group.setAttribute('role', 'group'); group.setAttribute('aria-label', 'Theme');
    // Toggle buttons in a group report their state with aria-pressed (aria-selected belongs to tabs and options).
    const paint = () => { for (const t of group.querySelectorAll('.tab')) t.setAttribute('aria-pressed', String(t.dataset.themeSet === window.Theme.get())); };
    for (const [value, label] of [['light', 'Light'], ['dark', 'Dark']]) { const b = el('button', 'btn', label); b.type = 'button'; b.className = 'tab'; b.dataset.themeSet = value; group.append(b); }
    group.addEventListener('click', () => queueMicrotask(paint));
    paint();
    body.append(group); return section;
  }

  // ---------- Page ----------
  async function start() {
    try { user = await whoAmI(); } catch (error) { toast(error.message, 'error'); return; }
    user = { ...user };
    const builders = { profile: profileCard, accounts: accountsCard, security: securityCard, activity: activityCard, appearance: appearanceCard };
    root.replaceChildren(el('h1', 'settings__title', 'Settings'));
    for (const [id, iconName, label] of sections) {
      const link = el('a', 'nav-item'); link.href = `#${id}`; link.insertAdjacentHTML('afterbegin', icon(iconName)); link.append(el('span', 'nav-item__text', label));
      link.addEventListener('click', () => setNav(false));
      nav.append(link); root.append(builders[id]());
    }
    const mark = () => { const id = location.hash.slice(1) || 'profile'; for (const a of nav.querySelectorAll('a')) { if (a.hash === `#${id}`) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); } };
    window.addEventListener('hashchange', mark); mark();
  }
  start();
})();
