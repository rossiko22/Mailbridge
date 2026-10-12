(() => {
  const { api, json, ready, setMeta } = window.mailApp;
  const form = document.querySelector('#token-form'); const input = document.querySelector('#outlook-token');
  const feedback = document.querySelector('#token-feedback'); const status = document.querySelector('#connection-status');
  async function connection() {
    const data = await api('/emails/connection');
    status.textContent = `${data.mailbox} · ${data.source === 'settings' ? 'Token saved in Settings' : 'Using server environment token'}${data.updatedAt ? ` · updated ${new Date(data.updatedAt).toLocaleString()}` : ''}`;
    form.hidden = data.mode !== 'access_token';
    document.querySelector('#connect-outlook').hidden = data.mode !== 'oauth';
    if (data.mode === 'oauth') status.textContent = `${data.mailbox} · ${data.source === 'microsoft' ? 'Connected to Microsoft; tokens renew automatically' : 'Not connected. Sign in to Microsoft to connect this mailbox.'}`;
    if (data.mode === 'application') status.textContent = `${data.mailbox} · Application credentials are managed on the server.`;
  }
  const oauthMessages = { connected: 'Outlook connected successfully.', denied: 'Microsoft sign-in was canceled or consent was denied.', 'invalid-state': 'Microsoft sign-in expired. Please connect again.', failed: 'Could not connect Outlook. Check that you chose the configured mailbox and granted User.Read, Mail.Read and Mail.Send. Also check the server app registration and secret.' };
  const result = new URLSearchParams(location.search).get('outlook');
  document.querySelector('#oauth-feedback').textContent = oauthMessages[result] || '';
  if (result) history.replaceState(null, '', location.pathname);
  const passwordForm = document.querySelector('#password-form');
  passwordForm.addEventListener('submit', async event => {
    event.preventDefault(); const button = passwordForm.querySelector('button'); button.disabled = true;
    try {
      await api('/auth/password', json('POST', { currentPassword: passwordForm.elements.currentPassword.value, newPassword: passwordForm.elements.newPassword.value }));
      location.assign('index.html');
    } catch (error) { document.querySelector('#password-feedback').textContent = error.message; }
    finally { button.disabled = false; }
  });
  const userForm = document.querySelector('#create-user-form');
  ready.then(user => { document.querySelector('#create-user-panel').hidden = user.role !== 2; }).catch(() => {});
  userForm.addEventListener('submit', async event => {
    event.preventDefault(); const button = userForm.querySelector('button'); button.disabled = true;
    const feedback = document.querySelector('#create-user-status');
    try {
      const data = await api('/users', json('POST', { email: userForm.elements.email.value, password: userForm.elements.password.value,
        role: Number(userForm.elements.role.value), avatarPath: '/assets/images/company-mail-logo.png' }));
      userForm.reset(); feedback.textContent = `Created ${data.user.email}. They can now sign in.`;
    } catch (error) { feedback.textContent = error.message; }
    finally { button.disabled = false; }
  });
  ready.then(async () => {
    const meta = await api('/emails/meta'); setMeta(meta);
    if (!meta.outlookConfigured) { status.textContent = 'Local mode: ticket actions and text exports work without Outlook. Configure GRAPH_* on the server to connect a mailbox.'; return; }
    if (!meta.canManage) { status.textContent = 'Only the mailbox owner can update the Outlook connection.'; return; }
    await connection();
  }).catch(error => { status.textContent = error.message; });
  form.addEventListener('submit', async event => {
    event.preventDefault(); const button = form.querySelector('button'); button.disabled = true;
    feedback.textContent = 'Verifying your Outlook account and saving the token…';
    try {
      const result = await api('/emails/connection/token', json('PUT', { token: input.value.trim() }));
      input.value = ''; feedback.textContent = result.message; await connection();
    } catch (error) { feedback.textContent = error.message; }
    finally { button.disabled = false; }
  });
})();
