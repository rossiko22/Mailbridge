// Light DOM keeps the shared CSS, semantic landmarks and delegated events intact.
(() => {
  const template = document.createElement('template');
  template.innerHTML = `<aside class="sidebar" aria-label="Application navigation">
        <a class="sidebar-brand" href="app.html" aria-label="Ticket Mail home"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/></svg><span>Ticket Mail</span><small class="version mono">v1.0</small></a>
        <nav class="sidebar-nav" aria-label="Mailbox">
          <a class="nav-link" href="compose.html" aria-label="New message"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span class="nav-label">New message</span></a>
          <a class="nav-link" href="app.html" aria-label="All mail"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16l2 12v4H2v-4L4 4Z"/><path d="M2 15h6l2 3h4l2-3h6"/></svg><span class="nav-label">All mail</span><span class="count" data-count="all">0</span></a>
          <a class="nav-link" href="unassigned.html" aria-label="Unassigned"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 2h6v4H9zM9 11h6m-6 4h3"/></svg><span class="nav-label">Unassigned</span><span class="count" data-count="unassigned">0</span></a>
          <a class="nav-link" href="assigned.html" aria-label="Assigned"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="7" r="3"/><path d="M2 20v-3a7 7 0 0 1 14 0v3ZM16 4a3 3 0 0 1 0 6m3 4a6 6 0 0 1 3 6"/></svg><span class="nav-label">Assigned</span><span class="count" data-count="assigned">0</span></a>
          <a class="nav-link" href="assigned-to-me.html" aria-label="Assigned to me"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7" r="3"/><path d="M5 20v-3a7 7 0 0 1 14 0v3Z"/></svg><span class="nav-label">Assigned to me</span><span class="count" data-count="mine">0</span></a>          <a class="nav-link" href="finished.html" aria-label="Finished"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/></svg><span class="nav-label">Finished</span><span class="count" data-count="finished">0</span></a><a class="nav-link" href="settings.html" aria-label="Settings"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h6l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/></svg><span class="nav-label">Settings</span></a>
        </nav>
        <div class="sidebar-bottom">
          <div class="sync-card" data-sync-state="connected">
            <button type="button" class="button sidebar-sync-button" aria-label="Sync Outlook mailbox now" data-action="sync-mailbox">
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5m-4 8a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/></svg>
              <span>Sync now</span>
            </button>
            <p class="sync-status" role="status"><span class="dot" aria-hidden="true"></span><span data-sync-status>Ready to sync</span></p>
          </div>
          <div class="user-card">
            <div>
              <strong data-current-user>Loading…</strong><small data-current-role></small>
            </div>
            <button type="button" class="icon-button" aria-label="Sign out" title="Sign out" data-action="logout" ><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 3H4v18h6m-1-9h13m-4-4 4 4-4 4"/></svg></button>
          </div>
        </div>
      </aside>`;
  const pages = { compose: 'compose.html', all: 'app.html', unassigned: 'unassigned.html', assigned: 'assigned.html', mine: 'assigned-to-me.html', finished: 'finished.html', settings: 'settings.html' };

  class AppSidebar extends HTMLElement {
    static observedAttributes = ['active', 'version', 'mine-icon'];
    connectedCallback() {
      if (!this.firstElementChild) this.render();
    }

    attributeChangedCallback() {
      if (this.isConnected) this.render();
    }

    render() {
      this.replaceChildren(template.content.cloneNode(true));
      this.querySelector('.version').textContent = this.getAttribute('version') || 'v1.0';
      const current = pages[this.getAttribute('active')];
      for (const link of this.querySelectorAll('.sidebar-nav a')) {
        if (link.getAttribute('href') === current) link.setAttribute('aria-current', 'page');
      }
      if (this.hasAttribute('mine-icon')) {
        const mine = this.querySelector('[href="assigned-to-me.html"]');
        mine.classList.remove('nav-link--nested');
        mine.insertAdjacentHTML('afterbegin', `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7" r="3"/><path d="M5 20v-3a7 7 0 0 1 14 0v3Z"/></svg>`);
      }
    }
  }
  customElements.define('app-sidebar', AppSidebar);
})();
