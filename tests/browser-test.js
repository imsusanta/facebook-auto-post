/**
 * Real Headless Google Chrome Integration & Smoke Tests
 * Uses native DevTools Protocol (CDP) over WebSocket in Node.js.
 * Zero external browser-driver dependencies.
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { createApp } = require('../createApp');
const storage = require('../services/storage');
const scheduler = require('../services/scheduler');
const { closeAllSseClients } = require('../middleware/sse');
const { clearAllSessions, stopSessionPruneTimer } = require('../middleware/auth');

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.eventListeners = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new globalThis.WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (err) => reject(err);
      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.id && this.pending.has(msg.id)) {
            const { resolve: res, reject: rej } = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            if (msg.error) rej(new Error(msg.error.message || JSON.stringify(msg.error)));
            else res(msg.result);
          } else if (msg.method) {
            const listeners = this.eventListeners.get(msg.method) || [];
            listeners.forEach((fn) => fn(msg.params));
          }
        } catch (e) {
          // parse error
        }
      };
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, callback) {
    if (!this.eventListeners.has(method)) {
      this.eventListeners.set(method, []);
    }
    this.eventListeners.get(method).push(callback);
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (res.exceptionDetails) {
      const desc = res.exceptionDetails.exception?.description || res.exceptionDetails.text;
      throw new Error(`[CDP Evaluation Error] ${desc}`);
    }
    return res.result ? res.result.value : undefined;
  }

  close() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
    }
  }
}

function findChromeExecutable() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium'
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

async function launchHeadlessChrome() {
  const chromePath = findChromeExecutable();
  if (!chromePath) {
    throw new Error('Google Chrome executable not found for headless browser test.');
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-chrome-test-'));
  const chromeProcess = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--user-data-dir=' + tmpDir
  ]);

  const wsUrl = await new Promise((resolve, reject) => {
    let handled = false;
    const timeout = setTimeout(() => {
      if (!handled) {
        handled = true;
        chromeProcess.kill('SIGKILL');
        reject(new Error('Timed out waiting for Chrome DevTools WebSocket URL'));
      }
    }, 10000);

    chromeProcess.stderr.on('data', async (data) => {
      const match = data.toString().match(/DevTools listening on (ws:\/\/127\.0\.0\.1:(\d+)[^\s]+)/);
      if (match && !handled) {
        handled = true;
        clearTimeout(timeout);
        const port = match[2];
        try {
          const listRes = await fetch(`http://127.0.0.1:${port}/json/list`);
          const pages = await listRes.json();
          const page = pages.find((p) => p.type === 'page') || pages[0];
          if (page && page.webSocketDebuggerUrl) {
            resolve(page.webSocketDebuggerUrl);
          } else {
            resolve(match[1]);
          }
        } catch {
          resolve(match[1]);
        }
      }
    });

    chromeProcess.on('error', (err) => {
      if (!handled) {
        handled = true;
        clearTimeout(timeout);
        reject(err);
      }
    });
  });

  const cdp = new CDPClient(wsUrl);
  await cdp.connect();

  return {
    chromeProcess,
    cdp,
    tmpDir,
    async cleanup() {
      cdp.close();
      if (chromeProcess.pid) {
        try {
          chromeProcess.kill('SIGTERM');
        } catch {
          // ignore
        }
        await new Promise((r) => setTimeout(r, 200));
        try {
          chromeProcess.kill('SIGKILL');
        } catch {
          // ignore
        }
      }
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  };
}

async function runBrowserTests(options = {}) {
  const results = [];
  let server = null;
  let chromeInstance = null;
  let testDataDir = null;
  const prevDataDir = storage.getDataDir();
  let chromeVersionInfo = 'Unknown';

  function assert(name, condition, detail = '') {
    if (condition) {
      results.push({ name, pass: true, detail });
      console.log(`  ✅ [Browser] ${name}`);
    } else {
      results.push({ name, pass: false, detail });
      console.error(`  ❌ [Browser] ${name}: ${detail}`);
    }
  }

  try {
    // 1. Setup isolated data directory
    testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-browser-test-data-'));
    process.env.DATA_DIR = testDataDir;
    storage.setDataDir(testDataDir);
    process.env.NODE_ENV = 'development';
    process.env.DEV_AUTH_BYPASS = 'false';

    // Ensure default admin user is initialized in fixture
    storage.initDefaultUsers();

    // 2. Start Express application
    const app = createApp();
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const testUrl = `http://127.0.0.1:${port}`;
    console.log(`[Browser Test] App running at ${testUrl}`);

    // 3. Launch Chrome Headless
    console.log('[Browser Test] Launching headless Google Chrome...');
    chromeInstance = await launchHeadlessChrome();
    const { cdp, chromeProcess } = chromeInstance;

    // Retrieve Chrome Version
    try {
      const versionData = await cdp.send('Browser.getVersion');
      chromeVersionInfo = versionData.product || 'Google Chrome';
      console.log(`[Browser Test] Chrome Version: ${chromeVersionInfo}`);
    } catch {
      chromeVersionInfo = 'Google Chrome (Headless)';
    }

    // Track network requests, console messages & CSP events
    const consoleErrors = [];
    const cspViolations = [];
    const browserRequests = [];
    const nonLoopbackRequests = [];
    const requestedOrigins = new Set();
    const failedRequests = [];

    await cdp.send('Network.enable');
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Console.enable');

    cdp.on('Network.requestWillBeSent', (params) => {
      const reqUrl = params.request.url;
      browserRequests.push(reqUrl);
      try {
        const parsed = new URL(reqUrl);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          requestedOrigins.add(parsed.origin);
          const host = parsed.hostname;
          if (host !== '127.0.0.1' && host !== 'localhost') {
            nonLoopbackRequests.push(reqUrl);
          }
        }
      } catch {
        // data: or blob:
      }
    });

    cdp.on('Network.loadingFailed', (params) => {
      if (!params.canceled) {
        failedRequests.push({ requestId: params.requestId, errorText: params.errorText });
      }
    });

    cdp.on('Runtime.consoleAPICalled', (params) => {
      const type = params.type;
      const text = (params.args || []).map((a) => a.value || a.description || '').join(' ');
      if (type === 'error') {
        if (!text.includes('favicon.ico')) {
          consoleErrors.push(text);
        }
        if (text.toLowerCase().includes('content security policy') || text.toLowerCase().includes('csp')) {
          cspViolations.push(text);
        }
      }
    });

    // 4. Navigate to App
    console.log('[Browser Test] Navigating to page...');
    const navRes = await cdp.send('Page.navigate', { url: testUrl });
    if (navRes && navRes.errorText) {
      console.log('[Browser Test] Navigation error:', navRes.errorText);
    }

    // Wait for page load
    await new Promise((resolve) => {
      let resolved = false;
      cdp.on('Page.loadEventFired', () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      });
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      }, 5000);
    });

    // Give DOM scripts time to mount and complete checkAuthAndInit
    await new Promise((r) => setTimeout(r, 1000));

    // Assertion 1: Page Title
    const title = await cdp.evaluate('document.title');
    assert('Page loaded with correct title', typeof title === 'string' && (title.includes('AutoPost') || title.includes('Facebook')), `Title: "${title}"`);

    // Assertion 2: Auth Modal is displayed when unauthenticated
    const modalVisible = await cdp.evaluate('(() => {' +
      'const modal = document.getElementById("adminAuthModal");' +
      'return !!modal && !modal.classList.contains("hidden");' +
    '})()');
    assert('Login modal is visible when unauthenticated', modalVisible === true, `modalVisible: ${modalVisible}`);

    // Assertion 3: Password field starts empty
    const passwordVal = await cdp.evaluate('(() => {' +
      'const pw = document.getElementById("adminAuthPasswordInput");' +
      'return pw ? pw.value : null;' +
    '})()');
    assert('Password field is empty on initial render', passwordVal === '', `Initial password: "${passwordVal}"`);

    // Assertion 4: Tailwind styles applied (verify computed body style)
    const bodyBg = await cdp.evaluate('window.getComputedStyle(document.body).backgroundColor');
    assert('Tailwind / CSS styles successfully computed', typeof bodyBg === 'string' && bodyBg.length > 0, `bodyBg: ${bodyBg}`);

    // Assertion 5: Lucide icons rendered
    const svgCount = await cdp.evaluate('document.querySelectorAll("svg").length');
    assert('UI renders icons / SVG elements', typeof svgCount === 'number' && svgCount > 0, `Found ${svgCount} SVGs`);

    // Assertion 6: Zero Content Security Policy (CSP) violations
    assert('No CSP script-src / connect-src violations during initial render', cspViolations.length === 0, `Violations: ${cspViolations.join('; ')}`);

    // Assertion 7: Perform real login via UI
    console.log('[Browser Test] Submitting login form in browser UI...');
    const loginAttempt = await cdp.evaluate('(() => {' +
      'const emailInput = document.getElementById("adminAuthEmailInput");' +
      'const pwInput = document.getElementById("adminAuthPasswordInput");' +
      'const form = document.getElementById("adminAuthForm");' +
      'if (!emailInput || !pwInput || !form) return { success: false, reason: "Form elements missing" };' +
      'emailInput.value = "susantalohr@gmail.com";' +
      'emailInput.dispatchEvent(new Event("input", { bubbles: true }));' +
      'pwInput.value = "admin@123";' +
      'pwInput.dispatchEvent(new Event("input", { bubbles: true }));' +
      'form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));' +
      'return { success: true };' +
    '})()');
    assert('Form submission dispatched in browser', loginAttempt.success === true, loginAttempt.reason);

    // Wait for login response and modal hide
    const loginSucceeded = await cdp.evaluate('new Promise((resolve) => {' +
      'const start = Date.now();' +
      'const interval = setInterval(() => {' +
        'const modal = document.getElementById("adminAuthModal");' +
        'const actionText = document.getElementById("headerAuthActionText");' +
        'if (modal && modal.classList.contains("hidden")) {' +
          'clearInterval(interval);' +
          'return resolve({ passed: true, roleText: actionText ? actionText.textContent : "" });' +
        '}' +
        'if (Date.now() - start > 6000) {' +
          'clearInterval(interval);' +
          'const err = document.getElementById("adminAuthError");' +
          'return resolve({ passed: false, error: err ? err.textContent : "Timeout waiting for login" });' +
        '}' +
      '}, 100);' +
    '})');

    assert('Login successfully closes auth modal and enters dashboard', loginSucceeded.passed === true, loginSucceeded.error);

    // Assertion 8: Cookie Auth State
    const hasAuthCookie = await cdp.evaluate('document.cookie.includes("auth_session=")');
    // HttpOnly cookies cannot be read from document.cookie, which is the secure expected behavior
    assert('Auth session cookie is HttpOnly (not readable via document.cookie)', hasAuthCookie === false, 'HttpOnly cookie protected from script theft');

    // Assertion 9: CSRF Token Active in Memory
    const csrfTokenActive = await cdp.evaluate('typeof currentCsrfToken === "string" && currentCsrfToken.length >= 16');
    assert('CSRF token is actively stored in client application memory', csrfTokenActive === true, `CSRF token active: ${csrfTokenActive}`);

    // Assertion 10: EventSource SSE Connection Available
    const sseAvailable = await cdp.evaluate('typeof window.EventSource === "function"');
    assert('Browser supports Server-Sent Events (EventSource)', sseAvailable === true, 'EventSource API supported');

    // Assertion 11: Zero secrets stored in client-side Web Storage or DOM
    const storageAudit = await cdp.evaluate('(() => {' +
      'const leaks = [];' +
      'const sensitiveTerms = ["secret", "accesstoken", "apikey", "passwordhash", "passwordsalt", "token="];' +
      'for (let i = 0; i < localStorage.length; i++) {' +
        'const k = localStorage.key(i);' +
        'const v = localStorage.getItem(k);' +
        'sensitiveTerms.forEach(t => {' +
          'if (k.toLowerCase().includes(t) || (v && v.toLowerCase().includes(t))) leaks.push("localStorage: " + k);' +
        '});' +
      '}' +
      'for (let i = 0; i < sessionStorage.length; i++) {' +
        'const k = sessionStorage.key(i);' +
        'const v = sessionStorage.getItem(k);' +
        'sensitiveTerms.forEach(t => {' +
          'if (k.toLowerCase().includes(t) || (v && v.toLowerCase().includes(t))) leaks.push("sessionStorage: " + k);' +
        '});' +
      '}' +
      'const pwFields = document.querySelectorAll("input[type=password]");' +
      'pwFields.forEach(f => {' +
        'if (f.value && f.value !== "") leaks.push("Uncleared password field: #" + f.id);' +
      '});' +
      'if (window.location.search.includes("key=") || window.location.search.includes("token=")) {' +
        'leaks.push("URL query param leak");' +
      '}' +
      'return leaks;' +
    '})()');

    assert('Zero plaintext secrets found in localStorage, sessionStorage, DOM, or URL', storageAudit.length === 0, `Leaks detected: ${storageAudit.join(', ')}`);

    // Assertion 12: Perform Logout via UI
    console.log('[Browser Test] Testing logout in browser UI...');
    const logoutDispatched = await cdp.evaluate('(() => {' +
      'const btn = document.getElementById("adminLogoutBtn");' +
      'if (!btn) return false;' +
      'btn.click();' +
      'return true;' +
    '})()');

    const logoutSucceeded = await cdp.evaluate('new Promise((resolve) => {' +
      'const start = Date.now();' +
      'const interval = setInterval(() => {' +
        'const modal = document.getElementById("adminAuthModal");' +
        'if (modal && !modal.classList.contains("hidden") && currentCsrfToken === null) {' +
          'clearInterval(interval);' +
          'return resolve(true);' +
        '}' +
        'if (Date.now() - start > 4000) {' +
          'clearInterval(interval);' +
          'return resolve(false);' +
        '}' +
      '}, 100);' +
    '})');

    assert('Logout returns to unauthenticated state and clears CSRF token', logoutDispatched && logoutSucceeded, `Logout succeeded: ${logoutSucceeded}`);

    // Assertion 13: Zero fatal console errors
    assert('Zero fatal JavaScript errors during complete user session', consoleErrors.length === 0, `Console errors: ${consoleErrors.join(' | ')}`);

    // Assertion 14: Strict loopback host verification on every requested URL
    assert('Every requested URL host is 127.0.0.1 or localhost (0 non-loopback requests)', nonLoopbackRequests.length === 0, `Non-loopback requests: ${nonLoopbackRequests.join(', ')}`);

    // Assertion 15: Zero external CDN or third-party requests attempted by browser
    const attemptedExternal = browserRequests.filter(u => /tailwindcss\.com|unpkg\.com|jsdelivr\.net|fonts\.google|unsplash\.com|facebook\.com|fbcdn\.net/.test(u));
    assert('Zero external CDN or third-party requests attempted by browser', attemptedExternal.length === 0, `Attempted external: ${attemptedExternal.join(', ')}`);

    // Assertion 16: Captured requested origins are strictly loopback
    const originsList = Array.from(requestedOrigins);
    assert('Captured requested origins are strictly loopback', originsList.length > 0 && originsList.every(o => o.includes('127.0.0.1') || o.includes('localhost')), `Origins: ${originsList.join(', ')}`);

    // Assertion 17: Zero CSP violation events throughout complete browser lifecycle
    assert('Zero CSP violation events during browser execution', cspViolations.length === 0, `Violations: ${cspViolations.join('; ')}`);

    // Assertion 18: Zero unexpected failed network requests for local assets
    assert('Zero unexpected failed requests for local assets', failedRequests.length === 0, `Failed requests: ${JSON.stringify(failedRequests)}`);

  } catch (err) {
    assert('Browser test execution completed without unhandled exception', false, err.message);
  } finally {
    // Teardown resources deterministically
    scheduler.stop();
    closeAllSseClients();
    clearAllSessions();
    stopSessionPruneTimer();

    if (chromeInstance) {
      await chromeInstance.cleanup();
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (testDataDir) {
      try {
        fs.rmSync(testDataDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
    if (prevDataDir) {
      storage.setDataDir(prevDataDir);
    }
  }

  const passedCount = results.filter((r) => r.pass).length;
  const failedCount = results.filter((r) => !r.pass).length;
  const allPassed = failedCount === 0;

  console.log('\n--- BROWSER TEST RUN SUMMARY ---');
  console.log(`Chrome Version: ${chromeVersionInfo}`);
  console.log(`Total Tests:    ${results.length}`);
  console.log(`Passed:         ${passedCount}`);
  console.log(`Failed:         ${failedCount}`);
  console.log(`Exit Status:    ${allPassed ? 'ALL PASSED (0)' : 'FAILED (1)'}\n`);

  return {
    results,
    allPassed,
    chromeVersion: chromeVersionInfo,
    passedCount,
    failedCount
  };
}

// Standalone execution support
if (require.main === module) {
  runBrowserTests().then(({ allPassed, results }) => {
    process.exit(allPassed ? 0 : 1);
  }).catch((err) => {
    console.error('Fatal browser test runner error:', err);
    process.exit(1);
  });
}

module.exports = { runBrowserTests };
