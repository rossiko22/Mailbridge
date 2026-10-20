// Light/dark theme. Loaded in <head> so the saved theme applies before the page paints.
(() => {
  const storageKey = 'mailbridge-theme';
  // Read once from the name the app used before it was renamed, so nobody loses their choice.
  const legacyKey = 'ticket-mail-theme';
  let theme = 'light';
  try {
    const saved = localStorage.getItem(storageKey) ?? localStorage.getItem(legacyKey);
    if (localStorage.getItem(legacyKey) !== null) {
      if (saved === 'dark' || saved === 'light') localStorage.setItem(storageKey, saved);
      localStorage.removeItem(legacyKey);
    }
    theme = saved === 'dark' || saved === 'light' ? saved : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    /* Storage may be disabled; the current page still works. */
  }

  function apply() {
    document.documentElement.dataset.theme = theme;
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      const dark = theme === 'dark';
      button.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
      button.setAttribute('title', dark ? 'Light theme' : 'Dark theme');
      button.setAttribute('aria-pressed', String(dark));
    });
  }
  apply();

  function set(next) {
    theme = next === 'dark' ? 'dark' : 'light';
    try {
      localStorage.setItem(storageKey, theme);
    } catch {
      /* ignore */
    }
    apply();
  }

  // Delegated, so toggles rendered later by other scripts work without extra wiring.
  document.addEventListener('click', event => {
    if (event.target.closest('[data-theme-toggle]')) set(theme === 'dark' ? 'light' : 'dark');
    else if (event.target.closest('[data-theme-set]')) set(event.target.closest('[data-theme-set]').dataset.themeSet);
  });

  window.Theme = { apply, set, get: () => theme };
})();
