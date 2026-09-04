/**
 * Comprehensive Independent Integration & Security Test Suite
 * Powered by Node.js built-in test runner (node:test and node:assert).
 *
 * Strict Security Controls (Ordered strictly A through G):
 * A. Create temporary directory.
 * B. Set process.env.DATA_DIR.
 * C. Create safe fixture files.
 * D. Install network guard.
 * E. Import application modules.
 * F. Run tests.
 * G. Stop services, inspect open handles, assert zero data tampering, and delete temp directory.
 */

// Step A: Create temporary test directory
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-int-test-data-'));

// Step B: Set process.env.DATA_DIR before ANY application module is required
process.env.DATA_DIR = testDataDir;
process.env.NODE_ENV = 'development';
process.env.DEV_AUTH_BYPASS = 'false';
process.env.FB_APP_SECRET = 'test_meta_app_secret_12345';
process.env.ADMIN_API_KEY = 'test_admin_api_key_secret_999';

// Step C: Record real data/settings.json state (if exists) without reading or exposing contents
const realSettingsPath = path.join(__dirname, '..', 'data', 'settings.json');
let initialSettingsHash = null;
let initialSettingsMtime = null;

if (fs.existsSync(realSettingsPath)) {
  const content = fs.readFileSync(realSettingsPath);
  initialSettingsHash = crypto.createHash('sha256').update(content).digest('hex');
  initialSettingsMtime = fs.statSync(realSettingsPath).mtimeMs;
}

// Step D: Install loopback-only network deny guard
const networkGuard = require('./network-guard');
networkGuard.installNetworkGuard();

// Step E: Import application modules (only AFTER DATA_DIR and network guard are initialized)
const { test, describe, before, after, afterEach } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const https = require('https');
const net = require('net');
const axios = require('axios');

// Mock external providers for AI generation
axios.post = async (url, data) => {
  if (typeof url === 'string' && url.includes('generateContent')) {
    const payloadStr = JSON.stringify(data);
    if (payloadStr.includes('Reply: OK')) {
      return { data: { candidates: [{ content: { parts: [{ text: 'Reply: OK' }] } }] } };
    }
    if (payloadStr.includes('JSON array')) {
      return {
        data: {
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify([
                  { title: 'মহাকাশের কৃষ্ণগহ্বর', search_term: 'black hole in space', angle: 'মহাকাশ গবেষণা', badge: 'মহাকাশ বিজ্ঞান' },
                  { title: 'জেমস ওয়েব টেলিস্কোপ', search_term: 'James Webb Telescope', angle: 'টেলিস্কোপ আবিষ্কার', badge: 'মহাকাশ বিজ্ঞান' }
                ])
              }]
            }
          }]
        }
      };
    }

    return {
      data: {
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                badge: 'মহাকাশ বিজ্ঞান',
                line1_red: 'কৃষ্ণগহ্বর',
                line1_white: 'মহাবিশ্বের সবচেয়ে রহস্যময় সৃষ্টি,',
                line2_white: 'যেখান থেকে আলোও পালাতে পারে না,',
                line2_yellow: 'বিজ্ঞানীদের নতুন আবিষ্কার!',
                search_term: 'black hole deep space cosmic exploration 8k',
                post_caption: '🌌 মহাকাশের অপার রহস্য: কৃষ্ণগহ্বরের অদ্ভুত ক্ষমতা! ✨\n\nবিজ্ঞানীরা নতুন গবেষণায় খুঁজে পেয়েছেন মহাবিশ্বের অন্যতম শক্তিশালী ব্ল্যাক হোল। এর মহাকর্ষীয় টান এত তীব্র যে আলোও ফিরে আসতে পারে না।\n\n#SpaceFacts #BlackHole #Astronomy'
              })
            }]
          }
        }]
      }
    };
  }

  if (typeof url === 'string' && url.includes('pollinations.ai')) {
    return {
      data: JSON.stringify({
        badge: 'মহাকাশ বিজ্ঞান',
        line1_red: 'কৃষ্ণগহ্বর',
        line1_white: 'মহাবিশ্বের রহস্য',
        line2_white: 'আলোও পালাতে পারে না',
        line2_yellow: 'বিজ্ঞানীদের আবিষ্কার',
        search_term: 'black hole deep space',
        post_caption: '🌌 মহাকাশের অপার রহস্য: কৃষ্ণগহ্বরের অদ্ভুত ক্ষমতা! ✨\n\nমহাবিশ্বের সবচেয়ে শক্তিশালী মহাকর্ষীয় টানের কেন্দ্র হলো কৃষ্ণগহ্বর।'
      })
    };
  }

  return { data: {} };
};

const sharp = require('sharp');
let mockImageBuffer = null;

axios.get = async () => {
  if (!mockImageBuffer) {
    mockImageBuffer = await sharp({
      create: { width: 100, height: 100, channels: 4, background: { r: 15, g: 23, b: 42, alpha: 1 } }
    }).jpeg().toBuffer();
  }
  return { data: mockImageBuffer };
};

const storage = require('../services/storage');
const facebook = require('../services/facebook');
const ai = require('../services/ai');
const scheduler = require('../services/scheduler');
const { getFallbacks } = require('../services/ai/fallbacks');
const {
  validateContent,
  containsMojibake,
  checkDuplicate,
  isValidPublicUrl
} = require('../services/content-safety');
const {
  createDefaultContentProfile,
  validateContentProfile,
  normalizeContentProfile,
  calculateOnboardingStatus,
  buildPublicContentProfile
} = require('../services/page-profile');
const { buildPageContext } = require('../services/ai/page-context');
const {
  isSensitiveKey,
  serializePublic,
  serializeSettings,
  serializePage,
  serializePages
} = require('../utils/public-serializer');
const {
  hashPassword,
  verifyPassword,
  isAuthConfigured,
  createSession,
  getSession,
  destroySession,
  clearAllSessions,
  stopSessionPruneTimer
} = require('../middleware/auth');
const { validateSettingsPayload } = require('../middleware/settings-validator');
const { isOriginAllowed, isValidOriginFormat, getAllowedOrigins } = require('../utils/cors-validator');
const errorHandler = require('../middleware/errorHandler');
const { closeAllSseClients } = require('../middleware/sse');
const { createApp } = require('../createApp');
const { runBrowserTests } = require('./browser-test');

// Ephemeral Test Server Setup
let server = null;
let baseUrl = '';

before(async () => {
  storage.initDefaultUsers();
  const app = createApp();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(() => {
  scheduler.stop();
  scheduler.resetDependencies();
});

after(async () => {
  scheduler.stop();
  scheduler.resetDependencies();
  closeAllSseClients();
  clearAllSessions();
  stopSessionPruneTimer();

  if (server) {
    if (server.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  networkGuard.uninstallNetworkGuard();

  // Inspect open handles for memory leaks
  if (typeof process._getActiveHandles === 'function') {
    const handles = process._getActiveHandles();
    const safeHandles = handles
      .filter((h) => h && !h._unrefed)
      .map((h) => {
        const type = h.constructor ? h.constructor.name : typeof h;
        const port = h.localPort || (h._handle && h._handle.localPort) || null;
        return port ? `${type}(:${port})` : type;
      });
    if (safeHandles.length > 0) {
      console.log(`[Teardown Audit] Active un-refed handles remaining: ${safeHandles.join(', ')}`);
    }
  }

  // Verify real local settings file was completely untouched
  if (initialSettingsHash) {
    const finalContent = fs.readFileSync(realSettingsPath);
    const finalHash = crypto.createHash('sha256').update(finalContent).digest('hex');
    const finalMtime = fs.statSync(realSettingsPath).mtimeMs;
    assert.strictEqual(finalHash, initialSettingsHash, 'CRITICAL: data/settings.json SHA256 was altered during tests!');
    assert.strictEqual(finalMtime, initialSettingsMtime, 'CRITICAL: data/settings.json mtime was altered during tests!');
  }

  // Cleanup temp directory
  try {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

// =========================================================================
// SUITE 1: STRICT NETWORK EGRESS DENY GUARD (REAL ATTEMPTS)
// =========================================================================
describe('1. Network Egress Deny Guard Verification', () => {
  test('global.fetch to external URL throws NETWORK_EGRESS_BLOCKED', async () => {
    await assert.rejects(
      async () => fetch('https://graph.facebook.com'),
      (err) => err.code === 'NETWORK_EGRESS_BLOCKED'
    );
  });

  test('https.get to external URL throws NETWORK_EGRESS_BLOCKED', () => {
    assert.throws(
      () => https.get('https://generativelanguage.googleapis.com'),
      (err) => err.code === 'NETWORK_EGRESS_BLOCKED'
    );
  });

  test('http.get to external URL throws NETWORK_EGRESS_BLOCKED', () => {
    assert.throws(
      () => http.get('http://text.pollinations.ai'),
      (err) => err.code === 'NETWORK_EGRESS_BLOCKED'
    );
  });

  test('net.connect to external destination throws NETWORK_EGRESS_BLOCKED', () => {
    assert.throws(
      () => net.connect({ host: 'graph.facebook.com', port: 443 }),
      (err) => err.code === 'NETWORK_EGRESS_BLOCKED'
    );
  });

  test('Loopback requests remain permitted', async () => {
    const res = await fetch(`${baseUrl}/api/auth/status`);
    assert.strictEqual(res.status, 200);
  });

  // Clear intentional guard test attempts so test audit remains 0
  networkGuard.clearBlockedAttempts();
});

// =========================================================================
// SUITE 2: SERIALIZER & DATA REDACTION SAFETY
// =========================================================================
describe('2. Serializer & Redaction Safety', () => {
  test('isSensitiveKey detects all secret key patterns', () => {
    assert.strictEqual(isSensitiveKey('accessToken'), true);
    assert.strictEqual(isSensitiveKey('fb_app_secret'), true);
    assert.strictEqual(isSensitiveKey('geminiApiKey'), true);
    assert.strictEqual(isSensitiveKey('passwordHash'), true);
    assert.strictEqual(isSensitiveKey('token'), true);
    assert.strictEqual(isSensitiveKey('status'), false);
    assert.strictEqual(isSensitiveKey('category'), false);
    assert.strictEqual(isSensitiveKey('pageName'), false);
  });

  test('serializeSettings strips all secret keys and enriches flags', () => {
    const raw = {
      pageName: 'My Page',
      accessToken: 'EAABwzSecretToken123',
      geminiApiKey: 'AIzaSyFakeKey456',
      autoPostEnabled: true
    };
    const sanitized = serializeSettings(raw);
    assert.strictEqual(sanitized.accessToken, undefined);
    assert.strictEqual(sanitized.geminiApiKey, undefined);
    assert.strictEqual(sanitized.facebookConnected, true);
    assert.strictEqual(sanitized.geminiConfigured, true);
    assert.strictEqual(sanitized.pageName, 'My Page');
  });

  test('serializePage and serializePages omit access tokens', () => {
    const page = { id: 'p1', name: 'Tech Page', accessToken: 'EAABwzSecret' };
    const serialized = serializePage(page);
    assert.strictEqual(serialized.accessToken, undefined);
    assert.strictEqual(serialized.name, 'Tech Page');

    const list = serializePages([page]);
    assert.strictEqual(list[0].accessToken, undefined);
  });

  test('Public serializer strips passwordHash and passwordSalt from users', () => {
    const user = {
      id: 'usr_1',
      email: 'test@example.com',
      passwordHash: 'deadbeef1234',
      passwordSalt: 'abcdef5678',
      role: 'admin'
    };
    const pub = serializePublic(user);
    assert.strictEqual(pub.passwordHash, undefined);
    assert.strictEqual(pub.passwordSalt, undefined);
    assert.strictEqual(pub.email, 'test@example.com');
  });
});

// =========================================================================
// SUITE 3: REAL HTTP AUTH, SESSION & RATE LIMITING INTEGRATION
// =========================================================================
describe('3. Real HTTP Auth & Session Flow', () => {
  test('POST /api/auth/login rejects invalid credentials with 401 and generic error', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'susantalohr@gmail.com', password: 'wrong_password_999' })
    });
    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.strictEqual(data.error, 'Invalid email or password.');
  });

  test('Failed login rate limiter triggers 429 after 5 attempts', async () => {
    for (let i = 0; i < 4; i++) {
      await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'susantalohr@gmail.com', password: 'wrong_password_999' })
      });
    }

    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'susantalohr@gmail.com', password: 'wrong_password_999' })
    });
    assert.strictEqual(res.status, 429);
    const data = await res.json();
    assert.strictEqual(data.code, 'TOO_MANY_FAILED_LOGINS');

    const { resetFailedLogins } = require('../routes/auth.routes');
    resetFailedLogins('127.0.0.1');
    resetFailedLogins('::1');
  });

  test('POST /api/auth/login succeeds with super admin credentials, sets HttpOnly cookie and returns CSRF token', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'susantalohr@gmail.com', password: 'admin@123' })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.authenticated, true);
    assert.strictEqual(data.user.email, 'susantalohr@gmail.com');
    assert.strictEqual(data.user.role, 'super_admin');
    assert.ok(typeof data.csrfToken === 'string' && data.csrfToken.length >= 16);

    const setCookie = res.headers.get('set-cookie');
    assert.ok(setCookie);
    assert.ok(setCookie.includes('HttpOnly'));
    assert.ok(setCookie.includes('SameSite=Strict'));
    assert.ok(setCookie.includes('auth_session='));
  });

  test('GET /api/settings requires authentication (401 when unauthenticated)', async () => {
    const res = await fetch(`${baseUrl}/api/settings`);
    assert.strictEqual(res.status, 401);
  });

  test('GET /api/settings succeeds with active session cookie', async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'susantalohr@gmail.com', password: 'admin@123' })
    });
    const cookie = loginRes.headers.get('set-cookie').split(';')[0];

    const res = await fetch(`${baseUrl}/api/settings`, {
      headers: { Cookie: cookie }
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.accessToken, undefined);
    assert.strictEqual(data.geminiApiKey, undefined);
  });

  test('POST /api/auth/logout invalidates session and clears cookie', async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'susantalohr@gmail.com', password: 'admin@123' })
    });
    const cookie = loginRes.headers.get('set-cookie').split(';')[0];

    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookie }
    });
    assert.strictEqual(logoutRes.status, 200);
    const setCookie = logoutRes.headers.get('set-cookie');
    assert.ok(setCookie.includes('Max-Age=0'));

    const checkRes = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Cookie: cookie }
    });
    const checkData = await checkRes.json();
    assert.strictEqual(checkData.authenticated, false);
  });

  test('Default user seeding is prohibited when NODE_ENV is unset or production', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-seed-test-'));
    try {
      storage.setDataDir(tempDir);
      const origEnv = process.env.NODE_ENV;

      // Test A: NODE_ENV unset -> does not seed
      delete process.env.NODE_ENV;
      const unsetUsers = storage.initDefaultUsers();
      assert.strictEqual(unsetUsers.length, 0, 'Must not seed default user when NODE_ENV is unset');

      // Test B: NODE_ENV=production -> does not seed
      process.env.NODE_ENV = 'production';
      const prodUsers = storage.initDefaultUsers();
      assert.strictEqual(prodUsers.length, 0, 'Must not seed default user when NODE_ENV is production');

      // Restore
      process.env.NODE_ENV = origEnv;
    } finally {
      storage.setDataDir(testDataDir);
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  });

  test('User responses never include passwordHash, passwordSalt, or reset tokens', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'susantalohr@gmail.com', password: 'admin@123' })
    });
    const data = await res.json();
    assert.strictEqual(data.user.passwordHash, undefined);
    assert.strictEqual(data.user.passwordSalt, undefined);
    assert.strictEqual(data.user.resetToken, undefined);
  });
});

// =========================================================================
// SUITE 4: REAL HTTP CSRF & ORIGIN DEFENSE
// =========================================================================
describe('4. Real HTTP CSRF & Origin Defense', () => {
  let validCookie = '';
  let validCsrfToken = '';

  before(async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'susantalohr@gmail.com', password: 'admin@123' })
    });
    const data = await res.json();
    validCookie = res.headers.get('set-cookie').split(';')[0];
    validCsrfToken = data.csrfToken;
  });

  test('Mutating POST /api/settings with cookie but missing X-CSRF-Token is rejected with 403', async () => {
    const res = await fetch(`${baseUrl}/api/settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: validCookie
      },
      body: JSON.stringify({ autoPostEnabled: false })
    });
    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.strictEqual(data.code, 'CSRF_TOKEN_INVALID');
  });

  test('Mutating POST /api/settings with invalid X-CSRF-Token is rejected with 403', async () => {
    const res = await fetch(`${baseUrl}/api/settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: validCookie,
        'X-CSRF-Token': 'bogus_csrf_token_value'
      },
      body: JSON.stringify({ autoPostEnabled: false })
    });
    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.strictEqual(data.code, 'CSRF_TOKEN_INVALID');
  });

  test('Mutating POST /api/settings with untrusted Origin is rejected with 403', async () => {
    const res = await fetch(`${baseUrl}/api/settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: validCookie,
        'X-CSRF-Token': validCsrfToken,
        Origin: 'https://malicious-attacker.com'
      },
      body: JSON.stringify({ autoPostEnabled: false })
    });
    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.strictEqual(data.code, 'FORBIDDEN_ORIGIN');
  });

  test('Mutating POST /api/settings with valid cookie and X-CSRF-Token succeeds', async () => {
    const res = await fetch(`${baseUrl}/api/settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: validCookie,
        'X-CSRF-Token': validCsrfToken
      },
      body: JSON.stringify({ autoPostEnabled: true })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
  });

  test('API Key header authentication is exempt from CSRF token check', async () => {
    const res = await fetch(`${baseUrl}/api/settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': 'test_admin_api_key_secret_999'
      },
      body: JSON.stringify({ autoPostEnabled: true })
    });
    assert.strictEqual(res.status, 200);
  });
});

// =========================================================================
// SUITE 5: REAL HTTP SETTINGS & SECRET REDACTION
// =========================================================================
describe('5. Settings API Secret Protection', () => {
  let authHeaders = {};

  before(async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'susantalohr@gmail.com', password: 'admin@123' })
    });
    const data = await res.json();
    authHeaders = {
      'Content-Type': 'application/json',
      Cookie: res.headers.get('set-cookie').split(';')[0],
      'X-CSRF-Token': data.csrfToken
    };
  });

  test('POST /api/settings rejects attempts to inject credentials', async () => {
    const res = await fetch(`${baseUrl}/api/settings`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ accessToken: 'illegal_secret_attempt' })
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.code, 'INVALID_SETTINGS_PAYLOAD');
  });

  test('POST /api/settings/verify-gemini does not echo secret key in response', async () => {
    const res = await fetch(`${baseUrl}/api/settings/verify-gemini`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ apiKey: 'AIzaSyDtestKey12345' })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.apiKey, undefined);
    assert.strictEqual(data.key, undefined);
  });
});

// =========================================================================
// SUITE 6: REAL HTTP META WEBHOOK SIGNATURE VERIFICATION
// =========================================================================
describe('6. Real HTTP Meta Webhook Signature Verification', () => {
  test('GET /api/webhook/facebook verifies token and echoes challenge', async () => {
    storage.saveSettings({ webhookVerifyToken: 'meta_verify_secret_token_777' });

    const res = await fetch(
      `${baseUrl}/api/webhook/facebook?hub.mode=subscribe&hub.verify_token=meta_verify_secret_token_777&hub.challenge=challenge_echo_123`
    );
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert.strictEqual(text, 'challenge_echo_123');
  });

  test('GET /api/webhook/facebook rejects invalid verify token with 403', async () => {
    const res = await fetch(
      `${baseUrl}/api/webhook/facebook?hub.mode=subscribe&hub.verify_token=wrong_token&hub.challenge=challenge_echo_123`
    );
    assert.strictEqual(res.status, 403);
  });

  test('POST /api/webhook/facebook accepts valid HMAC-SHA256 signature', async () => {
    const payload = JSON.stringify({ object: 'page', entry: [{ id: 'p1', time: Date.now() }] });
    const signature = 'sha256=' + crypto.createHmac('sha256', 'test_meta_app_secret_12345').update(payload).digest('hex');

    const res = await fetch(`${baseUrl}/api/webhook/facebook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': signature
      },
      body: payload
    });
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert.strictEqual(text, 'EVENT_RECEIVED');
  });

  test('POST /api/webhook/facebook rejects tampered HMAC-SHA256 signature with 401', async () => {
    const payload = JSON.stringify({ object: 'page', entry: [{ id: 'p1', time: Date.now() }] });
    const bogusSignature = 'sha256=0000000000000000000000000000000000000000000000000000000000000000';

    const res = await fetch(`${baseUrl}/api/webhook/facebook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': bogusSignature
      },
      body: payload
    });
    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.strictEqual(data.code, 'INVALID_SIGNATURE');
  });

  test('POST /api/webhook/facebook rejects modified body with old signature with 401', async () => {
    const originalPayload = JSON.stringify({ object: 'page', entry: [{ id: 'original_entry' }] });
    const oldSignature = 'sha256=' + crypto.createHmac('sha256', 'test_meta_app_secret_12345').update(originalPayload).digest('hex');
    const modifiedPayload = JSON.stringify({ object: 'page', entry: [{ id: 'tampered_entry' }] });

    const res = await fetch(`${baseUrl}/api/webhook/facebook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': oldSignature
      },
      body: modifiedPayload
    });
    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.strictEqual(data.code, 'INVALID_SIGNATURE');
  });

  test('POST /api/webhook/facebook rejects malformed signature format (missing sha256= prefix) with 401', async () => {
    const payload = JSON.stringify({ object: 'page', entry: [] });
    const rawHexSignature = crypto.createHmac('sha256', 'test_meta_app_secret_12345').update(payload).digest('hex');

    const res = await fetch(`${baseUrl}/api/webhook/facebook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': rawHexSignature // Missing "sha256=" prefix
      },
      body: payload
    });
    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.strictEqual(data.code, 'INVALID_SIGNATURE_FORMAT');
  });

  test('POST /api/webhook/facebook rejects signature computed with incorrect app secret with 401', async () => {
    const payload = JSON.stringify({ object: 'page', entry: [{ id: 'p1' }] });
    const wrongKeySignature = 'sha256=' + crypto.createHmac('sha256', 'incorrect_wrong_secret_9999').update(payload).digest('hex');

    const res = await fetch(`${baseUrl}/api/webhook/facebook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': wrongKeySignature
      },
      body: payload
    });
    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.strictEqual(data.code, 'INVALID_SIGNATURE');
  });

  test('POST /api/webhook/facebook rejects missing HMAC-SHA256 header with 401', async () => {
    const payload = JSON.stringify({ object: 'page', entry: [] });
    const res = await fetch(`${baseUrl}/api/webhook/facebook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.strictEqual(data.code, 'SIGNATURE_MISSING');
  });
});

// =========================================================================
// SUITE 7: REAL HTTP ROUTE PUBLISH GUARDS (POST /api/facebook/post)
// =========================================================================
describe('7. Real HTTP Route Publish Guards', () => {
  let authHeaders = {};

  before(async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'susantalohr@gmail.com', password: 'admin@123' })
    });
    const data = await res.json();
    authHeaders = {
      'Content-Type': 'application/json',
      Cookie: res.headers.get('set-cookie').split(';')[0],
      'X-CSRF-Token': data.csrfToken
    };
  });

  test('POST /api/facebook/post rejects short captions with 400 and SHORT_CAPTION', async () => {
    const res = await fetch(`${baseUrl}/api/facebook/post`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ message: 'Too short' })
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.ok(data.issueCodes.includes('SHORT_CAPTION'));
  });

  test('POST /api/facebook/post rejects mojibake captions with 400 and MOJIBAKE_DETECTED', async () => {
    const res = await fetch(`${baseUrl}/api/facebook/post`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        message: 'à¦…à§à¦¯à¦¾à¦¨à§à¦¡à§à¦°à§‹à¦®à¦¿à¦¡à¦¾ à¦—à§à¦¯à¦¾à¦²à¦¾à¦•à§à¦¸à¦¿ à¦“ à¦®à¦¹à¦¾à¦¬à¦¿à¦¶à§à¦¬à§‡à¦° à¦…à¦ªà§‚à¦°à§à¦¬ à¦°à¦¹à¦¸à§à¦¯'
      })
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.ok(data.issueCodes.includes('MOJIBAKE_DETECTED'));
  });

  test('POST /api/facebook/post rejects unverified news claims with 400 and MISSING_SOURCE', async () => {
    const res = await fetch(`${baseUrl}/api/facebook/post`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        category: 'trending_news',
        message: '🚨 ব্রেকিং নিউজ: দেশব্যাপী জরুরি কারফিউ জারি করা হয়েছে অবিলম্বে নির্দেশ অনুযায়ী।',
        sources: []
      })
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.ok(data.issueCodes.includes('MISSING_SOURCE'));
  });

  test('POST /api/facebook/post rejects non-existent local image paths with 400 and INVALID_IMAGE_PATH', async () => {
    const res = await fetch(`${baseUrl}/api/facebook/post`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        message: 'মহাকাশ বিজ্ঞানের এক নতুন দিগন্ত উন্মোচিত হয়েছে জেমস ওয়েব স্পেস টেলিস্কোপের মাধ্যমে।',
        imagePath: '/tmp/nonexistent_fake_image_file_999.jpg'
      })
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.ok(data.issueCodes.includes('INVALID_IMAGE_PATH'));
  });

  test('POST /api/facebook/post executes publisher and succeeds for valid content', async () => {
    let publisherCalled = false;
    let publishPayload = null;
    const originalPublish = facebook.publishPost;

    facebook.publishPost = async (params) => {
      publisherCalled = true;
      publishPayload = params;
      return { success: true, postId: 'test_published_fb_post_888' };
    };

    try {
      const validMessage = 'বিজ্ঞান ও প্রযুক্তির নতুন আবিষ্কার: কোয়ান্টাম কম্পিউটিং কীভাবে ভবিষ্যৎ বদলে দিচ্ছে বিস্তারিত জানুন।';
      const res = await fetch(`${baseUrl}/api/facebook/post`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ message: validMessage })
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.postId, 'test_published_fb_post_888');
      assert.strictEqual(publisherCalled, true);
      assert.strictEqual(publishPayload.message, validMessage);
    } finally {
      facebook.publishPost = originalPublish;
    }
  });
});

// =========================================================================
// SUITE 8: SCHEDULER REAL TRIGGER FLOW INTEGRATION (A, B, C, D, E)
// =========================================================================
describe('8. Scheduler Trigger Flow Scenarios (A, B, C, D, E)', () => {
  test('Scenario A: Fallback triggered -> publishPost: 0, queue write: 1, status: review_required', async () => {
    let publishCalls = 0;
    scheduler.setDependencies({
      ai: {
        generateFullPostBundle: async () => ({
          message: '💎 ৫৫ ক্যানক্রি ই গ্রহ পুরোটাই হীরা দিয়ে তৈরি এক অদ্ভুত মহাজাগতিক বিস্ময়...',
          isFallback: true,
          generationSource: 'curated_fallback',
          verified: false,
          sources: []
        })
      },
      facebook: {
        publishPost: async () => { publishCalls++; return { success: true }; }
      }
    });

    const result = await scheduler.triggerAIAutoPilot();
    assert.strictEqual(publishCalls, 0, 'publishPost must not be called when fallback generated');
    assert.strictEqual(result.reviewRequired, true);

    const queue = storage.getQueue();
    const fallbackItem = queue.find(q => q.generationSource === 'curated_fallback');
    assert.ok(fallbackItem, 'Fallback must be added to queue');
    assert.strictEqual(fallbackItem.status, 'review_required');
    assert.strictEqual(fallbackItem.verified, false);
  });

  test('Scenario B: Unverified trending news -> publishPost: 0, queue write: 1, status: review_required with MISSING_SOURCE', async () => {
    let publishCalls = 0;
    scheduler.setDependencies({
      ai: {
        generateFullPostBundle: async () => ({
          message: '🚨 ব্রেকিং নিউজ: দেশব্যাপী নতুন আইন জারির বিজ্ঞপ্তি প্রকাশিত হয়েছে। এখনই বিস্তারিত জেনে নিন!',
          categoryId: 'trending_news',
          isFallback: false,
          generationSource: 'ai_generated',
          verified: false,
          sources: []
        })
      },
      facebook: {
        publishPost: async () => { publishCalls++; return { success: true }; }
      }
    });

    storage.saveSettings({ selectedCategories: ['trending_news'] });
    const result = await scheduler.triggerAIAutoPilot('trending_news');
    assert.strictEqual(publishCalls, 0, 'publishPost must not be called for unverified news');
    assert.strictEqual(result.reviewRequired, true);

    const queue = storage.getQueue();
    const unverifiedItem = queue[queue.length - 1];
    assert.strictEqual(unverifiedItem.status, 'review_required');
    assert.ok(unverifiedItem.issues.some(i => i.includes('MISSING_SOURCE') || i.includes('verified sources')));
  });

  test('Scenario C: Valid low-risk non-news -> publishPost: 1, history write: 1', async () => {
    let publishCalls = 0;
    scheduler.setDependencies({
      ai: {
        generateFullPostBundle: async () => ({
          message: 'মহাকাশ বিজ্ঞানের নতুন দিগন্ত: জেমস ওয়েব স্পেস টেলিস্কোপ দূরবর্তী গ্যালাক্সির স্পষ্ট ছবি পাঠিয়েছে।',
          categoryId: 'science_nature',
          isFallback: false,
          generationSource: 'ai_generated',
          verified: true,
          sources: [{ url: 'https://nasa.gov/news', publisher: 'NASA', title: 'Webb Discovery' }]
        })
      },
      facebook: {
        publishPost: async () => {
          publishCalls++;
          return { success: true, postId: 'post_scenario_c_123' };
        }
      }
    });

    storage.saveSettings({ selectedCategories: ['science_nature'] });
    const result = await scheduler.triggerAIAutoPilot('science_nature');
    assert.strictEqual(publishCalls, 1, 'publishPost must be called exactly once');
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.result.postId, 'post_scenario_c_123');

    const history = storage.getHistory();
    const published = history.find(h => h.postId === 'post_scenario_c_123');
    assert.ok(published);
    assert.strictEqual(published.status, 'published');
  });

  test('Scenario D: AI generation throws -> publishPost: 0, failure recorded in history', async () => {
    let publishCalls = 0;
    scheduler.setDependencies({
      ai: {
        generateFullPostBundle: async () => {
          throw new Error('Gemini API Quota Exceeded 429');
        }
      },
      facebook: {
        publishPost: async () => { publishCalls++; return { success: true }; }
      }
    });

    await assert.rejects(
      async () => scheduler.triggerAIAutoPilot('science_nature'),
      /Gemini API Quota Exceeded 429/
    );
    assert.strictEqual(publishCalls, 0, 'publishPost must not be called when AI throws');

    const history = storage.getHistory();
    const failedItem = history.find(h => h.error && h.error.includes('Gemini API Quota Exceeded'));
    assert.ok(failedItem);
    assert.strictEqual(failedItem.status, 'failed');
  });

  test('Scenario E: Queue worker concurrency guard prevents duplicate publishing', async () => {
    let publishCalls = 0;
    scheduler.setDependencies({
      facebook: {
        publishPost: async () => {
          publishCalls++;
          await new Promise((r) => setTimeout(r, 40));
          return { success: true, postId: 'concurrent_worker_post_777' };
        }
      }
    });

    const item = storage.addToQueue({
      message: 'একটি সম্পূর্ণ নিরাপদ শিক্ষামূলক পোস্ট যা কিউ এর মাধ্যমে ফেসবুক পেজে পোস্ট করা হবে।',
      status: 'pending'
    });
    const queue = storage.getQueue();

    await Promise.all([
      scheduler.processManualQueueItem(item, queue),
      scheduler.processManualQueueItem(item, queue)
    ]);

    assert.strictEqual(publishCalls, 1, 'publishPost must be called AT MOST ONCE despite concurrent workers');
  });
});

// =========================================================================
// SUITE 9: FALLBACK DATASET AUDIT
// =========================================================================
describe('9. Fallback Dataset & Category Audit', () => {
  test('All curated fallback posts have valid structure, registered categories, and unique IDs', () => {
    const fallbacks = getFallbacks();
    assert.ok(Array.isArray(fallbacks));
    assert.ok(fallbacks.length >= 7, 'Must have fallbacks for all main categories');

    const seenIds = new Set();
    const registeredCategories = storage.getCategories().map(c => c.id);

    for (const fb of fallbacks) {
      assert.ok(fb.id && typeof fb.id === 'string', `Item missing valid id: ${JSON.stringify(fb)}`);
      assert.strictEqual(seenIds.has(fb.id), false, `Duplicate fallback id: ${fb.id}`);
      seenIds.add(fb.id);

      assert.ok(
        registeredCategories.includes(fb.category),
        `Fallback category "${fb.category}" must be registered in DEFAULT_CATEGORIES`
      );
      assert.ok(fb.badge && typeof fb.badge === 'string', `Fallback ${fb.id} missing badge`);
      assert.ok(fb.post_caption && fb.post_caption.length >= 30, `Fallback ${fb.id} caption too short`);
      assert.strictEqual(containsMojibake(fb.post_caption), false, `Fallback ${fb.id} contains mojibake`);
      assert.strictEqual(fb.verified, false, `Fallback ${fb.id} must have verified: false`);
      assert.strictEqual(fb.autoPublish, false, `Fallback ${fb.id} must have autoPublish: false`);
      assert.strictEqual(fb.generationSource, 'curated_fallback');
    }

    const neeraj = fallbacks.find(f => f.id === 'fallback_sports_neeraj_chopra');
    assert.ok(neeraj, 'Neeraj Chopra sports fallback must exist');
    assert.strictEqual(neeraj.category, 'sports_records');
    assert.notStrictEqual(neeraj.category, 'philosophy_wisdom');
  });
});

// =========================================================================
// SUITE 10: BASE API COMPATIBILITY (Base commit d1f4f1a vs HEAD)
// =========================================================================
describe('10. Base Commit AIService API Return Shapes', () => {
  test('regenerateCaptionOnly returns object shape { success: true, message: string }', async () => {
    const res = await ai.regenerateCaptionOnly({
      currentCaption: 'পুরোনো ফেসবুক পোস্টের ক্যাপশন যা পরিমার্জন করতে হবে।',
      topic: 'বিজ্ঞান ও প্রযুক্তি'
    });
    assert.strictEqual(typeof res, 'object');
    assert.strictEqual(res.success, true);
    assert.strictEqual(typeof res.message, 'string');
    assert.ok(res.message.length >= 10);
  });

  test('generateFullPostBundle returns all base contract fields', async () => {
    const bundle = await ai.generateFullPostBundle({
      topic: 'মহাকাশ বিজ্ঞান',
      categoryId: 'science_nature',
      includeImage: false
    });
    assert.ok(bundle);
    assert.strictEqual(typeof bundle.message, 'string');
    assert.ok('category' in bundle);
    assert.ok('cardData' in bundle);
    assert.ok('image' in bundle);
    // Verified safety metadata extensions
    assert.ok('isFallback' in bundle);
    assert.ok('generationSource' in bundle);
    assert.ok('verified' in bundle);
    assert.ok('sources' in bundle);
  });

  test('generateThumbnailCardFromData returns metadata object { success, fileName, localPath, url, layout }', async () => {
    const cardData = {
      badge: 'আলোচিত তথ্য',
      line1_red: 'মহাকাশ অভিযান',
      line1_white: 'নাসার নতুন ঘোষণা',
      line2_white: 'চাঁদের বুকে মানুষের পা',
      line2_yellow: 'আগামী বছরের পরিকল্পনা',
      search_term: 'moon landing'
    };
    const card = await ai.generateThumbnailCardFromData(cardData, 'মহাকাশ অভিযান');
    try {
      assert.ok(card);
      assert.strictEqual(card.success, true);
      assert.strictEqual(typeof card.fileName, 'string');
      assert.strictEqual(typeof card.localPath, 'string');
      assert.strictEqual(typeof card.url, 'string');
      assert.strictEqual(typeof card.layout, 'string');
    } finally {
      if (card && card.localPath && fs.existsSync(card.localPath)) {
        try { fs.unlinkSync(card.localPath); } catch {}
      }
    }
  });

  test('generateTopicIdeas returns Array with topic objects', async () => {
    const ideas = await ai.generateTopicIdeas('science_nature', 2);
    assert.ok(Array.isArray(ideas));
    assert.ok(ideas.length >= 1);
    assert.strictEqual(typeof ideas[0].title, 'string');
  });

  test('generatePostText returns string caption', async () => {
    const text = await ai.generatePostText('বিজ্ঞান ও মহাবিশ্বের সৃষ্টিরহস্য');
    assert.strictEqual(typeof text, 'string');
    assert.ok(text.length >= 20);
  });

  test('verifyGeminiKey returns { valid: true, model: string, message: string } with mocked key', async () => {
    const result = await ai.verifyGeminiKey('AIzaSyDmockValidGeminiKey12345');
    assert.strictEqual(result.valid, true);
    assert.strictEqual(typeof result.model, 'string');
    assert.strictEqual(typeof result.message, 'string');
  });
});

// Helper for authenticated API calls in subsequent suites
async function getTestAuthContext() {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'susantalohr@gmail.com', password: 'admin@123' })
  });
  const data = await loginRes.json();
  const cookie = loginRes.headers.get('set-cookie').split(';')[0];
  return { cookie, csrfToken: data.csrfToken };
}

// =========================================================================
// SUITE 11: PAGE DNA DATA MODEL, VALIDATION & NORMALIZATION
// =========================================================================
describe('11. Page DNA Data Model, Validation & Normalization', () => {
  test('createDefaultContentProfile returns valid defaults with mix total 100 and manual approval', () => {
    const profile = createDefaultContentProfile();
    assert.strictEqual(profile.schemaVersion, 1);
    assert.strictEqual(profile.primaryGoal, 'engagement');
    assert.strictEqual(profile.approvalMode, 'manual');
    const mixTotal = Object.values(profile.contentMix).reduce((a, b) => a + b, 0);
    assert.strictEqual(mixTotal, 100);
    assert.strictEqual(profile.maxPostsPerDay, 3);
    assert.strictEqual(profile.minimumPostGapMinutes, 180);
    assert.strictEqual(calculateOnboardingStatus(profile), 'not_started');
  });

  test('validateContentProfile rejects prototype pollution and forbidden keys', () => {
    const malicious = JSON.parse('{"__proto__": {"polluted": true}, "niche": "Tech"}');
    const res = validateContentProfile(malicious);
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.some(e => e.code === 'PROHIBITED_KEY'));

    const constructorAttack = { constructor: { prototype: { admin: true } } };
    const res2 = validateContentProfile(constructorAttack);
    assert.strictEqual(res2.valid, false);
    assert.ok(res2.errors.some(e => e.code === 'PROHIBITED_KEY'));
  });

  test('validateContentProfile rejects unknown fields', () => {
    const res = validateContentProfile({ niche: 'Science', maliciousExtraField: 123 });
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.some(e => e.code === 'UNKNOWN_FIELD'));
  });

  test('validateContentProfile rejects invalid mix sums not equal to 100', () => {
    const res = validateContentProfile({
      niche: 'History',
      contentMix: { educational: 60, community: 30, authority: 20, promotional: 10, timely: 10 }
    });
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.some(e => e.code === 'SUM_NOT_100'));
  });

  test('validateContentProfile rejects inverted caption lengths (min > max)', () => {
    const res = validateContentProfile({
      niche: 'Cooking',
      preferredCaptionLength: { min: 1000, max: 200 }
    });
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.some(e => e.code === 'INVALID_RANGE'));
  });

  test('validateContentProfile rejects negative bounds for emojis and hashtags', () => {
    const res = validateContentProfile({
      niche: 'Education',
      emojiLimit: -5,
      hashtagLimit: -2
    });
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.some(e => e.code === 'OUT_OF_RANGE'));
  });

  test('validateContentProfile rejects duplicate pillar titles (case-insensitive)', () => {
    const res = validateContentProfile({
      niche: 'Fitness',
      contentPillars: [
        { title: 'Workout Tips', weight: 30 },
        { title: 'workout tips', weight: 30 }
      ]
    });
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.some(e => e.code === 'DUPLICATE_PILLAR'));
  });

  test('normalizeContentProfile clamps values, bounds strings, and cleans control chars', () => {
    const raw = {
      niche: '  Bengali Recipes\x00\x08  ',
      emojiLimit: 999,
      hashtagLimit: -5,
      preferredCaptionLength: { min: 10, max: 99999 },
      contentMix: { educational: 50, community: 50, authority: 50, promotional: 0, timely: 0 }
    };
    const norm = normalizeContentProfile(raw);
    assert.strictEqual(norm.niche, 'Bengali Recipes');
    assert.strictEqual(norm.emojiLimit, 10);
    assert.strictEqual(norm.hashtagLimit, 0);
    assert.strictEqual(norm.preferredCaptionLength.min, 100);
    assert.strictEqual(norm.preferredCaptionLength.max, 6000);
    const sum = Object.values(norm.contentMix).reduce((a, b) => a + b, 0);
    assert.strictEqual(sum, 100);
  });

  test('calculateOnboardingStatus transitions through not_started, incomplete, and complete', () => {
    assert.strictEqual(calculateOnboardingStatus(createDefaultContentProfile()), 'not_started');

    const incomplete = { ...createDefaultContentProfile(), niche: 'Government Jobs' };
    assert.strictEqual(calculateOnboardingStatus(incomplete), 'incomplete');

    const complete = {
      ...createDefaultContentProfile(),
      niche: 'Government Jobs',
      tone: ['helpful', 'credible'],
      audience: { locations: ['Kolkata', 'Howrah'] },
      contentPillars: [
        { title: 'Mock Tests', weight: 30 },
        { title: 'Previous Years Papers', weight: 30 },
        { title: 'General Studies Notes', weight: 40 }
      ]
    };
    assert.strictEqual(calculateOnboardingStatus(complete), 'complete');
  });

  test('buildPublicContentProfile defends against external input mutation', () => {
    const input = {
      niche: 'Travel Guide',
      audience: { locations: ['Darjeeling', 'Digha'] },
      contentPillars: [{ title: 'Budget Trips', weight: 50 }]
    };
    const publicProfile = buildPublicContentProfile(input);
    input.audience.locations.push('Malda');
    input.niche = 'Hacked Niche';
    assert.strictEqual(publicProfile.niche, 'Travel Guide');
    assert.deepStrictEqual(publicProfile.audience.locations, ['Darjeeling', 'Digha']);
    assert.strictEqual(publicProfile.onboardingStatus, 'incomplete');
  });
});

// =========================================================================
// SUITE 12: PAGE DNA AUTHENTICATED REST API & CSRF DEFENSE
// =========================================================================
describe('12. Page DNA Authenticated REST API & CSRF Defense', () => {
  let authCookie = '';
  let validCsrf = '';
  let testPageId = '';

  before(async () => {
    const auth = await getTestAuthContext();
    authCookie = auth.cookie;
    validCsrf = auth.csrfToken;

    const pages = storage.getConnectedPages();
    testPageId = pages[0]?.id || 'page_dna_test_101';
    if (!pages.find(p => p.id === testPageId)) {
      storage.addConnectedPage({
        id: testPageId,
        name: 'DNA Integration Test Page',
        category: 'Education',
        accessToken: 'EAADemoMockToken'
      });
    }
  });

  test('GET /api/facebook/pages/:id/content-profile returns 401 unauthenticated', async () => {
    const res = await fetch(`${baseUrl}/api/facebook/pages/${testPageId}/content-profile`);
    assert.strictEqual(res.status, 401);
  });

  test('GET /api/facebook/pages/:id/content-profile returns 404 for non-existent page', async () => {
    const res = await fetch(`${baseUrl}/api/facebook/pages/non_existent_page_99999/content-profile`, {
      headers: { Cookie: authCookie }
    });
    assert.strictEqual(res.status, 404);
  });

  test('GET /api/facebook/pages/:id/content-profile returns profile and status when authenticated', async () => {
    const res = await fetch(`${baseUrl}/api/facebook/pages/${testPageId}/content-profile`, {
      headers: { Cookie: authCookie }
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.ok(data.contentProfile);
    assert.ok(data.onboardingStatus);
    assert.strictEqual(typeof data.contentProfile.schemaVersion, 'number');
  });

  test('PUT /api/facebook/pages/:id/content-profile fails with 403 when CSRF token is missing', async () => {
    const res = await fetch(`${baseUrl}/api/facebook/pages/${testPageId}/content-profile`, {
      method: 'PUT',
      headers: { Cookie: authCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ niche: 'Science & Cosmos' })
    });
    assert.strictEqual(res.status, 403);
  });

  test('PUT /api/facebook/pages/:id/content-profile rejects invalid profile with 400 and validation errors', async () => {
    const res = await fetch(`${baseUrl}/api/facebook/pages/${testPageId}/content-profile`, {
      method: 'PUT',
      headers: {
        Cookie: authCookie,
        'X-CSRF-Token': validCsrf,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        niche: 'Physics Lab',
        contentMix: { educational: 90, community: 90, authority: 0, promotional: 0, timely: 0 }
      })
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.ok(Array.isArray(data.errors));
    assert.ok(data.errors.some(e => e.code === 'SUM_NOT_100'));
  });

  test('PUT /api/facebook/pages/:id/content-profile saves valid profile with valid cookie and CSRF token', async () => {
    const updatePayload = {
      niche: 'Bengali Literature & Culture',
      nicheDescription: 'Exploring the rich heritage of Bengali poetry and prose',
      primaryGoal: 'authority',
      language: 'bn',
      tone: ['inspiring', 'credible'],
      audience: { locations: ['West Bengal'], knowledgeLevel: 'intermediate' },
      contentPillars: [
        { title: 'Rabindrasangeet Analysis', weight: 40 },
        { title: 'Classic Novels Review', weight: 30 },
        { title: 'Poetry Recitations', weight: 30 }
      ],
      contentMix: { educational: 50, community: 20, authority: 20, promotional: 5, timely: 5 },
      approvalMode: 'manual',
      maxPostsPerDay: 2,
      minimumPostGapMinutes: 240
    };

    const res = await fetch(`${baseUrl}/api/facebook/pages/${testPageId}/content-profile`, {
      method: 'PUT',
      headers: {
        Cookie: authCookie,
        'X-CSRF-Token': validCsrf,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updatePayload)
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.contentProfile.niche, 'Bengali Literature & Culture');
    assert.strictEqual(data.onboardingStatus, 'complete');

    const profileInDb = storage.getPageProfile(testPageId);
    assert.strictEqual(profileInDb.niche, 'Bengali Literature & Culture');
    assert.strictEqual(profileInDb.approvalMode, 'manual');
  });

  test('POST /api/facebook/pages/:id/content-profile/validate dry-run returns validation without modifying database', async () => {
    const res = await fetch(`${baseUrl}/api/facebook/pages/${testPageId}/content-profile/validate`, {
      method: 'POST',
      headers: {
        Cookie: authCookie,
        'X-CSRF-Token': validCsrf,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        niche: 'Astronomy & Astrophysics',
        contentMix: { educational: 40, community: 20, authority: 20, promotional: 10, timely: 10 }
      })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.valid, true);

    const profileInDb = storage.getPageProfile(testPageId);
    assert.strictEqual(profileInDb.niche, 'Bengali Literature & Culture');
  });

  test('POST /api/facebook/pages/:id/content-profile/reset requires { confirm: true } and resets profile', async () => {
    const rejectRes = await fetch(`${baseUrl}/api/facebook/pages/${testPageId}/content-profile/reset`, {
      method: 'POST',
      headers: {
        Cookie: authCookie,
        'X-CSRF-Token': validCsrf,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });
    assert.strictEqual(rejectRes.status, 400);

    const okRes = await fetch(`${baseUrl}/api/facebook/pages/${testPageId}/content-profile/reset`, {
      method: 'POST',
      headers: {
        Cookie: authCookie,
        'X-CSRF-Token': validCsrf,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ confirm: true })
    });
    assert.strictEqual(okRes.status, 200);
    const okData = await okRes.json();
    assert.strictEqual(okData.success, true);
    assert.strictEqual(okData.onboardingStatus, 'not_started');

    const resetProfile = storage.getPageProfile(testPageId);
    assert.strictEqual(resetProfile.niche, 'Education');
  });
});

// =========================================================================
// SUITE 13: PAGE CONTEXT BUILDER & STRICT PROMPT HIERARCHY
// =========================================================================
describe('13. Page Context Builder & Strict Prompt Hierarchy', () => {
  test('buildPageContext places safety directives and prohibited topics at top of system instructions', () => {
    const profile = {
      ...createDefaultContentProfile(),
      niche: 'West Bengal Govt Job Prep',
      blockedTopics: ['gambling', 'casino', 'betting'],
      blockedClaims: ['100% selection guaranteed']
    };

    const ctx = buildPageContext({
      page: { id: 'p1', name: 'WB Exam Guide' },
      contentProfile: profile,
      category: 'শিক্ষা ও চাকরি প্রস্তুতি',
      objective: 'WBCS 2026 Notification update'
    });

    assert.ok(ctx.systemInstruction.indexOf('[SYSTEM SAFETY DIRECTIVE') !== -1);
    assert.ok(ctx.systemInstruction.indexOf('gambling') !== -1);
    assert.ok(ctx.systemInstruction.indexOf('100% selection guaranteed') !== -1);

    const safetyIndex = ctx.systemInstruction.indexOf('[SYSTEM SAFETY DIRECTIVE');
    const personaIndex = ctx.systemInstruction.indexOf('[PAGE DNA & BRAND PERSONA');
    assert.ok(safetyIndex < personaIndex, 'Safety directives must strictly precede Page Persona');
  });

  test('buildPageContext places verified fact pack above operator instructions', () => {
    const factPack = 'Fact 1: Exam date is 15th December 2026. Source: wbpsc.gov.in';
    const ctx = buildPageContext({
      page: { id: 'p1', name: 'WB Exam Guide', systemPrompt: 'Always end with Best Wishes' },
      contentProfile: createDefaultContentProfile(),
      category: 'শিক্ষা',
      verifiedFactPack: factPack,
      objective: 'পরীক্ষার নোটিশ'
    });

    const factIndex = ctx.systemInstruction.indexOf('[VERIFIED GROUND TRUTH');
    const operatorIndex = ctx.systemInstruction.indexOf('[PAGE OWNER CUSTOM PREFERENCES');
    assert.ok(factIndex !== -1, 'Verified ground truth section must exist');
    assert.ok(operatorIndex !== -1, 'Operator section must exist');
    assert.ok(factIndex < operatorIndex, 'Fact pack must precede operator instructions');
  });

  test('buildPageContext enforces 8000 character maximum budget on system instructions', () => {
    const hugeNiche = 'A'.repeat(10000);
    const ctx = buildPageContext({
      page: { id: 'p1', name: 'WB Exam Guide' },
      contentProfile: { ...createDefaultContentProfile(), niche: hugeNiche },
      category: 'Science'
    });

    assert.ok(ctx.systemInstruction.length <= 8000, `Length ${ctx.systemInstruction.length} exceeded 8000 limit`);
  });

  test('buildPageContext sanitizes non-printable control characters from operator input', () => {
    const dirtyObjective = 'Special Topic\x00\x08\x0B with malicious control chars\x1F';
    const ctx = buildPageContext({
      page: { id: 'p1', name: 'Test Page' },
      contentProfile: createDefaultContentProfile(),
      category: 'General',
      objective: dirtyObjective
    });

    assert.strictEqual(ctx.systemInstruction.includes('\x00'), false);
    assert.strictEqual(ctx.systemInstruction.includes('\x08'), false);
    assert.strictEqual(ctx.userPromptContext.includes('\x00'), false);
  });

  test('buildPageContext selects pillar with rotation or weight distribution', () => {
    const pillars = [
      { id: 'p1', title: 'Mathematics Tricks', weight: 50 },
      { id: 'p2', title: 'English Grammar', weight: 50 }
    ];
    const profile = { ...createDefaultContentProfile(), contentPillars: pillars };
    const ctx = buildPageContext({
      page: { id: 'page_1' },
      contentProfile: profile,
      recentHistory: [{ contentPillarId: 'p1' }]
    });

    assert.strictEqual(ctx.selectedPillar.id, 'p2');
    assert.strictEqual(ctx.selectedPillar.title, 'English Grammar');
  });

  test('buildPageContext chooses content mix type matching profile distribution', () => {
    const ctx = buildPageContext({
      page: { id: 'page_1' },
      contentProfile: createDefaultContentProfile()
    });

    const allowedTypes = ['educational', 'community', 'authority', 'promotional', 'timely'];
    assert.ok(allowedTypes.includes(ctx.contentType));
  });
});

// =========================================================================
// SUITE 14: PROFILE PUBLISHING POLICIES & SCHEDULERS
// =========================================================================
describe('14. Profile Publishing Policies & Schedulers', () => {
  test('validateContent flags content matching profile.blockedTopics with BLOCKED_TOPIC_VIOLATION', () => {
    const profile = {
      ...createDefaultContentProfile(),
      blockedTopics: ['betting', 'online casino']
    };

    const res = validateContent(
      { message: 'অনলাইন বেটিং বা betting সাইট থেকে কীভাবে দ্রুত টাকা আয় করবেন জানুন।' },
      { contentProfile: profile }
    );

    assert.strictEqual(res.safe, false);
    assert.ok(res.issueCodes.includes('BLOCKED_TOPIC_VIOLATION'));
    assert.ok(res.reasons.some(r => r.includes('betting')));
  });

  test('validateContent flags content asserting profile.blockedClaims with BLOCKED_CLAIM_VIOLATION', () => {
    const profile = {
      ...createDefaultContentProfile(),
      blockedClaims: ['100% চাকরি নিশ্চিত', '১০০% চাকরি নিশ্চিত', '১০০% গ্যারান্টি']
    };

    const res = validateContent(
      { message: 'আমাদের এই কোর্সে ভর্তি হলেই ১০০% চাকরি নিশ্চিত এবং সরকারি নিয়োগ পাবেন।' },
      { contentProfile: profile }
    );

    assert.strictEqual(res.safe, false);
    assert.ok(res.issueCodes.includes('BLOCKED_CLAIM_VIOLATION'));
    assert.ok(res.reasons.some(r => r.includes('১০০% চাকরি নিশ্চিত')));
  });

  test('validateContent flags announcement without official source under source policy with MISSING_OFFICIAL_SOURCE', () => {
    const profile = {
      ...createDefaultContentProfile(),
      sourcePolicy: { requireOfficialSourceForAnnouncements: true }
    };

    const res = validateContent(
      {
        message: 'বিজ্ঞপ্তি: আগামী মাসের ১০ তারিখে পরীক্ষার তারিখ ঘোষণা করা হয়েছে। এডমিট কার্ড ডাউনলোড শুরু হয়েছে।'
      },
      { contentProfile: profile }
    );

    assert.strictEqual(res.safe, false);
    assert.ok(res.issueCodes.includes('MISSING_OFFICIAL_SOURCE'));
  });

  test('validateContent allows announcement when official source is provided', () => {
    const profile = {
      ...createDefaultContentProfile(),
      sourcePolicy: { requireOfficialSourceForAnnouncements: true }
    };

    const res = validateContent(
      {
        message: 'বিজ্ঞপ্তি: পরীক্ষার তারিখ এবং এডমিট কার্ড ডাউনলোড সংক্রান্ত অফিশিয়াল নির্দেশিকা প্রকাশিত হয়েছে। বিস্তারিত জানতে সঙ্গে থাকুন।',
        sources: [{ url: 'https://wbpsc.gov.in/notice', publisher: 'WBPSC', isOfficial: true }]
      },
      { contentProfile: profile }
    );

    assert.strictEqual(res.safe, true);
    assert.strictEqual(res.issueCodes.includes('MISSING_OFFICIAL_SOURCE'), false);
  });

  test('validateContent flags emoji limit violation against profile.emojiLimit', () => {
    const profile = {
      ...createDefaultContentProfile(),
      emojiLimit: 3
    };

    const res = validateContent(
      { message: 'সুন্দর সকালে পড়াশোনা শুরু করার চমৎকার উপায় 📚 💡 🎯 🚀 ✨ যা আপনার দক্ষতা বাড়াবে।' },
      { contentProfile: profile }
    );

    assert.strictEqual(res.reviewRequired, true);
    assert.ok(res.issueCodes.includes('EXCESSIVE_EMOJIS'));
  });

  test('validateContent flags hashtag limit violation against profile.hashtagLimit', () => {
    const profile = {
      ...createDefaultContentProfile(),
      hashtagLimit: 2
    };

    const res = validateContent(
      { message: 'প্রতিদিনের বিজ্ঞান ভাবনা নিয়ে পড়ুন আজকের পোস্ট। #Science #Astronomy #Physics #Cosmos' },
      { contentProfile: profile }
    );

    assert.strictEqual(res.reviewRequired, true);
    assert.ok(res.issueCodes.includes('EXCESSIVE_HASHTAGS'));
  });

  test('validateContent flags caption length outside profile preferred bounds', () => {
    const profile = {
      ...createDefaultContentProfile(),
      preferredCaptionLength: { min: 200, max: 400 }
    };

    const shortRes = validateContent(
      { message: 'মহাকাশ বিজ্ঞানের নতুন দিগন্ত: জেমস ওয়েব টেলিস্কোপ দূরবর্তী গ্যালাক্সির স্পষ্ট ছবি পাঠিয়েছে।' },
      { contentProfile: profile }
    );
    assert.ok(shortRes.issueCodes.includes('CAPTION_LENGTH_BELOW_PREFERENCE'));

    const longRes = validateContent(
      { message: 'মহাকাশ বিজ্ঞান '.repeat(50) },
      { contentProfile: profile }
    );
    assert.ok(longRes.issueCodes.includes('CAPTION_LENGTH_EXCEEDS_PREFERENCE'));
    assert.strictEqual(longRes.reviewRequired, true);
  });

  test('scheduler.triggerAIAutoPilot holds post for review when approvalMode is manual', async () => {
    let publishCalls = 0;
    const testPageId = 'page_manual_mode_test';
    const manualProfile = {
      ...createDefaultContentProfile(),
      niche: 'West Bengal Education',
      tone: ['helpful', 'credible'],
      audience: { locations: ['Kolkata'] },
      contentPillars: [
        { title: 'Math Tips', weight: 50 },
        { title: 'History Notes', weight: 50 },
        { title: 'General Knowledge', weight: 20 }
      ],
      approvalMode: 'manual'
    };

    storage.addConnectedPage({
      id: testPageId,
      name: 'Manual Approval Test Page',
      category: 'Education',
      contentProfile: manualProfile,
      onboardingStatus: 'complete',
      isActive: true
    });
    storage.saveSettings({ activePageId: testPageId, selectedCategories: ['science_nature'] });

    scheduler.setDependencies({
      ai: {
        generateFullPostBundle: async () => ({
          message: 'বিজ্ঞান ও মহাকাশ গবেষণার নতুন আবিষ্কার মানবজাতিকে নতুন আশার আলো দেখাচ্ছে।',
          categoryId: 'science_nature',
          isFallback: false,
          generationSource: 'ai_generated',
          verified: true,
          riskLevel: 'low',
          sources: [{ url: 'https://nasa.gov', publisher: 'NASA' }]
        })
      },
      facebook: {
        publishPost: async () => { publishCalls++; return { success: true }; }
      }
    });

    const result = await scheduler.triggerAIAutoPilot('science_nature');
    assert.strictEqual(publishCalls, 0, 'publishPost must NOT be called when approvalMode is manual');
    assert.strictEqual(result.reviewRequired, true);
    assert.ok(result.reason.includes('manual'));

    const queue = storage.getQueue();
    const queuedItem = queue[queue.length - 1];
    assert.strictEqual(queuedItem.status, 'review_required');
    assert.strictEqual(queuedItem.approvalMode, 'manual');
  });

  test('scheduler.triggerAIAutoPilot auto-publishes low-risk post when approvalMode is low_risk_auto', async () => {
    let publishCalls = 0;
    const testPageId = 'page_low_risk_mode_test';
    const lowRiskProfile = {
      ...createDefaultContentProfile(),
      niche: 'General Knowledge Hub',
      tone: ['helpful'],
      audience: { locations: ['Bengal'] },
      contentPillars: [
        { title: 'GK Facts', weight: 50 },
        { title: 'Quiz', weight: 30 },
        { title: 'Current Updates', weight: 20 }
      ],
      approvalMode: 'low_risk_auto'
    };

    storage.addConnectedPage({
      id: testPageId,
      name: 'Low Risk Test Page',
      category: 'Education',
      contentProfile: lowRiskProfile,
      onboardingStatus: 'complete',
      isActive: true
    });
    storage.saveSettings({ activePageId: testPageId, selectedCategories: ['science_nature'] });

    scheduler.setDependencies({
      ai: {
        generateFullPostBundle: async () => ({
          message: 'বিজ্ঞান ও পরিবেশ সচেতনতা সংক্রান্ত আলোচনা মানুষের জীবনমান উন্নত করে।',
          categoryId: 'science_nature',
          isFallback: false,
          generationSource: 'ai_generated',
          verified: true,
          riskLevel: 'low',
          strategy: { pillar: 'GK Facts', pillarId: 'pillar_1', contentType: 'educational' },
          sources: [{ url: 'https://nature.com', publisher: 'Nature' }]
        })
      },
      facebook: {
        publishPost: async () => { publishCalls++; return { success: true, postId: 'low_risk_published_1' }; }
      }
    });

    const result = await scheduler.triggerAIAutoPilot('science_nature');
    assert.strictEqual(publishCalls, 1, 'publishPost MUST be called for low-risk content under low_risk_auto');
    assert.strictEqual(result.success, true);

    const history = storage.getHistory();
    const lastHistory = history.find(h => h.postId === 'low_risk_published_1');
    assert.ok(lastHistory);
    assert.strictEqual(lastHistory.riskLevel, 'low');
    assert.strictEqual(lastHistory.contentPillar, 'GK Facts');
  });

  test('scheduler.triggerAIAutoPilot holds medium/high risk post when approvalMode is low_risk_auto', async () => {
    let publishCalls = 0;
    const testPageId = 'page_high_risk_test';
    const lowRiskProfile = {
      ...createDefaultContentProfile(),
      niche: 'Current Affairs',
      tone: ['credible'],
      audience: { locations: ['Kolkata'] },
      contentPillars: [{ title: 'P1', weight: 40 }, { title: 'P2', weight: 30 }, { title: 'P3', weight: 30 }],
      approvalMode: 'low_risk_auto'
    };

    storage.addConnectedPage({
      id: testPageId,
      name: 'High Risk Test Page',
      category: 'News',
      contentProfile: lowRiskProfile,
      onboardingStatus: 'complete',
      isActive: true
    });
    storage.saveSettings({ activePageId: testPageId, selectedCategories: ['science_nature'] });

    scheduler.setDependencies({
      ai: {
        generateFullPostBundle: async () => ({
          message: 'বিজ্ঞানীদের নতুন বিতর্কিত গবেষণার ফলাফল নিয়ে নানা মহলে প্রশ্ন উঠছে।',
          categoryId: 'science_nature',
          isFallback: false,
          generationSource: 'ai_generated',
          verified: true,
          riskLevel: 'medium',
          sources: [{ url: 'https://science.org', publisher: 'Science' }]
        })
      },
      facebook: {
        publishPost: async () => { publishCalls++; return { success: true }; }
      }
    });

    const result = await scheduler.triggerAIAutoPilot('science_nature');
    assert.strictEqual(publishCalls, 0, 'publishPost must not be called for medium-risk under low_risk_auto');
    assert.strictEqual(result.reviewRequired, true);
    assert.ok(result.reason.includes('medium-risk'));
  });

  test('scheduler.triggerAIAutoPilot skips run when maxPostsPerDay is reached', async () => {
    let publishCalls = 0;
    const testPageId = 'page_max_posts_test';
    const limitProfile = {
      ...createDefaultContentProfile(),
      niche: 'Daily Tech',
      tone: ['helpful'],
      audience: { locations: ['India'] },
      contentPillars: [{ title: 'P1', weight: 40 }, { title: 'P2', weight: 30 }, { title: 'P3', weight: 30 }],
      approvalMode: 'low_risk_auto',
      maxPostsPerDay: 2,
      timezone: 'Asia/Kolkata'
    };

    storage.addConnectedPage({
      id: testPageId,
      name: 'Max Posts Test Page',
      category: 'Tech',
      contentProfile: limitProfile,
      onboardingStatus: 'complete',
      isActive: true
    });
    storage.saveSettings({ activePageId: testPageId, selectedCategories: ['tech_inventions'] });

    const nowIso = new Date().toISOString();
    storage.addHistory({ status: 'published', postId: 'post_seed_1', pageId: testPageId, publishedAt: nowIso });
    storage.addHistory({ status: 'published', postId: 'post_seed_2', pageId: testPageId, publishedAt: nowIso });

    scheduler.setDependencies({
      facebook: {
        publishPost: async () => { publishCalls++; return { success: true }; }
      }
    });

    const result = await scheduler.triggerAIAutoPilot('tech_inventions');
    assert.strictEqual(publishCalls, 0, 'publishPost must not be called when daily post limit is reached');
    assert.strictEqual(result.skipped, true);
    assert.ok(result.reason.includes('DAILY_POST_LIMIT_REACHED'));
  });

  test('scheduler.triggerAIAutoPilot skips run when minimumPostGapMinutes cooldown is active', async () => {
    let publishCalls = 0;
    const testPageId = 'page_gap_test';
    const gapProfile = {
      ...createDefaultContentProfile(),
      niche: 'Lifestyle Notes',
      tone: ['friendly'],
      audience: { locations: ['Bengal'] },
      contentPillars: [{ title: 'P1', weight: 40 }, { title: 'P2', weight: 30 }, { title: 'P3', weight: 30 }],
      approvalMode: 'low_risk_auto',
      minimumPostGapMinutes: 120,
      maxPostsPerDay: 10
    };

    storage.addConnectedPage({
      id: testPageId,
      name: 'Gap Test Page',
      category: 'Lifestyle',
      contentProfile: gapProfile,
      onboardingStatus: 'complete',
      isActive: true
    });
    storage.saveSettings({ activePageId: testPageId, selectedCategories: ['science_nature'] });

    const recentTime = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    storage.addHistory({ status: 'published', postId: 'post_recent_1', pageId: testPageId, publishedAt: recentTime });

    scheduler.setDependencies({
      facebook: {
        publishPost: async () => { publishCalls++; return { success: true }; }
      }
    });

    const result = await scheduler.triggerAIAutoPilot('science_nature');
    assert.strictEqual(publishCalls, 0, 'publishPost must not be called when post gap cooldown is active');
    assert.strictEqual(result.skipped, true);
    assert.ok(result.reason.includes('MINIMUM_POST_GAP_ACTIVE'));
  });
});
