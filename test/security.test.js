const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
process.env.NODE_ENV = 'test';
process.env.APP_ORIGIN = 'http://localhost:3000';
process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || '';
process.env.ENABLE_WEBHOOKS = 'true';
process.env.FB_APP_SECRET = 'test-only-webhook-secret';
process.env.FB_VERIFY_TOKEN = 'test-only-verify';
let server,
  base,
  db,
  storage,
  context,
  mailbox = [],
  dataDir;
const ids = [];
const password = 'Long-test-password-2026';
async function request(
  endpoint,
  {
    method = 'GET',
    body,
    cookie,
    csrf,
    origin = process.env.APP_ORIGIN,
    headers = {}
  } = {}
) {
  const h = { Origin: origin, ...headers };
  if (cookie) h.Cookie = cookie;
  if (csrf) h['X-CSRF-Token'] = csrf;
  if (body !== undefined && !(body instanceof FormData)) {
    h['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const r = await fetch(base + endpoint, { method, headers: h, body });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return {
    status: r.status,
    data,
    headers: r.headers,
    cookie: r.headers.get('set-cookie')?.split(';')[0]
  };
}
async function account(label) {
  const email = `${label.toLowerCase()}-${crypto.randomUUID()}@example.test`;
  let r = await request('/api/auth/signup', {
    method: 'POST',
    body: { email, password, name: label }
  });
  assert.equal(r.status, 202);
  const token = mailbox
    .find((m) => m.to === email)
    .text.match(/verify=([a-f\d]{64})/)[1];
  r = await request('/api/auth/verify-email', {
    method: 'POST',
    body: { token }
  });
  assert.equal(r.status, 200);
  r = await request('/api/auth/login', {
    method: 'POST',
    body: { email, password }
  });
  assert.equal(r.status, 200);
  const me = await request('/api/auth/me', { cookie: r.cookie });
  ids.push({ user: me.data.user.id, workspace: me.data.user.workspaceId });
  return {
    email,
    cookie: r.cookie,
    csrf: r.data.csrfToken,
    user: me.data.user.id,
    workspace: me.data.user.workspaceId
  };
}
before(async () => {
  if (
    !process.env.DATABASE_URL ||
    !new URL(process.env.DATABASE_URL).pathname.endsWith('_test')
  )
    throw new Error(
      'TEST_DATABASE_URL must point to a dedicated database ending in _test'
    );
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autopost-test-'));
  process.env.DATA_ROOT = dataDir;
  db = require('../services/db');
  storage = require('../services/storage');
  context = require('../security/context');
  await require('../scripts/migrate')();
  await db.query('DELETE FROM rate_limits');
  require('../services/mail').setTestDelivery((message) =>
    mailbox.push(message)
  );
  // Never make real upstream calls from the test suite.
  const axios = require('axios');
  for (const method of ['get', 'post'])
    axios[method] = async () => {
      throw new Error('External requests blocked by test harness');
    };
  server = require('../server').createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  require('../middleware/sse').closeAll();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (db) {
    for (const item of ids) {
      await db.query('DELETE FROM workspaces WHERE id=$1', [item.workspace]);
      await db.query('DELETE FROM users WHERE id=$1', [item.user]);
    }
    await db.pool.end();
  }
  if (dataDir) await fs.rm(dataDir, { recursive: true, force: true });
});
test('security and database integration', async (t) => {
  let a, b;
  await t.test(
    'private API and uploads reject anonymous requests',
    async () => {
      for (const route of [
        '/api/settings',
        '/api/facebook/pages',
        '/api/queue',
        '/api/events',
        '/uploads/' + crypto.randomUUID() + '.jpg'
      ])
        assert.equal((await request(route)).status, 401);
    }
  );
  await t.test(
    'signup, single-use verification and opaque login sessions',
    async () => {
      a = await account('Alice');
      b = await account('Bob');
      assert.ok(a.cookie.startsWith('autopost_session='));
      const me = await request('/api/auth/me', { cookie: a.cookie });
      assert.equal(me.data.user.role, 'owner');
      const tokens = await db.query(
        'SELECT token_hash FROM sessions WHERE user_id=$1',
        [a.user]
      );
      assert.ok(!tokens.rows.some((r) => a.cookie.includes(r.token_hash)));
      const token = mailbox
        .find((m) => m.to === a.email)
        .text.match(/verify=([a-f\d]{64})/)[1];
      assert.equal(
        (
          await request('/api/auth/verify-email', {
            method: 'POST',
            body: { token }
          })
        ).status,
        400
      );
    }
  );
  await t.test(
    'CSRF and origin checks block authenticated cross-site writes',
    async () => {
      assert.equal(
        (
          await request('/api/settings', {
            method: 'POST',
            body: {},
            cookie: a.cookie
          })
        ).status,
        403
      );
      assert.equal(
        (
          await request('/api/settings', {
            method: 'POST',
            body: {},
            cookie: a.cookie,
            csrf: a.csrf,
            origin: 'https://evil.example'
          })
        ).status,
        403
      );
    }
  );
  await t.test(
    'workspace settings are encrypted and never returned in API JSON',
    async () => {
      await context.run(a.workspace, () =>
        storage.addConnectedPage({
          id: '11111',
          name: 'Page A',
          accessToken: 'SYNTHETIC_SECRET_A',
          setAsActive: true
        })
      );
      await context.run(b.workspace, () =>
        storage.addConnectedPage({
          id: '22222',
          name: 'Page B',
          accessToken: 'SYNTHETIC_SECRET_B',
          setAsActive: true
        })
      );
      await context.run(a.workspace, () =>
        storage.saveSettings({ geminiApiKey: 'SYNTHETIC_AI_KEY' })
      );
      const r = await request('/api/settings', { cookie: a.cookie });
      assert.equal(r.status, 200);
      assert.equal(r.data.hasAccessToken, true);
      assert.equal(r.data.hasGeminiApiKey, true);
      assert.ok(!JSON.stringify(r.data).includes('SYNTHETIC'));
      const { rows } = await db.query(
        'SELECT data FROM facebook_pages WHERE workspace_id=$1',
        [a.workspace]
      );
      assert.ok(!JSON.stringify(rows).includes('SYNTHETIC_SECRET_A'));
      assert.equal(rows[0].data.accessToken.$encrypted, 'v1');
    }
  );
  await t.test('page isolation and immutable resource ownership', async () => {
    const r = await request('/api/facebook/pages', { cookie: b.cookie });
    assert.deepEqual(
      r.data.pages.map((p) => p.id),
      ['22222']
    );
    assert.equal(
      (await request('/api/facebook/pages/11111', { cookie: b.cookie })).status,
      404
    );
    assert.equal(
      (
        await request('/api/facebook/pages/switch', {
          method: 'POST',
          body: { pageId: '11111' },
          cookie: b.cookie,
          csrf: b.csrf
        })
      ).status,
      404
    );
    await assert.rejects(
      context.run(b.workspace, () =>
        storage.addConnectedPage({ id: '11111', accessToken: 'bad' })
      )
    );
  });
  await t.test(
    'viewer cannot mutate; editor cannot manage page credentials',
    async () => {
      await db.query(
        "UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1 AND user_id=$2",
        [a.workspace, a.user]
      );
      assert.equal(
        (
          await request('/api/templates', {
            method: 'POST',
            body: { title: 'no' },
            cookie: a.cookie,
            csrf: a.csrf
          })
        ).status,
        403
      );
      await db.query(
        "UPDATE workspace_members SET role='editor' WHERE workspace_id=$1 AND user_id=$2",
        [a.workspace, a.user]
      );
      assert.equal(
        (
          await request('/api/settings', {
            method: 'POST',
            body: {},
            cookie: a.cookie,
            csrf: a.csrf
          })
        ).status,
        403
      );
      await db.query(
        "UPDATE workspace_members SET role='owner' WHERE workspace_id=$1 AND user_id=$2",
        [a.workspace, a.user]
      );
    }
  );
  await t.test(
    'invalid input and unowned template IDs are rejected',
    async () => {
      assert.equal(
        (
          await request('/api/settings', {
            method: 'POST',
            body: { pages: [] },
            cookie: a.cookie,
            csrf: a.csrf
          })
        ).status,
        400
      );
      assert.equal(
        (
          await request('/api/ai/generate', {
            method: 'POST',
            body: { templateId: 'someone-elses-template' },
            cookie: a.cookie,
            csrf: a.csrf
          })
        ).status,
        404
      );
      assert.equal(
        (
          await request('/api/queue', {
            method: 'POST',
            body: { message: 'test', scheduledAt: 'not-a-date' },
            cookie: a.cookie,
            csrf: a.csrf
          })
        ).status,
        400
      );
    }
  );
  await t.test(
    'owned uploads are decoded/re-encoded and inaccessible to other workspaces',
    async () => {
      const sharp = require('sharp'),
        buffer = await sharp({
          create: { width: 16, height: 16, channels: 3, background: '#334455' }
        })
          .png()
          .toBuffer();
      const form = new FormData();
      form.set(
        'image',
        new Blob([buffer], { type: 'image/png' }),
        'example.png'
      );
      const r = await request('/api/media/upload', {
        method: 'POST',
        body: form,
        cookie: a.cookie,
        csrf: a.csrf
      });
      assert.equal(r.status, 200);
      assert.match(r.data.url, /^\/uploads\/.*\.jpg$/);
      const own = await request(r.data.url, { cookie: a.cookie });
      assert.equal(own.status, 200);
      assert.equal(own.headers.get('content-type'), 'image/jpeg');
      assert.equal(
        (await request(r.data.url, { cookie: b.cookie })).status,
        400
      );
      const fake = new FormData();
      fake.set(
        'image',
        new Blob(['<script>alert(1)</script>'], { type: 'image/png' }),
        'fake.png'
      );
      assert.equal(
        (
          await request('/api/media/upload', {
            method: 'POST',
            body: fake,
            cookie: a.cookie,
            csrf: a.csrf
          })
        ).status,
        400
      );
    }
  );
  await t.test(
    'SSRF, traversal and local-path image reads fail closed',
    async () => {
      const media = require('../security/media');
      for (const ip of [
        '127.0.0.1',
        '10.0.0.1',
        '169.254.169.254',
        '::1',
        '::ffff:127.0.0.1'
      ])
        assert.equal(media.publicAddress(ip), false);
      await context.run(a.workspace, async () => {
        for (const ref of [
          '/etc/passwd',
          '/uploads/../../.env',
          'http://127.0.0.1/',
          'https://127.0.0.1/',
          'https://user:pass@example.com/a.jpg'
        ])
          await assert.rejects(media.load(ref));
      });
    }
  );
  await t.test(
    'concurrent writes preserve records and queue jobs bind their page',
    async () => {
      const jobs = await context.run(a.workspace, () =>
        Promise.all(
          Array.from({ length: 8 }, (_, i) =>
            storage.addToQueue({ message: 'job ' + i })
          )
        )
      );
      await context.run(a.workspace, () =>
        storage.addConnectedPage({
          id: '33333',
          name: 'Page A2',
          accessToken: 'SYNTHETIC_A2',
          setAsActive: true
        })
      );
      assert.ok(jobs.every((j) => j.facebookPageId === '11111'));
      assert.equal(
        (await context.run(a.workspace, () => storage.getQueue())).length,
        8
      );
      const claims = await context.run(a.workspace, () =>
        Promise.all([
          storage.claimQueueItem(jobs[0].id),
          storage.claimQueueItem(jobs[0].id)
        ])
      );
      assert.equal(claims.filter(Boolean).length, 1);
    }
  );
  await t.test(
    'queue publish-now uses bound page and no missing-method error',
    async () => {
      const fb = require('../services/facebook'),
        original = fb.publishPost;
      let target;
      fb.publishPost = async () => {
        target = (await storage.getSettings()).pageId;
        return { success: true, postId: 'mock-only' };
      };
      try {
        const job = (
          await context.run(a.workspace, () => storage.getQueue())
        ).find((j) => j.status === 'pending');
        const r = await request('/api/queue/' + job.id + '/publish-now', {
          method: 'POST',
          body: {},
          cookie: a.cookie,
          csrf: a.csrf
        });
        assert.equal(r.status, 200);
        assert.equal(target, '11111');
      } finally {
        fb.publishPost = original;
      }
    }
  );
  await t.test(
    'unsigned/tampered webhooks reject; signed duplicates persist only once',
    async () => {
      const body = {
        object: 'page',
        entry: [
          {
            id: '11111',
            messaging: [
              {
                sender: { id: '999' },
                message: {
                  mid: 'test-mid-' + crypto.randomUUID(),
                  text: 'hello'
                }
              }
            ]
          }
        ]
      };
      assert.equal(
        (await request('/api/webhook/facebook', { method: 'POST', body }))
          .status,
        403
      );
      const signature =
        'sha256=' +
        crypto
          .createHmac('sha256', process.env.FB_APP_SECRET)
          .update(JSON.stringify(body))
          .digest('hex');
      assert.equal(
        (
          await request('/api/webhook/facebook', {
            method: 'POST',
            body,
            headers: { 'X-Hub-Signature-256': signature }
          })
        ).status,
        200
      );
      assert.equal(
        (
          await request('/api/webhook/facebook', {
            method: 'POST',
            body,
            headers: { 'X-Hub-Signature-256': signature }
          })
        ).status,
        200
      );
      const count = await db.query(
        'SELECT count(*)::int AS n FROM webhook_events WHERE workspace_id=$1',
        [a.workspace]
      );
      assert.equal(count.rows[0].n, 1);
    }
  );
  await t.test('SSE events are scoped and redact secrets', async () => {
    const controller = new AbortController();
    const r = await fetch(base + '/api/events', {
      headers: { Cookie: a.cookie },
      signal: controller.signal
    });
    assert.equal(r.status, 200);
    const reader = r.body.getReader();
    await reader.read();
    await context.run(b.workspace, () =>
      require('../middleware/sse').broadcastSSE('settings_updated', {
        marker: 'OTHER_WORKSPACE',
        accessToken: 'OTHER_SECRET'
      })
    );
    await context.run(a.workspace, () =>
      require('../middleware/sse').broadcastSSE('settings_updated', {
        marker: 'OWN_WORKSPACE',
        accessToken: 'OWN_SECRET'
      })
    );
    const event = new TextDecoder().decode((await reader.read()).value);
    assert.ok(event.includes('OWN_WORKSPACE'));
    assert.ok(!event.includes('OTHER_WORKSPACE'));
    assert.ok(!event.includes('OWN_SECRET'));
    controller.abort();
  });
  await t.test(
    'authenticated dashboard scripts load with the new API contracts',
    async () => {
      const { JSDOM, CookieJar, VirtualConsole } = require('jsdom');
      const jar = new CookieJar();
      jar.setCookieSync(a.cookie, base);
      const errors = [];
      const console = new VirtualConsole();
      console.on('jsdomError', (error) => {
        if (error.type !== 'css parsing') errors.push(error.message);
      }); // jsdom does not implement all compiled Tailwind CSS syntax.
      const dom = await JSDOM.fromURL(base + '/index.html', {
        cookieJar: jar,
        resources: 'usable',
        runScripts: 'dangerously',
        virtualConsole: console,
        beforeParse(window) {
          window.fetch = (url, options = {}) =>
            fetch(new URL(url, base), {
              ...options,
              headers: {
                Origin: process.env.APP_ORIGIN,
                Cookie: a.cookie,
                ...Object.fromEntries(new Headers(options.headers || {}))
              }
            });
          window.Headers = Headers;
          window.EventSource = class {
            addEventListener() {}
            close() {}
          };
          window.confirm = () => false;
          window.alert = () => {};
        }
      });
      try {
        await new Promise((resolve) =>
          dom.window.addEventListener('load', resolve)
        );
        await dom.window.authReady;
        await new Promise((resolve) => setTimeout(resolve, 150));
        assert.deepEqual(errors, []);
        assert.ok(dom.window.document.body.textContent.includes('Sign out'));
      } finally {
        dom.window.close();
      }
    }
  );
  await t.test(
    'request limits work across database-backed counters',
    async () => {
      for (let i = 0; i < 20; i++)
        await request('/api/ai/generate', {
          method: 'POST',
          body: { templateId: 'missing' },
          cookie: b.cookie,
          csrf: b.csrf
        });
      assert.equal(
        (
          await request('/api/ai/generate', {
            method: 'POST',
            body: { templateId: 'missing' },
            cookie: b.cookie,
            csrf: b.csrf
          })
        ).status,
        429
      );
    }
  );
  await t.test(
    'owner-managed membership and session switching enforce workspace access',
    async () => {
      await db.query('DELETE FROM rate_limits');
      let r = await request('/api/auth/switch-workspace', {
        method: 'POST',
        body: { workspaceId: a.workspace },
        cookie: b.cookie,
        csrf: b.csrf
      });
      assert.equal(r.status, 403);
      r = await request('/api/workspace/members', {
        method: 'POST',
        body: { email: b.email, role: 'viewer' },
        cookie: a.cookie,
        csrf: a.csrf
      });
      assert.equal(r.status, 200);
      r = await request('/api/auth/switch-workspace', {
        method: 'POST',
        body: { workspaceId: a.workspace },
        cookie: b.cookie,
        csrf: b.csrf
      });
      assert.equal(r.status, 200);
      b.cookie = r.cookie;
      b.csrf = r.data.csrfToken;
      assert.equal(
        (
          await request('/api/settings', {
            method: 'POST',
            body: {},
            cookie: b.cookie,
            csrf: b.csrf
          })
        ).status,
        403
      );
      r = await request('/api/workspace/members/' + b.user, {
        method: 'DELETE',
        body: {},
        cookie: a.cookie,
        csrf: a.csrf
      });
      assert.equal(r.status, 200);
      assert.equal(
        (await request('/api/auth/me', { cookie: b.cookie })).status,
        401
      );
      r = await request('/api/auth/login', {
        method: 'POST',
        body: { email: b.email, password }
      });
      b.cookie = r.cookie;
      b.csrf = r.data.csrfToken;
    }
  );
  await t.test(
    'password reset is single-use and revokes existing sessions',
    async () => {
      await db.query('DELETE FROM rate_limits');
      let r = await request('/api/auth/forgot-password', {
        method: 'POST',
        body: { email: b.email }
      });
      assert.equal(r.status, 202);
      const token = mailbox
        .filter((m) => m.to === b.email)
        .at(-1)
        .text.match(/reset=([a-f\d]{64})/)[1];
      const payload = { token, password: 'Another-long-password-2026' };
      r = await request('/api/auth/reset-password', {
        method: 'POST',
        body: payload
      });
      assert.equal(r.status, 200);
      assert.equal(
        (await request('/api/auth/me', { cookie: b.cookie })).status,
        401
      );
      assert.equal(
        (
          await request('/api/auth/reset-password', {
            method: 'POST',
            body: payload
          })
        ).status,
        400
      );
    }
  );
  await t.test('expired verification tokens cannot be consumed', async () => {
    const token = require('../security/auth').random();
    await db.query("INSERT INTO auth_tokens(token_hash,user_id,purpose,expires_at) VALUES($1,$2,'verify',now()-interval '1 second')", [require('../security/auth').hash(token), a.user]);
    assert.equal((await request('/api/auth/verify-email', {method:'POST',body:{token}})).status,400);
  });
  await t.test('media quota is enforced before persisting a new image', async () => {
    const buffer=await require('sharp')({create:{width:10,height:10,channels:3,background:'#ffffff'}}).png().toBuffer();
    process.env.MAX_WORKSPACE_MEDIA_BYTES='1';
    try {await assert.rejects(context.run(a.workspace,()=>require('../security/media').store(buffer)),/media limit/);}finally{delete process.env.MAX_WORKSPACE_MEDIA_BYTES;}
  });
  await t.test('explicit legacy importer preserves ownership and disables automation', async () => {
    await db.query('DELETE FROM rate_limits');
    const c=await account('LegacyOwner'),root=path.join(dataDir,'legacy-fixture');
    await fs.mkdir(path.join(root,'data'),{recursive:true});
    await fs.writeFile(path.join(root,'data/settings.json'),JSON.stringify({pageId:'44444',pageName:'Legacy page',accessToken:'LEGACY_SYNTHETIC',geminiApiKey:'LEGACY_AI_SYNTHETIC',autoPostEnabled:true}));
    await fs.writeFile(path.join(root,'data/queue.json'),JSON.stringify([{message:'Imported queued post',status:'pending'}]));
    const argv=process.argv;process.argv=['node','import',root,c.workspace,c.email,'44444'];
    try {await require('../scripts/import-legacy')();}finally{process.argv=argv;}
    const settings=await context.run(c.workspace,()=>storage.getSettings());assert.equal(settings.autoPostEnabled,false);assert.equal(settings.accessToken,'LEGACY_SYNTHETIC');
    const queue=await context.run(c.workspace,()=>storage.getQueue());assert.equal(queue.length,1);assert.equal(queue[0].facebookPageId,'44444');
    const encrypted=await db.query('SELECT data FROM facebook_pages WHERE workspace_id=$1',[c.workspace]);assert.ok(!JSON.stringify(encrypted.rows).includes('LEGACY_SYNTHETIC'));
  });
  await t.test('logout revokes the server session', async () => {
    const r = await request('/api/auth/logout', {
      method: 'POST',
      body: {},
      cookie: a.cookie,
      csrf: a.csrf
    });
    assert.equal(r.status, 200);
    assert.equal(
      (await request('/api/settings', { cookie: a.cookie })).status,
      401
    );
  });
});
