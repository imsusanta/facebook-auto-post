'use strict';
const $ = (id) => document.getElementById(id);
let mode = 'login',
  token = '';
const titles = {
  login: 'Sign in',
  signup: 'Create account',
  'forgot-password': 'Request password reset',
  'resend-verification': 'Resend verification',
  'reset-password': 'Set new password',
  'verify-email': 'Verify email'
};
function choose(next) {
  mode = next;
  $('formTitle').textContent = titles[mode];
  $('submit').textContent = titles[mode];
  $('nameLabel').hidden = mode !== 'signup';
  $('name').required = mode === 'signup';
  $('emailLabel').hidden = ['reset-password', 'verify-email'].includes(mode);
  $('email').required = !$('emailLabel').hidden;
  $('passwordLabel').hidden = !['login', 'signup', 'reset-password'].includes(
    mode
  );
  $('password').required = !$('passwordLabel').hidden;
  $('password').autocomplete =
    mode === 'login' ? 'current-password' : 'new-password';
  $('password').value = '';
  $('message').textContent = '';
}
document
  .querySelectorAll('[data-mode]')
  .forEach((button) =>
    button.addEventListener('click', () => choose(button.dataset.mode))
  );
$('accountForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('submit').disabled = true;
  try {
    const body = {};
    if (!$('emailLabel').hidden) body.email = $('email').value;
    if (!$('passwordLabel').hidden) body.password = $('password').value;
    if (mode === 'signup') body.name = $('name').value;
    if (token && ['reset-password', 'verify-email'].includes(mode))
      body.token = token;
    const response = await fetch('/api/auth/' + mode, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    $('message').textContent =
      data.error || data.message || (data.success ? 'Done' : 'Request failed');
    if (response.ok && mode === 'login') location.replace('/');
    if (response.ok && ['reset-password', 'verify-email'].includes(mode)) {
      token = '';
      choose('login');
      $('message').textContent = data.message;
    }
  } catch {
    $('message').textContent = 'Unable to connect. Please try again.';
  } finally {
    $('submit').disabled = false;
  }
});
const fragment = new URLSearchParams(location.hash.slice(1));
if (fragment.has('verify') || fragment.has('reset')) {
  token = fragment.get('verify') || fragment.get('reset');
  choose(fragment.has('verify') ? 'verify-email' : 'reset-password');
  history.replaceState(null, '', '/auth.html');
}
