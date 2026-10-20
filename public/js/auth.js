// Sign in, create account, forgot password and reset password. One script, four pages.
(() => {
  const { icon, api, json, APP_NAME } = window.App;
  const form = document.querySelector('[data-auth]');
  const page = form.dataset.auth;
  const card = document.querySelector('.auth__card');

  // Shared page chrome: the brand above the card title and a theme switch in the corner.
  const brand = document.createElement('a');
  brand.className = 'auth__brand';
  brand.href = 'index.html';
  brand.innerHTML = `<img class="logo-light" src="assets/logo.svg" alt=""><img class="logo-dark" src="assets/logo-dark.svg" alt=""><span>${APP_NAME}</span>`;
  card.prepend(brand);
  const themeButton = document.createElement('button');
  themeButton.type = 'button';
  themeButton.className = 'icon-btn auth__theme';
  themeButton.dataset.themeToggle = '';
  themeButton.innerHTML = icon('sun', 'icon-sun') + icon('moon', 'icon-moon');
  document.querySelector('.auth').append(themeButton);
  window.Theme.apply();

  document.querySelectorAll('[data-toggle-password]').forEach(button => {
    const input = button.parentElement.querySelector('input');
    const paint = () => {
      button.innerHTML = icon(input.type === 'password' ? 'eye' : 'eye-off');
    };
    paint();
    button.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.setAttribute('aria-pressed', String(show));
      button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      paint();
    });
  });

  const errorBox = document.querySelector('#form-message');
  const doneBox = document.querySelector('#form-done');
  function show(box, other, name, text) {
    if (other) other.hidden = true;
    box.replaceChildren();
    box.insertAdjacentHTML('afterbegin', icon(name));
    const copy = document.createElement('div');
    copy.className = 'banner__text';
    copy.textContent = text;
    box.append(copy);
    box.hidden = false;
  }
  const fail = text => {
    show(errorBox, doneBox, 'alert', text);
    errorBox.focus();
  };
  const succeed = text => show(doneBox, errorBox, 'check-circle', text);
  const clear = () => {
    errorBox.hidden = true;
    if (doneBox) doneBox.hidden = true;
  };

  // People who are already signed in skip straight to their mail.
  if (page !== 'reset')
    fetch('/auth/me', { cache: 'no-store' })
      .then(response => {
        if (response.ok) location.replace('app.html');
      })
      .catch(() => {});
  if (page === 'login') {
    api('/auth/config')
      .then(config =>
        document.querySelectorAll('[data-needs-registration]').forEach(el => {
          el.hidden = !config.registration;
        }),
      )
      .catch(() => {});
  }

  const need = (value, text) => {
    if (!value) throw new Error(text);
  };
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  function checkPasswords(data) {
    const password = data.get('password');
    need(password.length >= 12, 'Use a password of at least 12 characters.');
    need(password === data.get('confirm'), 'The two passwords do not match.');
    return password;
  }

  // The reset token travels in the URL fragment. Read it once and take it out of the address bar.
  let resetToken = '';
  if (page === 'reset') {
    resetToken = new URLSearchParams(location.hash.slice(1)).get('token') ?? '';
    history.replaceState(null, '', location.pathname);
    if (!resetToken) {
      form.hidden = true;
      fail('This reset link is invalid or has expired.');
      document.querySelector('#request-link').hidden = false;
    }
  }

  const handlers = {
    async login(data) {
      const email = data.get('email').trim();
      const password = data.get('password');
      need(email && password, 'Enter your email and password.');
      await api('/auth/login', json('POST', { email, password }));
      location.assign('app.html');
    },
    async register(data) {
      const email = data.get('email').trim();
      need(emailPattern.test(email), 'Enter a valid email address.');
      const password = checkPasswords(data);
      await api('/auth/register', json('POST', { email, password, displayName: data.get('displayName').trim() }));
      location.assign('app.html');
    },
    async forgot(data) {
      const email = data.get('email').trim();
      need(emailPattern.test(email), 'Enter a valid email address.');
      const result = await api('/auth/forgot', json('POST', { email }));
      form.hidden = true;
      succeed(result.message);
    },
    async reset(data) {
      const password = checkPasswords(data);
      try {
        await api('/auth/reset', json('POST', { token: resetToken, password }));
      } catch (error) {
        document.querySelector('#request-link').hidden = false;
        throw error;
      }
      form.hidden = true;
      succeed('Your password was changed. Sign in with your new password.');
      document.querySelector('#back-link').textContent = 'Sign in';
    },
  };

  const submit = form.querySelector('[type="submit"]');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    clear();
    submit.disabled = true;
    submit.setAttribute('aria-busy', 'true');
    try {
      await handlers[page](new FormData(form));
    } catch (error) {
      fail(error.message);
    } finally {
      submit.disabled = false;
      submit.removeAttribute('aria-busy');
    }
  });
})();
