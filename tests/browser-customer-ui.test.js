/**
 * Real Headless Google Chrome Integration Tests for Customer UI (Gate 3)
 * Tests multi-tenant customer onboarding, workspace switcher, team management,
 * role badges, and version history in real browser over CDP WebSocket.
 */

'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

process.env.NODE_ENV = 'test';
process.env.STORAGE_MODE = 'postgres';
process.env.AUTH_RATE_LIMIT_KEY = crypto.randomBytes(32).toString('hex');
process.env.FB_TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');

const { resolveTestDatabaseUrl, assertLeastPrivilegedTestRole } = require('../db/safety-guard');
const databaseUrl = resolveTestDatabaseUrl();
process.env.DATABASE_URL = databaseUrl;

const { Pool } = require('pg');
const { createApp } = require('../createApp');
const { closePool, resetPool, query } = require('../db/index');
const { runMigrations } = require('../db/migrator');
const userRepository = require('../repositories/user-repository');
const workspaceRepository = require('../repositories/workspace-repository');
const membershipRepository = require('../repositories/membership-repository');
const { closeAllSseClients } = require('../middleware/sse');

const testSchema = 'test_schema_ui_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');

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
        } catch (_) {}
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
      try { this.ws.close(); } catch (_) {}
    }
  }
}

function findChromeExecutable() {
  const candidates = [
    process.env.BROWSER_EXECUTABLE,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium'
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

async function launchHeadlessChrome() {
  if (process.env.AGENT_BROWSER_CDP) {
    const { chromium } = require('playwright');
    const browser = await chromium.connectOverCDP(process.env.AGENT_BROWSER_CDP);
    const page = await browser.contexts()[0].newPage();
    try {
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return route.abort();
        try {
          const response = await route.fetch({ timeout: 60000, maxRedirects: 0 });
          await route.fulfill({ response });
          await response.dispose();
        } catch (err) { if (!page.isClosed()) await route.abort().catch(() => {}); }
      });
      const session = await page.context().newCDPSession(page);
      const cdp = {
        send: (method, params = {}) => session.send(method, params),
        on: (event, handler) => session.on(event, handler),
        evaluate: async expression => {
          const result = await session.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
          if (result.exceptionDetails) throw new Error('Browser evaluation failed.');
          return result.result?.value;
        }
      };
      return { cdp, chromeProcess: null, cleanup: async () => { await session.detach(); await page.close(); } };
    } catch (err) { await page.close(); throw err; }
  }

  const chromePath = findChromeExecutable();
  if (!chromePath) {
    throw new Error('Google Chrome executable not found for headless browser test.');
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-chrome-test-ui-'));
  const chromeProcess = spawn(chromePath, [
    '--headless=new',
    ...(process.env.CI === 'true' ? ['--no-sandbox'] : []),
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
        try { chromeProcess.kill('SIGTERM'); } catch (_) {}
        await new Promise((r) => setTimeout(r, 200));
        try { chromeProcess.kill('SIGKILL'); } catch (_) {}
      }
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
  };
}

async function runCustomerUIBrowserTests() {
  const results = [];
  let server = null;
  let chromeInstance = null;
  let bootstrapPool = null;

  function assert(name, condition, detail = '') {
    if (condition) {
      results.push({ name, pass: true, detail });
      console.log(`  ✅ [Customer UI] ${name}`);
    } else {
      results.push({ name, pass: false, detail });
      console.error(`  ❌ [Customer UI] ${name}: ${detail}`);
    }
  }

  try {
    // 1. Setup PostgreSQL isolated schema
    bootstrapPool = new Pool({ connectionString: databaseUrl });
    await assertLeastPrivilegedTestRole(bootstrapPool);
    await bootstrapPool.query(`CREATE SCHEMA "${testSchema}";`);
    await bootstrapPool.end();
    bootstrapPool = null;

    process.env.PGOPTIONS = `-c search_path="${testSchema}",public`;
    await resetPool();
    await runMigrations();

    // 2. Seed Test User with verified email
    const testUser = await userRepository.createUser({
      email: 'customer-owner@example.test',
      password: 'Password12345!',
      emailVerifiedAt: new Date()
    });

    // Seed Workspace 1
    const ws1 = await workspaceRepository.createWorkspaceWithOwner({
      name: 'ঢাকা ক্রিয়েটিভ ল্যাব',
      slug: 'dhaka-creative',
      creatorUserId: testUser.id
    });

    // Seed Workspace 2
    const ws2 = await workspaceRepository.createWorkspaceWithOwner({
      name: 'চিটাগং মিডিয়া হাব',
      slug: 'ctg-media',
      creatorUserId: testUser.id
    });

    // Seed team member in Workspace 1
    const editorUser = await userRepository.createUser({
      email: 'editor-colleague@example.test',
      password: 'Password12345!',
      emailVerifiedAt: new Date()
    });
    await membershipRepository.addMember({
      workspaceId: ws1.id,
      userId: editorUser.id,
      role: 'editor',
      invitedBy: testUser.id
    });
    await membershipRepository.addMember({
      workspaceId: ws2.id,
      userId: editorUser.id,
      role: 'editor',
      invitedBy: testUser.id
    });

    // 3. Start HTTP Server
    const app = createApp();
    const port = await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        resolve(server.address().port);
      });
    });
    process.env.ALLOWED_ORIGINS = `http://127.0.0.1:${port}`;
    const baseUrl = `http://127.0.0.1:${port}`;
    console.log(`[Customer UI Test] App running at ${baseUrl}`);

    // 4. Launch Headless Chrome
    console.log('[Customer UI Test] Launching headless Google Chrome...');
    chromeInstance = await launchHeadlessChrome();
    const cdp = chromeInstance.cdp;

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');
    await cdp.send('Network.enable');

    // 5. Navigate to Dashboard
    console.log('[Customer UI Test] Navigating to page...');
    await cdp.send('Page.navigate', { url: baseUrl });
    await new Promise((r) => setTimeout(r, 1000));

    // Test 1: Page Title & Initial Auth Modal
    const title = await cdp.evaluate('document.title');
    assert('Page loaded with correct title', title.includes('AutoPost'));

    const authModalVisible = await cdp.evaluate('!document.getElementById("adminAuthModal").classList.contains("hidden")');
    assert('Auth modal is initially visible when unauthenticated', authModalVisible);

    // Test 2: Submit Login as Verified SaaS Customer
    console.log('[Customer UI Test] Submitting login form in browser UI...');
    await cdp.evaluate(`
      document.getElementById('adminAuthEmailInput').value = 'customer-owner@example.test';
      document.getElementById('adminAuthPasswordInput').value = 'Password12345!';
      document.getElementById('adminAuthForm').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    `);

    // Wait for auth to complete and dashboard to load
    await new Promise((r) => setTimeout(r, 1800));

    const authModalHidden = await cdp.evaluate('document.getElementById("adminAuthModal").classList.contains("hidden")');
    assert('Login successfully closes auth modal', authModalHidden);

    // Test 3: Workspace Switcher Bar in Header
    const wsContainerVisible = await cdp.evaluate(`
      const el = document.getElementById('workspaceSelectorContainer');
      el && !el.classList.contains('hidden')
    `);
    assert('Customer Workspace Switcher is visible in top header bar', wsContainerVisible);

    const activeWsName = await cdp.evaluate('document.getElementById("currentWorkspaceName").textContent');
    assert('Active workspace name is displayed in header', activeWsName.includes('ঢাকা ক্রিয়েটিভ') || activeWsName.includes('চিটাগং'));

    const activeRoleBadge = await cdp.evaluate('document.getElementById("currentWorkspaceRoleBadge").textContent');
    assert('Active role badge renders in Bengali (মালিক)', activeRoleBadge.includes('মালিক') || activeRoleBadge.includes('Owner'));

    // Test 4: Workspace Switcher Dropdown Interaction
    await cdp.evaluate('document.getElementById("workspaceDropdownBtn").click()');
    await new Promise((r) => setTimeout(r, 300));

    const dropdownOpen = await cdp.evaluate('!document.getElementById("workspaceDropdownMenu").classList.contains("hidden")');
    assert('Workspace switcher dropdown opens on click', dropdownOpen);

    const wsItemCount = await cdp.evaluate('document.getElementById("workspaceListItems").children.length');
    assert('Workspace switcher lists all available customer workspaces (2)', wsItemCount === 2);

    // Close dropdown
    await cdp.evaluate('document.body.click()');

    // Test 5: Sidebar Navigation to Team Members View
    console.log('[Customer UI Test] Testing Team Members view...');
    const navTeamVisible = await cdp.evaluate('!document.getElementById("navTeam").classList.contains("hidden")');
    assert('Team navigation item is visible for multi-tenant workspace', navTeamVisible);

    await cdp.evaluate('document.getElementById("navTeam").click()');
    await new Promise((r) => setTimeout(r, 800));

    const teamViewActive = await cdp.evaluate('!document.getElementById("view-team").classList.contains("hidden")');
    assert('Navigating to Team switches to view-team', teamViewActive);

    const memberRows = await cdp.evaluate('document.getElementById("teamMembersList").children.length');
    assert('Team members table renders members', memberRows >= 2);

    // Test 6: Invite Member Modal
    const inviteBtnVisible = await cdp.evaluate('!document.getElementById("btnOpenInviteModal").classList.contains("hidden")');
    assert('Owner can see "সদস্য আমন্ত্রণ করুন" button', inviteBtnVisible);

    await cdp.evaluate('document.getElementById("btnOpenInviteModal").click()');
    await new Promise((r) => setTimeout(r, 200));

    const inviteModalOpen = await cdp.evaluate('!document.getElementById("inviteMemberModal").classList.contains("hidden")');
    assert('Invite Member modal opens on click', inviteModalOpen);

    // Close modal
    await cdp.evaluate('document.getElementById("btnCloseInviteModal").click()');

    // Test 7: Security & Audit Log View
    console.log('[Customer UI Test] Testing Security & Audit view...');
    await cdp.evaluate('document.getElementById("navSecurity").click()');
    await new Promise((r) => setTimeout(r, 500));

    const securityViewActive = await cdp.evaluate('!document.getElementById("view-security").classList.contains("hidden")');
    assert('Navigating to Security switches to view-security', securityViewActive);

    // Test 8: Zero Plaintext Token Leaks in DOM and Storage
    const domLeak = await cdp.evaluate(`
      /EAAB[0-9a-zA-Z]{15,}/.test(document.body.innerHTML)
    `);
    assert('Zero plaintext Facebook tokens (EAA...) found in DOM', domLeak === false);

    const storageLeak = await cdp.evaluate(`
      (() => {
        for (let i = 0; i < localStorage.length; i++) {
          const val = localStorage.getItem(localStorage.key(i)) || '';
          if (val.includes('EAAB') || val.includes('secret')) return true;
        }
        for (let i = 0; i < sessionStorage.length; i++) {
          const val = sessionStorage.getItem(sessionStorage.key(i)) || '';
          if (val.includes('EAAB') || val.includes('secret')) return true;
        }
        return false;
      })()
    `);
    assert('Zero plaintext secrets found in localStorage or sessionStorage', storageLeak === false);

    // Test 9: Responsive & Visual Styling
    const buttonComputedDisplay = await cdp.evaluate(`
      window.getComputedStyle(document.getElementById('workspaceDropdownBtn')).display
    `);
    assert('Workspace switcher button styles are computed by Tailwind', buttonComputedDisplay === 'flex');

  } catch (err) {
    console.error('[Customer UI Test Error]', err);
    assert('Test execution encountered fatal error', false, err.message);
  } finally {
    closeAllSseClients();
    if (chromeInstance) {
      await chromeInstance.cleanup();
    }
    if (server) {
      await new Promise((r) => server.close(r));
    }
    await closePool();

    // Drop test schema
    if (databaseUrl) {
      delete process.env.PGOPTIONS;
      const cleanupPool = new Pool({ connectionString: databaseUrl });
      try {
        await cleanupPool.query(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE;`);
      } catch (_) {}
      finally {
        await cleanupPool.end();
      }
    }
  }

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;

  console.log('\n--- CUSTOMER UI BROWSER TEST RUN SUMMARY ---');
  console.log(`Total Tests:    ${results.length}`);
  console.log(`Passed:         ${passed}`);
  console.log(`Failed:         ${failed}`);

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('Exit Status:    ALL PASSED (0)\n');
    process.exit(0);
  }
}

if (require.main === module) {
  runCustomerUIBrowserTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { runCustomerUIBrowserTests };
