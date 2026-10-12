(() => {
  class AppNavbar extends HTMLElement {
    connectedCallback() {
      this.innerHTML = '<nav class="topbar" aria-label="Your profile"><button type="button" class="theme-toggle" data-theme-toggle aria-label="Switch to dark theme" aria-pressed="false"><span class="theme-side-label">Light</span><span class="theme-toggle-track" aria-hidden="true"><span class="theme-toggle-thumb"><span class="theme-sun">☀</span><span class="theme-moon">☾</span></span></span><span class="theme-side-label">Dark</span><span class="sr-only" data-theme-label>Dark theme</span></button><div class="profile"><span class="avatar" data-user-initial aria-hidden="true"></span><div><strong data-current-user>Loading…</strong><small data-current-role></small></div></div></nav>';
    }
  }
  customElements.define('app-navbar', AppNavbar);
})();
