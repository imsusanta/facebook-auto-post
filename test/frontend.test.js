const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
test('dynamic HTML uses sanitizer and inline scripts are blocked', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../public/app.js'),
    'utf8'
  );
  assert.ok(!/\.innerHTML\s*=/.test(source));
  const html = fs.readFileSync(
    path.join(__dirname, '../public/index.html'),
    'utf8'
  );
  assert.ok(!/\son(click|error|load)=/.test(html));
  assert.ok(!/<script>/.test(html));
  const window = new JSDOM('').window;
  const clean = require('dompurify')(window).sanitize(
    '<img src=x onerror=alert(1)><svg onload=alert(1)></svg><script>alert(1)</script>',
    { USE_PROFILES: { html: true, svg: true } }
  );
  assert.ok(!/onerror|onload|<script/.test(clean));
  window.close();
});

test('client operation keys survive retries, are tenant-scoped and require confirmation for repeats', async () => {
  const dom = new JSDOM('', {
      url: 'https://app.example.test',
      runScripts: 'outside-only'
    }),
    w = dom.window;
  Object.defineProperty(w, 'crypto', {
    value: require('node:crypto').webcrypto
  });
  w.TextEncoder = TextEncoder;
  w.authReady = Promise.resolve({ workspaceId: 'tenant-a' });
  w.confirm = () => false;
  w.eval(
    fs.readFileSync(path.join(__dirname, '../public/publishing-ui.js'), 'utf8')
  );
  const key = await w.publicationUI.key('/api/post', { message: 'same' });
  assert.equal(
    await w.publicationUI.key('/api/post', { message: 'same' }),
    key
  );
  w.publicationUI.settled(key, { published: false });
  assert.equal(
    await w.publicationUI.key('/api/post', { message: 'same' }),
    key
  );
  w.publicationUI.settled(key, { published: true });
  assert.equal(
    await w.publicationUI.key('/api/post', { message: 'same' }),
    key
  );
  w.confirm = () => true;
  assert.notEqual(
    await w.publicationUI.key('/api/post', { message: 'same' }),
    key
  );
  w.authReady = Promise.resolve({ workspaceId: 'tenant-b' });
  assert.notEqual(
    await w.publicationUI.key('/api/post', { message: 'same' }),
    key
  );
  assert.match(
    w.publicationUI.message({
      success: true,
      published: false,
      item: { status: 'retry_wait' }
    }),
    /NOT yet published/
  );
  assert.match(
    w.publicationUI.message({ item: { status: 'needs_review' } }),
    /Delivery uncertain/
  );
  w.close();
});
