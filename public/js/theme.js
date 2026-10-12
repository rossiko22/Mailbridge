(() => {
  const storageKey = 'ticket-mail-theme';
  let theme = 'light';
  try { theme = localStorage.getItem(storageKey) === 'dark' ? 'dark' : 'light'; } catch { /* Storage may be disabled. */ }
  function apply() {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      const dark = theme === 'dark';
      button.setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} theme`);
      button.setAttribute('aria-pressed', String(dark));
      const label = button.querySelector('[data-theme-label]');
      if (label) label.textContent = dark ? 'Light theme' : 'Dark theme';
    });
  }
  apply();
  document.addEventListener('DOMContentLoaded', () => {
    if (document.querySelector('.login-page')) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'button theme-toggle theme-toggle--login';
      button.dataset.themeToggle = ''; button.innerHTML = '<span class="theme-side-label">Light</span><span class="theme-toggle-track" aria-hidden="true"><span class="theme-toggle-thumb"><span class="theme-sun">☀</span><span class="theme-moon">☾</span></span></span><span class="theme-side-label">Dark</span><span class="sr-only" data-theme-label>Dark theme</span>';
      document.body.append(button);
    }
    apply();
    document.querySelectorAll('[data-theme-toggle]').forEach(button => button.addEventListener('click', () => {
      theme = theme === 'light' ? 'dark' : 'light';
      try { localStorage.setItem(storageKey, theme); } catch { /* The current page still updates. */ }
      apply();
    }));
  });
})();
