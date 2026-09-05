'use strict';
// Every dynamic HTML insertion goes through the locally served, pinned DOMPurify package.
window.setSafeHTML = (element, html) => {
  element.innerHTML = DOMPurify.sanitize(String(html), {
    USE_PROFILES: { html: true, svg: true },
    FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'foreignObject'],
    FORBID_ATTR: ['style', 'srcdoc']
  });
};
const nativeFetch = window.fetch.bind(window);
let csrfToken = '';
window.authReady = nativeFetch('/api/auth/me').then(async (response) => {
  if (!response.ok) {
    location.replace('/auth.html');
    throw new Error('Authentication required');
  }
  const session = await response.json();
  csrfToken = session.csrfToken;
  return session.user;
});
window.fetch = async (input, options = {}) => {
  const url = new URL(
    typeof input === 'string' ? input : input.url,
    location.origin
  );
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
    await window.authReady;
    const headers = new Headers(options.headers || {});
    if (!['GET', 'HEAD'].includes((options.method || 'GET').toUpperCase()))
      headers.set('X-CSRF-Token', csrfToken);
    options = { ...options, headers };
  }
  const response = await nativeFetch(input, options);
  if (response.status === 401 && url.origin === location.origin)
    location.replace('/auth.html');
  return response;
};
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const user = await window.authReady;
    const bar = document.createElement('div');
    bar.className =
      'fixed bottom-3 left-3 z-50 flex gap-2 items-center rounded-lg bg-white border p-2 text-xs';
    const label = document.createElement('span');
    label.textContent = `${user.name} · ${user.role}`;
    const logout = document.createElement('button');
    logout.textContent = 'Sign out';
    logout.className = 'text-indigo-600 font-semibold';
    logout.addEventListener('click', async () => {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      location.replace('/auth.html');
    });
    bar.append(label, logout);
    document.body.append(bar);
    const memberships = await fetch('/api/auth/workspaces').then((r) =>
      r.json()
    );
    if (memberships.workspaces?.length > 1) {
      const select = document.createElement('select');
      select.setAttribute('aria-label', 'Workspace');
      for (const workspace of memberships.workspaces) {
        const option = document.createElement('option');
        option.value = workspace.id;
        option.textContent = workspace.name;
        option.selected = workspace.id === user.workspaceId;
        select.append(option);
      }
      select.addEventListener('change', async () => {
        const response = await fetch('/api/auth/switch-workspace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspaceId: select.value })
        });
        if (response.ok) location.reload();
      });
      bar.prepend(select);
    }
    document
      .getElementById('scheduleComposerShortcut')
      ?.addEventListener('click', () =>
        document.getElementById('openComposerBtn')?.click()
      );
  } catch {
    /* Redirect already in progress. */
  }
});
