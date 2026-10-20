// Shared client code for every signed-in page: API calls, avatars, notices, menus and the app bar.
(() => {
  const APP_NAME = 'Mailbridge';

  // ---------- Icons ----------
  const icon = (name, extra = '') => `<svg class="icon ${extra}" aria-hidden="true"><use href="assets/icons.svg#${name}"></use></svg>`;

  // ---------- Requests ----------
  async function api(path, options) {
    const response = await fetch(path, { cache: 'no-store', ...options });
    // Signed-out visitors go to the sign-in page; public pages (<body data-public>) handle 401 themselves.
    if (response.status === 401 && !('public' in document.body.dataset)) {
      location.assign('index.html');
      throw new Error('Please sign in.');
    }
    let data = {};
    try {
      data = await response.json();
    } catch {
      /* Empty or non-JSON body. */
    }
    if (!response.ok) throw new Error(data.error?.message || 'The request failed. Please try again.');
    return data;
  }
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  async function download(path, fallbackName) {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) {
      if (response.status === 401) location.assign('index.html');
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error?.message || 'Download failed.');
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = fallbackName;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- People ----------
  const initials = text => {
    const parts = String(text || '?')
      .replace(/[<>@.]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  };
  // The same person always gets the same color.
  const personColor = key => {
    let hash = 0;
    for (const char of String(key).toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return hash % 8;
  };
  function avatar({ name, key, url, size = '' }) {
    const el = document.createElement('span');
    el.className = `avatar${size ? ` avatar--${size}` : ''}`;
    el.dataset.person = personColor(key || name);
    if (url) {
      const img = document.createElement('img');
      img.alt = '';
      img.src = url;
      el.append(img);
    } else el.textContent = initials(name);
    return el;
  }
  const displayName = user => user.displayName || user.email;

  // ---------- Notices ----------
  function toast(message, tone = 'info') {
    let region = document.querySelector('.toasts');
    if (!region) {
      region = document.createElement('div');
      region.className = 'toasts';
      region.setAttribute('role', 'status');
      document.body.append(region);
    }
    const box = document.createElement('div');
    box.className = `banner${tone === 'error' ? ' banner--error' : tone === 'success' ? ' banner--success' : ''}`;
    box.innerHTML = icon(tone === 'error' ? 'alert' : tone === 'success' ? 'check-circle' : 'info');
    const text = document.createElement('div');
    text.className = 'banner__text';
    text.textContent = message;
    box.append(text);
    region.append(box);
    setTimeout(() => box.remove(), tone === 'error' ? 9000 : 4500);
  }

  // ---------- Menus ----------
  // Opens/closes a menu from a trigger; closes on outside click and Escape and returns focus.
  function popover(trigger, menu) {
    const close = (focus = false) => {
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      if (focus) trigger.focus();
    };
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    menu.hidden = true;
    trigger.addEventListener('click', event => {
      event.stopPropagation();
      const opening = menu.hidden;
      document.dispatchEvent(new CustomEvent('menu-open'));
      menu.hidden = !opening;
      trigger.setAttribute('aria-expanded', String(opening));
      if (opening) menu.querySelector('a,button')?.focus();
    });
    // Document-level listeners remove themselves once the trigger leaves the page, so rebuilt toolbars do not leak.
    const onOpen = () => {
      if (!trigger.isConnected) cleanup();
      else close();
    };
    const onClick = event => {
      if (!trigger.isConnected) cleanup();
      else if (!menu.hidden && !menu.contains(event.target)) close();
    };
    const cleanup = () => {
      document.removeEventListener('menu-open', onOpen);
      document.removeEventListener('click', onClick);
    };
    document.addEventListener('menu-open', onOpen);
    document.addEventListener('click', onClick);
    // role="menu" promises arrow-key movement between items (WAI-ARIA menu pattern).
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape') close(true);
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const items = [...menu.querySelectorAll('a,button')];
      const index = items.indexOf(document.activeElement);
      const next = items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
      event.preventDefault();
      next?.focus();
    });
    menu.addEventListener('click', event => {
      if (event.target.closest('button,a')) close();
    });
    return { close };
  }

  // ---------- App bar ----------
  // Fetched on first use, so public pages never ask who is signed in unless they want to.
  let currentUser;
  const whoAmI = () => (currentUser ??= api('/auth/me').then(({ user }) => user));

  function mountAppbar({ search = false } = {}) {
    const bar = document.querySelector('[data-appbar]');
    if (!bar) return;
    bar.className = 'appbar';
    bar.innerHTML = `
      <button type="button" class="icon-btn appbar__nav" data-action="toggle-nav" aria-label="Open navigation" aria-expanded="false">${icon('menu')}</button>
      <a class="appbar__brand" href="app.html"><img class="logo-light" src="assets/logo.svg" alt=""><img class="logo-dark" src="assets/logo-dark.svg" alt=""><span>${APP_NAME}</span></a>
      ${search ? `<form class="appbar__search" role="search" id="search-form">${icon('search', 'icon--sm')}<label class="sr-only" for="search-input">Search mail</label><input id="search-input" type="search" maxlength="200" placeholder="Search all mail" autocomplete="off"></form>` : ''}
      <div class="appbar__actions">
        <button type="button" class="icon-btn" data-theme-toggle>${icon('sun', 'icon-sun')}${icon('moon', 'icon-moon')}</button>
        <a class="icon-btn" href="settings.html" aria-label="Settings" title="Settings">${icon('settings')}</a>
        <div class="menu-anchor">
          <button type="button" class="appbar__avatar" id="profile-button" aria-label="Account menu"></button>
          <div class="menu" id="profile-menu" role="menu" hidden>
            <div class="menu__header" id="profile-summary"></div>
            <div class="menu__sep"></div>
            <a class="menu__item" role="menuitem" href="settings.html">${icon('user')}Profile and accounts</a>
            <button type="button" class="menu__item" role="menuitem" data-action="logout">${icon('log-out')}Sign out</button>
          </div>
        </div>
      </div>`;
    window.Theme?.apply();
    popover(bar.querySelector('#profile-button'), bar.querySelector('#profile-menu'));
    bar.querySelector('[data-action="logout"]').addEventListener('click', async event => {
      event.currentTarget.disabled = true;
      try {
        await api('/auth/logout', json('POST'));
        location.assign('index.html');
      } catch (error) {
        toast(error.message, 'error');
        event.currentTarget.disabled = false;
      }
    });
    whoAmI()
      .then(user => paintProfile(user))
      .catch(() => {});
    const nav = bar.querySelector('[data-action="toggle-nav"]');
    nav.addEventListener('click', () => setNav(!document.querySelector('.workspace')?.classList.contains('is-nav-open')));
  }

  function paintProfile(user) {
    const button = document.querySelector('#profile-button');
    if (button) button.replaceChildren(avatar({ name: displayName(user), key: user.email, url: user.avatarUrl, size: 'sm' }));
    const summary = document.querySelector('#profile-summary');
    if (summary) {
      const who = document.createElement('div');
      who.className = 'menu__who';
      const name = document.createElement('strong');
      name.className = 'truncate';
      name.textContent = displayName(user);
      const mail = document.createElement('small');
      mail.className = 'muted truncate';
      mail.textContent = user.email;
      who.append(name, mail);
      summary.replaceChildren(avatar({ name: displayName(user), key: user.email, url: user.avatarUrl, size: 'lg' }), who);
    }
  }

  // The navigation drawer on narrow screens.
  function setNav(open) {
    const workspace = document.querySelector('.workspace');
    if (!workspace) return;
    workspace.classList.toggle('is-nav-open', open);
    document.querySelector('[data-action="toggle-nav"]')?.setAttribute('aria-expanded', String(open));
    let scrim = document.querySelector('.scrim');
    if (open && !scrim) {
      scrim = document.createElement('div');
      scrim.className = 'scrim';
      scrim.addEventListener('click', () => setNav(false));
      document.body.append(scrim);
    }
    if (!open) scrim?.remove();
  }

  // Escape and growing the window back to the wide layout both close the drawer.
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.querySelector('.workspace.is-nav-open')) setNav(false);
  });
  window.matchMedia('(min-width: 960px)').addEventListener('change', event => {
    if (event.matches) setNav(false);
  });

  // Calendar-aware short dates, like Outlook: time today, weekday this week, date otherwise.
  function shortDate(value) {
    if (!value) return '';
    const date = new Date(value);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const days = (now - date) / 86_400_000;
    if (days < 6) return date.toLocaleDateString([], { weekday: 'short' });
    return date.toLocaleDateString(
      [],
      date.getFullYear() === now.getFullYear() ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' },
    );
  }
  const longDate = value =>
    value
      ? new Date(value).toLocaleString([], {
          weekday: 'short',
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })
      : '';
  const providerName = provider => (provider === 'gmail' ? 'Gmail' : 'Outlook');

  window.App = {
    APP_NAME,
    icon,
    api,
    json,
    download,
    avatar,
    initials,
    personColor,
    displayName,
    toast,
    popover,
    whoAmI,
    mountAppbar,
    paintProfile,
    setNav,
    shortDate,
    longDate,
    providerName,
  };
})();
