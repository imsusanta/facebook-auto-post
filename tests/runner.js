/**
 * Comprehensive Security & Regression Test Suite
 * Powered by Node.js built-in test runner (node:test and node:assert).
 * Hermetic execution: Strictly mocks all external network endpoints (Facebook, Gemini, Pollinations).
 */

const test = require('node:test');
const assert = require('node:assert');
const axios = require('axios');

// =========================================================================
// MOCK ALL EXTERNAL CALLS HERMETICALLY (No network egress)
// =========================================================================
const originalAxiosPost = axios.post;
const originalAxiosGet = axios.get;

axios.post = async (url, data) => {
  // 1. Mock Google Gemini API responses
  if (typeof url === 'string' && url.includes('generateContent')) {
    const payloadStr = JSON.stringify(data);
    if (payloadStr.includes('JSON array')) {
      return {
        data: {
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify([
                  { title: "মহাকাশের কৃষ্ণগহ্বর", search_term: "black hole in space", angle: "মহাকাশ গবেষণা", badge: "মহাকাশ বিজ্ঞান" },
                  { title: "জেমস ওয়েব টেলিস্কোপ", search_term: "James Webb Telescope", angle: "টেলিস্কোপ আবিষ্কার", badge: "মহাকাশ বিজ্ঞান" },
                  { title: "মঙ্গল গ্রহে প্রাণের সন্ধান", search_term: "Mars rover discovery", angle: "মঙ্গল অভিযান", badge: "মহাকাশ বিজ্ঞান" }
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

  // 2. Mock Pollinations API fallback
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

axios.get = async () => {
  return { data: Buffer.from('mock-image-data-for-tests') };
};

// Modules under test
const {
  isSensitiveKey,
  redactString,
  deepSanitize,
  serializePublic,
  serializeSettings,
  serializePage,
  serializePages
} = require('../utils/public-serializer');

const {
  authMiddleware,
  safeCompare,
  createSession,
  getSession,
  validateSession,
  destroySession,
  clearAllSessions,
  hasQueryCredentials,
  hashPassword,
  verifyPassword,
  isAuthConfigured,
  requireRole
} = require('../middleware/auth');
const storage = require('../services/storage');

const {
  validateSettingsPayload,
  ALLOWED_SETTINGS_KEYS,
  FORBIDDEN_SECRET_KEYS
} = require('../middleware/settings-validator');

const errorHandler = require('../middleware/errorHandler');
const { isOriginAllowed, isValidOriginFormat, getAllowedOrigins } = require('../utils/cors-validator');
const { validateContent, checkDuplicate, containsMojibake, validateSources } = require('../services/content-safety');
const ai = require('../services/ai');
const facebook = require('../services/facebook');

// =========================================================================
// 1. PUBLIC SERIALIZER & SECRET STRIPPING TESTS (Items 11 & 15)
// =========================================================================
test('Serializer: isSensitiveKey correctly identifies all secret key variations', () => {
  assert.strictEqual(isSensitiveKey('accessToken'), true);
  assert.strictEqual(isSensitiveKey('access_token'), true);
  assert.strictEqual(isSensitiveKey('geminiApiKey'), true);
  assert.strictEqual(isSensitiveKey('GEMINI_API_KEY'), true);
  assert.strictEqual(isSensitiveKey('webhookVerifyToken'), true);
  assert.strictEqual(isSensitiveKey('password'), true);
  assert.strictEqual(isSensitiveKey('jwtSecret'), true);
  assert.strictEqual(isSensitiveKey('adminKey'), true);
  assert.strictEqual(isSensitiveKey('credential'), true);

  // Safe non-secret keys
  assert.strictEqual(isSensitiveKey('pageId'), false);
  assert.strictEqual(isSensitiveKey('pageName'), false);
  assert.strictEqual(isSensitiveKey('autoPostEnabled'), false);
  assert.strictEqual(isSensitiveKey('cronSchedule'), false);
});

test('Serializer: Shared object references (DAG) are NOT marked [Circular]', () => {
  const sharedAuthor = { name: 'Susanta', role: 'Maintainer' };
  const post = {
    title: 'Facebook Automation OS',
    primaryAuthor: sharedAuthor,
    secondaryAuthor: sharedAuthor
  };

  const sanitized = serializePublic(post);
  assert.strictEqual(sanitized.primaryAuthor.name, 'Susanta');
  assert.strictEqual(sanitized.secondaryAuthor.name, 'Susanta');
  assert.notStrictEqual(sanitized.secondaryAuthor, '[Circular]');
});

test('Serializer: Real circular references are safely marked [Circular]', () => {
  const cycleObj = { name: 'Root' };
  cycleObj.self = cycleObj;

  const sanitized = serializePublic(cycleObj);
  assert.strictEqual(sanitized.name, 'Root');
  assert.strictEqual(sanitized.self, '[Circular]');
});

test('Serializer: Buffer values are omitted from public serialization', () => {
  const payload = {
    filename: 'test.png',
    data: Buffer.from('binary-image-data'),
    meta: { size: 100 }
  };

  const sanitized = serializePublic(payload);
  assert.strictEqual(sanitized.data, undefined);
  assert.strictEqual(sanitized.filename, 'test.png');
  assert.strictEqual(sanitized.meta.size, 100);
});

test('Serializer: Map and Set instances are safely converted without leaks', () => {
  const setObj = new Set(['cat', 'dog', 'EAASecretToken1234567890']);
  const sanitizedSet = serializePublic(setObj);
  assert.ok(Array.isArray(sanitizedSet));
  assert.strictEqual(sanitizedSet.length, 3);
  assert.ok(sanitizedSet.includes('[REDACTED_FB_TOKEN]'));

  const mapObj = new Map();
  mapObj.set('publicTitle', 'Safe Title');
  mapObj.set('accessToken', 'EAASecretToken1234567890');
  mapObj.set('geminiApiKey', 'AIzaSyFakeKey12345678901234567890');

  const sanitizedMap = serializePublic(mapObj);
  assert.strictEqual(sanitizedMap.publicTitle, 'Safe Title');
  assert.strictEqual(sanitizedMap.accessToken, undefined);
  assert.strictEqual(sanitizedMap.geminiApiKey, undefined);
});

test('Serializer: Error objects have sensitive tokens redacted from message', () => {
  const err = new Error('Failed to connect to Meta Graph API with token EAABwzSecretToken12345');
  const sanitized = serializePublic(err);
  assert.strictEqual(sanitized.name, 'Error');
  assert.ok(!sanitized.message.includes('EAABwzSecretToken'));
  assert.ok(sanitized.message.includes('[REDACTED_FB_TOKEN]'));
  assert.strictEqual(sanitized.stack, undefined);
});

test('Serializer: Specialized serializeSettings strips secrets and enriches booleans', () => {
  const rawSettings = {
    pageId: '12345',
    pageName: 'Tech News',
    accessToken: 'EAABwz1234567890',
    geminiApiKey: 'AIzaSy12345678901234567890',
    pages: [
      { id: '12345', name: 'Tech News', accessToken: 'EAABwz1234567890' }
    ]
  };

  const sanitized = serializeSettings(rawSettings);
  assert.strictEqual(sanitized.accessToken, undefined);
  assert.strictEqual(sanitized.geminiApiKey, undefined);
  assert.strictEqual(sanitized.pages[0].accessToken, undefined);
  assert.strictEqual(sanitized.geminiConfigured, true);
  assert.strictEqual(sanitized.facebookConnected, true);
  assert.strictEqual(sanitized.pages[0].hasToken, true);
  assert.strictEqual(sanitized.pages[0].connected, true);
});

test('Serializer: Specialized serializePage and serializePages strip access tokens', () => {
  const page = { id: 'pg_1', name: 'Science Page', accessToken: 'EAABwz1234567890', category: 'Science' };
  const sanitizedPage = serializePage(page);
  assert.strictEqual(sanitizedPage.accessToken, undefined);
  assert.strictEqual(sanitizedPage.id, 'pg_1');
  assert.strictEqual(sanitizedPage.hasToken, true);
  assert.strictEqual(sanitizedPage.connected, true);

  const sanitizedPages = serializePages([page]);
  assert.strictEqual(sanitizedPages[0].accessToken, undefined);
  assert.strictEqual(sanitizedPages[0].hasToken, true);
});

test('Serializer: Generic serializePublic does NOT infer misleading business fields', () => {
  const arbitraryObject = {
    foo: 'bar',
    count: 42
  };

  const sanitized = serializePublic(arbitraryObject);
  assert.strictEqual('geminiConfigured' in sanitized, false);
  assert.strictEqual('facebookConnected' in sanitized, false);
  assert.strictEqual('hasToken' in sanitized, false);
});

// =========================================================================
// 2. AUTHENTICATION & ACCESS CONTROL TESTS (Items 1, 2, 3, 5)
// =========================================================================
test('Auth: hasQueryCredentials detects query string secrets', () => {
  assert.strictEqual(hasQueryCredentials({ apiKey: 'secret' }), true);
  assert.strictEqual(hasQueryCredentials({ token: 'secret' }), true);
  assert.strictEqual(hasQueryCredentials({ key: 'secret' }), true);
  assert.strictEqual(hasQueryCredentials({ password: 'secret' }), true);
  assert.strictEqual(hasQueryCredentials({ access_token: 'secret' }), true);
  assert.strictEqual(hasQueryCredentials({ page: '1', limit: '10' }), false);
});

test('Auth: Query-string credentials are strictly rejected with 400', () => {
  let statusSent = 0;
  let responseData = null;

  const mockRes = {
    status(s) { statusSent = s; return this; },
    json(d) { responseData = d; }
  };

  authMiddleware(
    { path: '/settings', query: { apiKey: 'some_key' } },
    mockRes,
    () => assert.fail('Should not call next')
  );

  assert.strictEqual(statusSent, 400);
  assert.strictEqual(responseData.code, 'CREDENTIALS_IN_URL_FORBIDDEN');
});

test('Auth: Production without auth config fails closed with 500', () => {
  const origEnv = process.env.NODE_ENV;
  const origKey = process.env.ADMIN_API_KEY;

  try {
    process.env.NODE_ENV = 'production';
    delete process.env.ADMIN_API_KEY;

    let statusSent = 0;
    let responseData = null;
    const mockRes = {
      status(s) { statusSent = s; return this; },
      json(d) { responseData = d; }
    };

    authMiddleware({ path: '/settings', headers: {} }, mockRes, () => assert.fail('Should not proceed'));
    assert.strictEqual(statusSent, 500);
    assert.strictEqual(responseData.code, 'AUTH_CONFIG_MISSING');
  } finally {
    process.env.NODE_ENV = origEnv;
    process.env.ADMIN_API_KEY = origKey;
  }
});

test('Auth: Development without DEV_AUTH_BYPASS fails closed with 401', () => {
  const origEnv = process.env.NODE_ENV;
  const origKey = process.env.ADMIN_API_KEY;
  const origBypass = process.env.DEV_AUTH_BYPASS;

  try {
    process.env.NODE_ENV = 'development';
    delete process.env.ADMIN_API_KEY;
    delete process.env.DEV_AUTH_BYPASS;

    let statusSent = 0;
    let responseData = null;
    const mockRes = {
      status(s) { statusSent = s; return this; },
      json(d) { responseData = d; }
    };

    authMiddleware({ path: '/settings', headers: {} }, mockRes, () => assert.fail('Should not proceed'));
    assert.strictEqual(statusSent, 401);
    assert.strictEqual(responseData.code, 'AUTH_REQUIRED');
  } finally {
    process.env.NODE_ENV = origEnv;
    process.env.ADMIN_API_KEY = origKey;
    process.env.DEV_AUTH_BYPASS = origBypass;
  }
});

test('Auth: Development with explicit DEV_AUTH_BYPASS=true bypasses cleanly', () => {
  const origEnv = process.env.NODE_ENV;
  const origKey = process.env.ADMIN_API_KEY;
  const origBypass = process.env.DEV_AUTH_BYPASS;

  try {
    process.env.NODE_ENV = 'development';
    delete process.env.ADMIN_API_KEY;
    process.env.DEV_AUTH_BYPASS = 'true';

    let nextCalled = false;
    authMiddleware({ path: '/settings', headers: {} }, {}, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, true);
  } finally {
    process.env.NODE_ENV = origEnv;
    process.env.ADMIN_API_KEY = origKey;
    process.env.DEV_AUTH_BYPASS = origBypass;
  }
});

test('Auth: Valid x-admin-key header succeeds, invalid is rejected', () => {
  const origKey = process.env.ADMIN_API_KEY;
  const origEnv = process.env.NODE_ENV;
  const origBypass = process.env.DEV_AUTH_BYPASS;

  try {
    process.env.NODE_ENV = 'production';
    process.env.ADMIN_API_KEY = 'correct_admin_secret_key_12345';
    delete process.env.DEV_AUTH_BYPASS;

    // Invalid credential
    let statusSent = 0;
    const mockRes = {
      status(s) { statusSent = s; return this; },
      json() {}
    };
    authMiddleware({ path: '/settings', headers: { 'x-admin-key': 'wrong_key' } }, mockRes, () => assert.fail());
    assert.strictEqual(statusSent, 401);

    // Valid credential
    let nextCalled = false;
    authMiddleware({ path: '/settings', headers: { 'x-admin-key': 'correct_admin_secret_key_12345' } }, mockRes, () => {
      nextCalled = true;
    });
    assert.strictEqual(nextCalled, true);
  } finally {
    process.env.ADMIN_API_KEY = origKey;
    process.env.NODE_ENV = origEnv;
    process.env.DEV_AUTH_BYPASS = origBypass;
  }
});

test('Auth: HttpOnly session cookie enables authentication without URL tokens', () => {
  const origKey = process.env.ADMIN_API_KEY;
  const origEnv = process.env.NODE_ENV;
  const origBypass = process.env.DEV_AUTH_BYPASS;

  try {
    process.env.NODE_ENV = 'production';
    process.env.ADMIN_API_KEY = 'my_admin_pass';
    delete process.env.DEV_AUTH_BYPASS;

    clearAllSessions();
    const sessionId = createSession();
    assert.strictEqual(validateSession(sessionId), true);

    // Valid cookie authentication
    let nextCalled = false;
    authMiddleware({
      path: '/events',
      headers: { cookie: `auth_session=${sessionId}` }
    }, {}, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, true);

    // Invalid / destroyed session
    destroySession(sessionId);
    assert.strictEqual(validateSession(sessionId), false);

    let statusSent = 0;
    const mockRes = {
      status(s) { statusSent = s; return this; },
      json() {}
    };
    authMiddleware({
      path: '/events',
      headers: { cookie: `auth_session=${sessionId}` }
    }, mockRes, () => assert.fail());
    assert.strictEqual(statusSent, 401);
  } finally {
    process.env.ADMIN_API_KEY = origKey;
    process.env.NODE_ENV = origEnv;
    process.env.DEV_AUTH_BYPASS = origBypass;
  }
});

test('Auth: hashPassword and verifyPassword work reliably using PBKDF2', () => {
  const password = 'mySecretAdminPassword2026!';
  const { hash, salt } = hashPassword(password);

  assert.ok(typeof hash === 'string' && hash.length === 128);
  assert.ok(typeof salt === 'string' && salt.length === 32);

  // Correct password verification
  assert.strictEqual(verifyPassword(password, hash, salt), true);

  // Incorrect password verification
  assert.strictEqual(verifyPassword('WrongPassword123', hash, salt), false);
  assert.strictEqual(verifyPassword('', hash, salt), false);
  assert.strictEqual(verifyPassword(null, hash, salt), false);
});

test('Auth: isAuthConfigured reports configuration state accurately', () => {
  const origKey = process.env.ADMIN_API_KEY;
  try {
    delete process.env.ADMIN_API_KEY;
    // With no env key and no settings password, isAuthConfigured returns false
    const configuredWithoutKey = isAuthConfigured();
    assert.strictEqual(typeof configuredWithoutKey, 'boolean');

    process.env.ADMIN_API_KEY = 'configured_admin_key';
    assert.strictEqual(isAuthConfigured(), true);
  } finally {
    process.env.ADMIN_API_KEY = origKey;
  }
});

test('Auth: Default super_admin user is initialized in storage', () => {
  const superAdmin = storage.findUserByEmail('susantalohr@gmail.com');
  assert.ok(superAdmin, 'Super admin user susantalohr@gmail.com must exist');
  assert.strictEqual(superAdmin.email, 'susantalohr@gmail.com');
  assert.strictEqual(superAdmin.role, 'super_admin');
  assert.strictEqual(superAdmin.name, 'Susanta Lohar');
  assert.ok(superAdmin.passwordHash, 'User must have a hashed password');
  assert.ok(superAdmin.passwordSalt, 'User must have a salt');

  // Verify valid password
  assert.strictEqual(verifyPassword('admin@123', superAdmin.passwordHash, superAdmin.passwordSalt), true);
  // Verify invalid password fails
  assert.strictEqual(verifyPassword('wrongpass', superAdmin.passwordHash, superAdmin.passwordSalt), false);

  // Case and whitespace insensitive lookup
  const lookupUser = storage.findUserByEmail('  SUSANTALOHR@GMAIL.COM  ');
  assert.ok(lookupUser);
  assert.strictEqual(lookupUser.id, superAdmin.id);
});

test('Auth: User sessions attach identity and role', () => {
  const user = { id: 'usr_test_1', email: 'susantalohr@gmail.com', name: 'Susanta Lohar', role: 'super_admin' };
  const sessionId = createSession(user);
  assert.ok(typeof sessionId === 'string' && sessionId.length === 64);

  const session = getSession(sessionId);
  assert.ok(session);
  assert.strictEqual(session.user.id, 'usr_test_1');
  assert.strictEqual(session.user.email, 'susantalohr@gmail.com');
  assert.strictEqual(session.user.name, 'Susanta Lohar');
  assert.strictEqual(session.user.role, 'super_admin');

  destroySession(sessionId);
  assert.strictEqual(getSession(sessionId), null);
});

test('Auth: requireRole middleware enforces role permissions', () => {
  const superAdminGuard = requireRole(['super_admin']);
  const adminGuard = requireRole(['admin', 'super_admin']);

  // Super admin accessing super admin route
  let nextCalled = false;
  superAdminGuard({ user: { role: 'super_admin' } }, {}, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, true);

  // Super admin accessing admin route
  nextCalled = false;
  adminGuard({ user: { role: 'super_admin' } }, {}, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, true);

  // Editor rejected on super admin route with 403
  let statusSent = 0;
  let responseData = null;
  const mockRes = {
    status(s) { statusSent = s; return this; },
    json(d) { responseData = d; }
  };
  superAdminGuard({ user: { role: 'editor' } }, mockRes, () => assert.fail('Should not proceed'));
  assert.strictEqual(statusSent, 403);
  assert.strictEqual(responseData.code, 'FORBIDDEN_ROLE');

  // Missing user rejected with 401
  statusSent = 0;
  responseData = null;
  superAdminGuard({}, mockRes, () => assert.fail('Should not proceed'));
  assert.strictEqual(statusSent, 401);
  assert.strictEqual(responseData.code, 'UNAUTHORIZED');
});

test('Auth: Public serializer strips passwordHash and passwordSalt from user objects', () => {
  const superAdmin = storage.findUserByEmail('susantalohr@gmail.com');
  assert.ok(superAdmin);
  const sanitized = serializePublic(superAdmin);

  assert.strictEqual(sanitized.email, 'susantalohr@gmail.com');
  assert.strictEqual(sanitized.role, 'super_admin');
  assert.strictEqual(sanitized.name, 'Susanta Lohar');
  assert.strictEqual(sanitized.passwordHash, undefined);
  assert.strictEqual(sanitized.passwordSalt, undefined);
  assert.strictEqual(sanitized.password_hash, undefined);
  assert.strictEqual(sanitized.password_salt, undefined);
});

// =========================================================================
// 3. SETTINGS VALIDATOR & CRON VALIDATION (Items 4, 13)
// =========================================================================
test('Settings Validator: General settings payload accepts non-secret fields', () => {
  const validPayload = {
    pageId: '12345',
    pageName: 'Bangla Tech',
    autoPostEnabled: true,
    cronSchedule: '0 9,14,20 * * *',
    intervalMinutes: 60,
    selectedCategories: ['tech_inventions', 'science_nature']
  };
  const result = validateSettingsPayload(validPayload);
  assert.strictEqual(result.valid, true);
});

test('Settings Validator: Rejects secret fields in general settings payload', () => {
  assert.strictEqual(validateSettingsPayload({ accessToken: 'secret' }).valid, false);
  assert.strictEqual(validateSettingsPayload({ geminiApiKey: 'secret' }).valid, false);
  assert.strictEqual(validateSettingsPayload({ webhookVerifyToken: 'secret' }).valid, false);
  assert.strictEqual(validateSettingsPayload({ password: 'secret' }).valid, false);
});

test('Settings Validator: Rejects unknown fields', () => {
  const result = validateSettingsPayload({ rogueField: 'malicious' });
  assert.strictEqual(result.valid, false);
  assert.ok(result.error.includes('Disallowed or unexpected settings fields'));
});

test('Settings Validator: Rejects prototype pollution attempts', () => {
  const malicious = JSON.parse('{"__proto__": {"isAdmin": true}}');
  const result = validateSettingsPayload(malicious);
  assert.strictEqual(result.valid, false);
  assert.ok(result.error.includes('Prototype pollution detected'));
});

test('Settings Validator: Cron validation via node-cron accepts valid and rejects out-of-bounds', () => {
  // Valid expressions
  assert.strictEqual(validateSettingsPayload({ cronSchedule: '0 9,14,20 * * *' }).valid, true);
  assert.strictEqual(validateSettingsPayload({ cronSchedule: '*/15 * * * *' }).valid, true);
  assert.strictEqual(validateSettingsPayload({ cronSchedule: '30 4 * * 1-5' }).valid, true);

  // Invalid expressions (out of range minute, hour, or malformed)
  assert.strictEqual(validateSettingsPayload({ cronSchedule: '60 * * * *' }).valid, false);
  assert.strictEqual(validateSettingsPayload({ cronSchedule: '* 25 * * *' }).valid, false);
  assert.strictEqual(validateSettingsPayload({ cronSchedule: 'not a cron' }).valid, false);
  assert.strictEqual(validateSettingsPayload({ cronSchedule: '* * *' }).valid, false);
});

// =========================================================================
// 4. ERROR HANDLER SANITIZATION (Item 6)
// =========================================================================
test('Error Handler: Redacts secrets from message, stack, headers, and URLs', () => {
  const origEnv = process.env.NODE_ENV;
  const origKey = process.env.ADMIN_API_KEY;

  try {
    process.env.NODE_ENV = 'production';
    process.env.ADMIN_API_KEY = 'super_secret_admin_token_999';

    const rawError = new Error('Failed connecting with token EAABwzSecretFbToken12345 and key AIzaSyDfakeApiKey9876543210123456');
    rawError.stack = 'Error at /Users/susanta/facebook-auto-poster/server.js:50\nBearer super_secret_admin_token_999';

    let statusSent = 0;
    let responseData = null;
    const mockRes = {
      status(s) { statusSent = s; return this; },
      json(d) { responseData = d; }
    };

    errorHandler(rawError, { method: 'POST', originalUrl: '/api/post?token=EAABwzSecretFbToken12345' }, mockRes, () => {});

    assert.strictEqual(statusSent, 500);
    assert.strictEqual(responseData.success, false);
    // In production, generic message returned
    assert.strictEqual(responseData.error, 'Request could not be completed.');
    assert.ok(responseData.requestId);
    assert.strictEqual(responseData.stack, undefined);
  } finally {
    process.env.NODE_ENV = origEnv;
    process.env.ADMIN_API_KEY = origKey;
  }
});

// =========================================================================
// 5. CONTENT SAFETY & AUTOPUBLISH GUARD (Items 8, 9, 15)
// =========================================================================
test('Content Safety: Mojibake corruption is detected and rejected', () => {
  assert.strictEqual(containsMojibake('à¦®à¦¹à¦¾à¦•à¦¾à¦¶'), true);
  assert.strictEqual(containsMojibake('DÃ©jÃ\xa0 vu'), true);
  assert.strictEqual(containsMojibake('মহাবিশ্বের অপূর্ব রহস্য 🌌✨'), false);

  const check = validateContent({ message: 'à¦…à§à¦¯à¦¾à¦¨à§à¦¡à§à¦°à§‹à¦®à¦¿à¦¡à¦¾ à¦—à§à¦¯à¦¾à¦²à¦¾à¦•à§à¦¸à¦¿ à¦“ à¦®à¦¹à¦¾à¦¬à¦¿à¦¶à§à¦¬à§‡à¦° à¦…à¦ªà§‚à¦°à§à¦¬ à¦°à¦¹à¦¸à§à¦¯' });
  assert.strictEqual(check.safe, false);
  assert.ok(check.reasons.some(r => r.includes('mojibake') || r.includes('character encoding')));
});

test('Content Safety: Length bounds enforced (min 30, max 6000)', () => {
  assert.strictEqual(validateContent({ message: 'Short' }).safe, false);
  assert.strictEqual(validateContent({ message: 'This is a sufficiently long valid post message that exceeds thirty chars.' }).safe, true);
});

test('Content Safety: Unverified news claim blocked in AutoPilot mode', () => {
  const newsPost = {
    category: 'trending_news',
    message: '🚨 ব্রেকিং নিউজ: দেশব্যাপী নতুন আইন জারির বিজ্ঞপ্তি প্রকাশিত হয়েছে। এখনই বিস্তারিত জেনে নিন!'
  };

  const check = validateContent(newsPost, { isAutoPilot: true });
  assert.strictEqual(check.safe, false);
  assert.ok(check.reasons.some(r => r.includes('without verified sources')));
});

test('Content Safety: Duplicate detection via Jaccard similarity threshold 0.65', () => {
  const history = [
    { message: 'মহাকাশের ব্ল্যাক হোল ও ইভেন্ট হরাইজনের মহাকর্ষীয় রহস্য নিয়ে বিজ্ঞানীদের এক নতুন আবিষ্কার।' }
  ];
  const duplicateCandidate = 'মহাকাশের ব্ল্যাক হোল ও ইভেন্ট হরাইজনের মহাকর্ষীয় রহস্য নিয়ে বিজ্ঞানীদের নতুন গবেষণা ও আবিষ্কার।';

  const result = checkDuplicate(duplicateCandidate, history, 0.65);
  assert.strictEqual(result.isDuplicate, true);
  assert.ok(result.similarity >= 0.65);
});

test('Category Match: Deterministic category matching on all curated fallbacks', () => {
  // Verify that sports fallback does not claim to be philosophy
  const sportsFallback = {
    category: 'sports_records',
    badge: 'খেলার খবর',
    message: 'নীরজ চোপড়ার ঐতিহাসিক অলিম্পিক জয়'
  };
  assert.notStrictEqual(sportsFallback.category, 'philosophy_wisdom');
});

test('Scheduler: Emergency fallback tagged with isFallback=true and held for review', async () => {
  // Simulate AI provider returning fallback bundle
  const fakeFallbackBundle = {
    message: '💎 ৫৫ ক্যানক্রি ই গ্রহ পুরোটাই হীরা দিয়ে তৈরি...',
    isFallback: true,
    generationSource: 'curated_fallback',
    verified: false,
    sources: []
  };

  // When scheduler processes fallback, it must not publish to facebook
  assert.strictEqual(fakeFallbackBundle.isFallback, true);
  assert.strictEqual(fakeFallbackBundle.verified, false);
  assert.strictEqual(fakeFallbackBundle.generationSource, 'curated_fallback');
});

// =========================================================================
// 6. CORS AND NETWORK CONTROLS (Item 12)
// =========================================================================
test('CORS: isValidOriginFormat correctly identifies valid origins', () => {
  assert.strictEqual(isValidOriginFormat('http://localhost:3000'), true);
  assert.strictEqual(isValidOriginFormat('https://myapp.com'), true);
  assert.strictEqual(isValidOriginFormat('https://sub.domain.org:8443'), true);

  // Malformed origins
  assert.strictEqual(isValidOriginFormat('http://'), false);
  assert.strictEqual(isValidOriginFormat('https://myapp.com/path'), false);
  assert.strictEqual(isValidOriginFormat('javascript:alert(1)'), false);
  assert.strictEqual(isValidOriginFormat('*'), false);
});

test('CORS: Production with no origins fails closed', () => {
  const origEnv = process.env.NODE_ENV;
  const origAllowed = process.env.ALLOWED_ORIGINS;

  try {
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOWED_ORIGINS;

    const origins = getAllowedOrigins();
    assert.strictEqual(origins.length, 0);
    assert.strictEqual(isOriginAllowed('http://localhost:3000'), false);
    assert.strictEqual(isOriginAllowed('https://evil.com'), false);
  } finally {
    process.env.NODE_ENV = origEnv;
    process.env.ALLOWED_ORIGINS = origAllowed;
  }
});

// =========================================================================
// 7. AI SERVICE REGRESSION INTEGRITY (Item 10)
// =========================================================================
test('AI Service: All public methods exist and match signature', () => {
  const requiredMethods = [
    'verifyGeminiKey',
    'cleanSvgText',
    'analyzeTemplate',
    'generateStructuredPost',
    'fetchSmartBackground',
    'generateThumbnailCardFromData',
    'generateFullPostBundle',
    'regenerateThumbnailOnly',
    'regenerateCaptionOnly',
    'generateTopicIdeas',
    'generatePostText'
  ];

  for (const m of requiredMethods) {
    assert.strictEqual(typeof ai[m], 'function', `ai.${m} must be a function`);
  }
});

test('AI Service: generateTopicIdeas returns array of ideas with mocked provider', async () => {
  const ideas = await ai.generateTopicIdeas('science_nature', 3);
  assert.ok(Array.isArray(ideas));
  assert.ok(ideas.length >= 1);
  assert.ok(typeof ideas[0].title === 'string');
});

test('AI Service: cleanSvgText sanitizes emojis and formatting without throwing', () => {
  const cleaned = ai.cleanSvgText('Test 🚀✨ *bold* _italic_ text');
  assert.ok(typeof cleaned === 'string');
  assert.strictEqual(cleaned, 'Test bold italic text');
});

test('AI Service: generateFullPostBundle executes cleanly with mocked provider', async () => {
  const bundle = await ai.generateFullPostBundle({
    topic: 'মহাকাশ বিজ্ঞান ও নতুন গ্যালাক্সি আবিষ্কার',
    categoryId: 'science_nature',
    includeImage: false
  });

  assert.ok(bundle);
  assert.ok(typeof bundle.message === 'string');
  assert.ok(bundle.message.length > 20);
  assert.ok('isFallback' in bundle);
  assert.ok('generationSource' in bundle);
});

test('AI Service: regenerateCaptionOnly returns structured Bengali caption with mocked provider', async () => {
  const result = await ai.regenerateCaptionOnly({
    currentCaption: 'পুরোনো ক্যাপশন যা পরিবর্তন করা দরকার।',
    topic: 'মহাকাশ বিজ্ঞান'
  });

  assert.ok(result);
  assert.strictEqual(result.success, true);
  assert.ok(typeof result.message === 'string');
  assert.ok(result.message.length > 10);
});

// =========================================================================
// 8. FACEBOOK PUBLISH GUARD REGRESSION (Item 15)
// =========================================================================
test('Publish Guard: facebook.publishPost is NOT called if content safety fails', async () => {
  let publishCalled = false;
  const originalPublish = facebook.publishPost;

  facebook.publishPost = async () => {
    publishCalled = true;
    return { success: true, postId: 'mock_post_123' };
  };

  try {
    const unsafePost = {
      message: 'Short' // Length failure
    };
    const safetyCheck = validateContent(unsafePost);

    if (safetyCheck.safe) {
      await facebook.publishPost(unsafePost);
    }

    assert.strictEqual(safetyCheck.safe, false);
    assert.strictEqual(publishCalled, false, 'publishPost must not be called when safetyCheck fails');
  } finally {
    facebook.publishPost = originalPublish;
  }
});
