/* Stable per-tab operation keys survive network retries. No credential storage. */
(() => {
  const memory = new Map();
  async function key(endpoint, body) {
    const user = await window.authReady;
    const entries =
      body instanceof FormData
        ? await Promise.all(
            [...body.entries()].map(async ([name, value]) => {
              if (value instanceof Blob)
                value = [
                  ...new Uint8Array(
                    await crypto.subtle.digest(
                      'SHA-256',
                      await value.arrayBuffer()
                    )
                  )
                ]
                  .map((n) => n.toString(16).padStart(2, '0'))
                  .join('');
              return [name, value];
            })
          )
        : body;
    const bytes = new TextEncoder().encode(
      JSON.stringify([user?.workspaceId, endpoint, entries])
    );
    const digest = [
      ...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
    ]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('');
    const slot = 'publication:' + digest;
    let value = memory.get(slot);
    try {
      value = sessionStorage.getItem(slot) || value;
    } catch {
      /* private browser storage may be disabled */
    }
    let done = false;
    try {
      done = sessionStorage.getItem('publication-done:' + value) === 'true';
    } catch {
      done = memory.get('done:' + value);
    }
    if (
      value &&
      done &&
      confirm(
        'This operation was already accepted. Create a NEW publication? Cancel reuses the existing operation without posting again.'
      )
    )
      value = null;
    if (!value) {
      value = crypto.randomUUID();
      memory.set(slot, value);
      try {
        sessionStorage.setItem(slot, value);
      } catch {
        /* keep in memory */
      }
    }
    return value;
  }
  function settled(key, result) {
    if (result.published === true || result.accepted === true) {
      memory.set('done:' + key, true);
      try {
        sessionStorage.setItem('publication-done:' + key, 'true');
      } catch {
        /* in-memory fallback */
      }
    }
  }
  function message(result) {
    if (result.published === true)
      return `Published to Facebook. Post ID: ${result.postId}`;
    if (result.item?.status === 'needs_review')
      return 'Delivery uncertain. Check this Facebook Page before creating another post. Automatic retry is blocked to prevent duplicates.';
    if (result.success && result.published === false)
      return `Saved, NOT yet published (${result.item?.status || 'queued'}). Check the queue for the final result.`;
    return (
      'Not published: ' +
      (result.error || result.item?.error || 'Check the queue and settings.')
    );
  }
  function date(value, zone = 'UTC') {
    return value
      ? new Intl.DateTimeFormat(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: zone
        }).format(new Date(value)) +
          ' (' +
          zone +
          ')'
      : 'Ready when queue is enabled';
  }
  window.publicationUI = { key, settled, message, date };
})();
