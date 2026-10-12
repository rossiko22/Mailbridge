(() => {
  const { api, json, ready, setMeta } = window.mailApp;
  const form = document.querySelector('#compose-form'); const status = document.querySelector('#compose-status');
  let requestId = crypto.randomUUID(); let sending = false; let submitted = false;
  const recipients = name => form.elements[name].value.split(',').map(value => value.trim()).filter(Boolean);
  async function history() {
    const data = await api('/emails/outgoing'); const list = document.querySelector('#compose-history'); list.replaceChildren();
    for (const item of data.messages) {
      const li = document.createElement('li'); const title = document.createElement('strong'); const content = document.createElement('p');
      title.textContent = `${item.message.subject} · ${item.state} · ${new Date(item.createdAt).toLocaleString()}`;
      content.textContent = `To: ${item.message.to.join(', ')}\n${item.message.body}`; content.className = 'mail-body-text'; li.append(title,content); list.append(li);
    }
    if (!data.messages.length) list.textContent = 'No new messages sent from this app yet.';
  }
  ready.then(async () => {
    const meta = await api('/emails/meta'); setMeta(meta); await history();
    form.hidden = !meta.canManage || !meta.outlookConfigured;
    status.textContent = !meta.canManage ? 'Only the mailbox owner can start a new conversation.' : !meta.outlookConfigured ? 'Connect Outlook on the server to send a new message.' : 'Ready to send.';
  }).catch(error => { status.textContent = error.message; });
  // Edits after a rejected request form a new submission. Never retry automatically.
  form.addEventListener('input', () => { if (submitted) { requestId = crypto.randomUUID(); submitted = false; } });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (sending) return;
    const payload = { requestId, subject: form.elements.subject.value, body: form.elements.body.value, to: recipients('to'), cc: recipients('cc'), bcc: recipients('bcc') };
    sending = true; submitted = true; const controls = [...form.querySelectorAll('input,textarea,button')]; controls.forEach(el => { el.disabled = true; });
    status.textContent = 'Sending…';
    try {
      await api('/emails/compose', json('POST', payload)); form.reset(); requestId = crypto.randomUUID(); submitted = false;
      status.textContent = 'Message accepted by Outlook.';
    } catch (error) { status.textContent = error.message; }
    finally { sending = false; controls.forEach(el => { el.disabled = false; }); await history().catch(() => {}); }
  });
})();
