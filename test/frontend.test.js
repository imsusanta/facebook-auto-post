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
