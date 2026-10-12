(() => {
  async function api(path, options) {
    const response = await fetch(path, { cache: 'no-store', ...options });
    if (response.status === 401) { location.assign('index.html'); throw new Error('Please sign in.'); }
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'The request failed. Please try again.');
    return data;
  }
  async function download(path, fallbackName) {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) {
      if (response.status === 401) location.assign('index.html');
      const data = await response.json(); throw new Error(data.message || 'Download failed.');
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a'); link.href = url; link.download = fallbackName;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const ready = api('/auth/me').then(({ user }) => {
    document.querySelectorAll('[data-current-user]').forEach(el => { el.textContent = user.email; });
    document.querySelectorAll('[data-current-role]').forEach(el => { el.textContent = user.role === 2 ? 'IT Manager' : 'Software Developer'; });
    document.querySelectorAll('[data-user-initial]').forEach(el => { el.textContent = user.email[0].toUpperCase(); });
    return user;
  });
  let syncing = false;
  const syncButton = document.querySelector('[data-action="sync-mailbox"]');
  const feedback = document.querySelector('[data-sync-status]');
  const notify = message => { if (feedback) feedback.textContent = message; };
  async function sync() {
    if (syncing) return;
    syncing = true; syncButton.disabled = true; syncButton.setAttribute('aria-busy', 'true');
    notify('Syncing Outlook…');
    try {
      let result; let pages = 0; let processed = 0;
      do {
        result = await api('/emails/sync', json('POST', {}));
        pages++; processed += result.processed;
        notify(`Syncing… ${processed} messages processed`);
      } while (result.hasMore && pages < 20);
      notify(result.hasMore ? `${processed} processed. Click Sync now to continue.` : `Up to date · ${processed} messages processed`);
      window.dispatchEvent(new Event('mailbox-updated'));
    } catch (error) { notify(error.message); window.dispatchEvent(new Event('mailbox-updated')); }
    finally { syncing = false; syncButton.disabled = false; syncButton.removeAttribute('aria-busy'); }
  }
  syncButton?.addEventListener('click', sync);
  document.querySelector('[data-action="logout"]')?.addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    try { await api('/auth/logout', json('POST', {})); location.assign('index.html'); }
    catch (error) { notify(error.message); document.querySelector('[data-action="logout"]').disabled = false; }
  });
  ready.catch(error => notify(error.message));
  window.mailApp = { api, json, ready, notify, download, setMeta(meta) {
    document.querySelectorAll('[data-count]').forEach(el => { el.textContent = meta.counts[el.dataset.count] ?? 0; });
    if (syncButton) { syncButton.hidden = !meta.canManage || !meta.outlookConfigured; }
    document.querySelector('[href="compose.html"]')?.toggleAttribute('hidden', !meta.canManage);
    if (!meta.outlookConfigured) notify('Local mode · Outlook is not connected');
    else if (!meta.canManage) notify('Showing mail assigned to you');
  } };
})();
