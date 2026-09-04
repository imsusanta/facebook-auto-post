/**
 * Automated Security & Content Safety Test Suite
 * Validates all 25 critical safety specifications hermetically with zero external network calls.
 */

const assert = require('assert');
const { serializePublic, serializeSettings, serializePage, serializePages, isSensitiveKey } = require('../utils/public-serializer');
const { validateSettingsPayload, ALLOWED_SETTINGS_KEYS } = require('../middleware/settings-validator');
const { authMiddleware, safeCompare } = require('../middleware/auth');
const {
  validateContent,
  checkDuplicate,
  validateSources,
  containsMojibake,
  isValidPublicUrl,
  calculateSimilarity
} = require('../services/content-safety');
const logger = require('../utils/logger');

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err.message}`);
    failed++;
  }
}

console.log('=======================================================');
console.log('🧪 Starting Security & Content Safety Test Suite');
console.log('=======================================================\n');

// -------------------------------------------------------------
// SECTION 1: Public Serializer & Secret Redaction (Tests 1-8)
// -------------------------------------------------------------
console.log('--- 1. Public Serializer & Secret Redaction Tests ---');

runTest('Test 1: isSensitiveKey correctly identifies credential fields', () => {
  assert.strictEqual(isSensitiveKey('accessToken'), true);
  assert.strictEqual(isSensitiveKey('access_token'), true);
  assert.strictEqual(isSensitiveKey('geminiApiKey'), true);
  assert.strictEqual(isSensitiveKey('apiKey'), true);
  assert.strictEqual(isSensitiveKey('password'), true);
  assert.strictEqual(isSensitiveKey('pageName'), false);
  assert.strictEqual(isSensitiveKey('title'), false);
});

runTest('Test 2: serializeSettings removes raw accessToken and geminiApiKey', () => {
  const raw = {
    pageId: '12345',
    accessToken: 'EAAB9876543210secret',
    geminiApiKey: 'AIzaSyFakeSecretKey1234567890',
    pageName: 'Test Page',
    autoPostEnabled: true
  };
  const serialized = serializeSettings(raw);
  assert.strictEqual('accessToken' in serialized, false);
  assert.strictEqual('geminiApiKey' in serialized, false);
  assert.strictEqual(serialized.pageId, '12345');
  assert.strictEqual(serialized.pageName, 'Test Page');
});

runTest('Test 3: serializeSettings enriches with boolean presence flags', () => {
  const raw = {
    accessToken: 'EAAB1234',
    geminiApiKey: 'AIzaSy1234',
    pages: [{ id: 'p1', accessToken: 'EAAB999' }]
  };
  const serialized = serializeSettings(raw);
  assert.strictEqual(serialized.geminiConfigured, true);
  assert.strictEqual(serialized.facebookConnected, true);
  assert.strictEqual(serialized.hasToken, true);
});

runTest('Test 4: serializeSettings strips tokens inside nested pages array', () => {
  const raw = {
    pages: [
      { id: 'p1', name: 'Page One', accessToken: 'EAABSecretToken1' },
      { id: 'p2', name: 'Page Two', accessToken: 'EAABSecretToken2' }
    ]
  };
  const serialized = serializeSettings(raw);
  assert.strictEqual('accessToken' in serialized.pages[0], false);
  assert.strictEqual('accessToken' in serialized.pages[1], false);
  assert.strictEqual(serialized.pages[0].hasToken, true);
  assert.strictEqual(serialized.pages[1].hasToken, true);
});

runTest('Test 5: serializePage removes accessToken and leaves safe fields intact', () => {
  const page = { id: 'p1', name: 'My Niche Page', category: 'Science', accessToken: 'EAAB12345' };
  const serialized = serializePage(page);
  assert.strictEqual('accessToken' in serialized, false);
  assert.strictEqual(serialized.id, 'p1');
  assert.strictEqual(serialized.name, 'My Niche Page');
  assert.strictEqual(serialized.category, 'Science');
  assert.strictEqual(serialized.hasToken, true);
});

runTest('Test 6: serializePublic does not mutate original input object', () => {
  const original = { pageId: '123', accessToken: 'EAAB_SECRET' };
  serializePublic(original);
  assert.strictEqual(original.accessToken, 'EAAB_SECRET');
});

runTest('Test 7: serializePublic handles circular references without throwing', () => {
  const obj = { name: 'Root' };
  obj.self = obj;
  const serialized = serializePublic(obj);
  assert.strictEqual(serialized.name, 'Root');
  assert.strictEqual(serialized.self, '[Circular]');
});

runTest('Test 8: serializePublic handles null, undefined, and primitive values', () => {
  assert.strictEqual(serializePublic(null), null);
  assert.strictEqual(serializePublic(undefined), undefined);
  assert.strictEqual(serializePublic('safe string'), 'safe string');
  assert.strictEqual(serializePublic(42), 42);
});

// -------------------------------------------------------------
// SECTION 2: Settings Validator & Prototype Pollution (Tests 9-14)
// -------------------------------------------------------------
console.log('\n--- 2. Settings Validation & Input Security Tests ---');

runTest('Test 9: validateSettingsPayload accepts valid settings object', () => {
  const valid = {
    pageName: 'Valid Page',
    autoPostEnabled: true,
    intervalMinutes: 60,
    cronSchedule: '0 9,14,20 * * *',
    selectedCategories: ['science_nature', 'history_civilization']
  };
  const res = validateSettingsPayload(valid);
  assert.strictEqual(res.valid, true);
});

runTest('Test 10: validateSettingsPayload rejects prototype pollution (__proto__)', () => {
  const malicious = JSON.parse('{"__proto__": {"isAdmin": true}}');
  const res = validateSettingsPayload(malicious);
  assert.strictEqual(res.valid, false);
  assert.ok(res.error.includes('Prototype pollution'));
});

runTest('Test 11: validateSettingsPayload rejects disallowed unknown fields', () => {
  const unknown = { pageName: 'Good', maliciousInjection: true };
  const res = validateSettingsPayload(unknown);
  assert.strictEqual(res.valid, false);
  assert.ok(res.error.includes('Disallowed or unexpected settings fields'));
});

runTest('Test 12: validateSettingsPayload rejects out-of-range intervalMinutes', () => {
  assert.strictEqual(validateSettingsPayload({ intervalMinutes: 0 }).valid, false);
  assert.strictEqual(validateSettingsPayload({ intervalMinutes: -15 }).valid, false);
  assert.strictEqual(validateSettingsPayload({ intervalMinutes: 10000 }).valid, false);
  assert.strictEqual(validateSettingsPayload({ intervalMinutes: 15 }).valid, true);
});

runTest('Test 13: validateSettingsPayload rejects invalid cron syntax', () => {
  assert.strictEqual(validateSettingsPayload({ cronSchedule: 'invalid-cron-format' }).valid, false);
  assert.strictEqual(validateSettingsPayload({ cronSchedule: '* * *' }).valid, false); // only 3 parts
  assert.strictEqual(validateSettingsPayload({ cronSchedule: '0 9,14,20 * * *' }).valid, true);
});

runTest('Test 14: validateSettingsPayload enforces boolean types for boolean flags', () => {
  assert.strictEqual(validateSettingsPayload({ autoPostEnabled: 'yes' }).valid, false);
  assert.strictEqual(validateSettingsPayload({ autoPilotEnabled: 1 }).valid, false);
  assert.strictEqual(validateSettingsPayload({ autoPostEnabled: true }).valid, true);
});

// -------------------------------------------------------------
// SECTION 3: Route Authentication & Timing Defense (Tests 15-18)
// -------------------------------------------------------------
console.log('\n--- 3. Authentication & Access Control Tests ---');

runTest('Test 15: safeCompare uses constant-time string comparison', () => {
  assert.strictEqual(safeCompare('secret123', 'secret123'), true);
  assert.strictEqual(safeCompare('secret123', 'wrong'), false);
  assert.strictEqual(safeCompare('secret123', 'secret124'), false);
  assert.strictEqual(safeCompare(null, 'secret'), false);
});

runTest('Test 16: authMiddleware allows Meta webhook path to bypass authentication', () => {
  const req = { path: '/webhook/facebook', headers: {}, originalUrl: '/api/webhook/facebook' };
  let calledNext = false;
  authMiddleware(req, {}, () => { calledNext = true; });
  assert.strictEqual(calledNext, true);
});

runTest('Test 17: authMiddleware verifies x-admin-key and Authorization headers', () => {
  const prevEnv = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = 'super_secret_admin_key_2026';

  try {
    // Missing header
    let resStatus = 0;
    let resData = null;
    const mockRes = {
      status(s) { resStatus = s; return this; },
      json(d) { resData = d; }
    };
    authMiddleware({ path: '/settings', headers: {}, originalUrl: '/api/settings' }, mockRes, () => {});
    assert.strictEqual(resStatus, 401);

    // Valid x-admin-key header
    let nextCalled = false;
    authMiddleware(
      { path: '/settings', headers: { 'x-admin-key': 'super_secret_admin_key_2026' }, originalUrl: '/api/settings' },
      mockRes,
      () => { nextCalled = true; }
    );
    assert.strictEqual(nextCalled, true);

    // Valid Authorization Bearer header
    nextCalled = false;
    authMiddleware(
      { path: '/settings', headers: { authorization: 'Bearer super_secret_admin_key_2026' }, originalUrl: '/api/settings' },
      mockRes,
      () => { nextCalled = true; }
    );
    assert.strictEqual(nextCalled, true);
  } finally {
    process.env.ADMIN_API_KEY = prevEnv;
  }
});

runTest('Test 18: authMiddleware supports query param authentication for SSE EventSource', () => {
  const prevEnv = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = 'my_sse_key';

  try {
    let nextCalled = false;
    authMiddleware(
      { path: '/events', headers: {}, query: { apiKey: 'my_sse_key' }, originalUrl: '/api/events' },
      {},
      () => { nextCalled = true; }
    );
    assert.strictEqual(nextCalled, true);
  } finally {
    process.env.ADMIN_API_KEY = prevEnv;
  }
});

// -------------------------------------------------------------
// SECTION 4: Content Safety Guard & Verification (Tests 19-23)
// -------------------------------------------------------------
console.log('\n--- 4. Content Safety Guard Tests ---');

runTest('Test 19: containsMojibake detects corrupted Latin1 / Bengali sequences', () => {
  assert.strictEqual(containsMojibake('à¦®à¦¹à¦¾à¦•à¦¾à¦¶'), true);
  assert.strictEqual(containsMojibake('DÃ©jÃ\xa0 vu'), true);
  assert.strictEqual(containsMojibake('মহাবিশ্বের অপূর্ব দৃশ্য 🌌✨'), false);
});

runTest('Test 20: validateContent rejects short captions (< 30 characters)', () => {
  const res = validateContent({ message: 'Hi there!' });
  assert.strictEqual(res.safe, false);
  assert.ok(res.reasons.some(r => r.includes('too short')));
});

runTest('Test 21: validateContent rejects unverified news in AutoPilot mode', () => {
  const unverifiedNews = {
    category: 'trending_news',
    message: '🚨 ব্রেকিং নিউজ: দেশব্যাপী নতুন আইন জারির বিশেষ বিজ্ঞপ্তি প্রকাশিত হয়েছে। এখনই বিস্তারিত জেনে নিন! #BreakingNews #CurrentAffairs'
  };
  const res = validateContent(unverifiedNews, { isAutoPilot: true });
  assert.strictEqual(res.safe, false);
  assert.ok(res.reasons.some(r => r.includes('without verified sources')));
});

runTest('Test 22: validateSources rejects invalid protocols or private IP addresses', () => {
  assert.strictEqual(isValidPublicUrl('http://localhost:3000/news'), false);
  assert.strictEqual(isValidPublicUrl('http://192.168.1.100/article'), false);
  assert.strictEqual(isValidPublicUrl('ftp://example.com/file'), false);
  assert.strictEqual(isValidPublicUrl('https://bbc.com/news/world-12345'), true);

  const sourcesCheck = validateSources([
    { url: 'https://timesofindia.indiatimes.com/article', publisher: 'Times of India' }
  ]);
  assert.strictEqual(sourcesCheck.valid, true);
});

runTest('Test 23: checkDuplicate detects high token similarity with recent posts', () => {
  const existingPost = {
    message: 'মহাকাশের ব্ল্যাক হোল ও ইভেন্ট হরাইজনের মহাকর্ষীয় রহস্য নিয়ে বিজ্ঞানীদের এক নতুন আবিষ্কার।'
  };
  const duplicateAttempt = 'মহাকাশের ব্ল্যাক হোল ও ইভেন্ট হরাইজনের মহাকর্ষীয় রহস্য নিয়ে বিজ্ঞানীদের নতুন গবেষণা ও আবিষ্কার।';

  const res = checkDuplicate(duplicateAttempt, [existingPost], 0.65);
  assert.strictEqual(res.isDuplicate, true);
  assert.ok(res.similarity >= 0.65);
});

// -------------------------------------------------------------
// SECTION 5: Safe Logger & Meta Policy Checks (Tests 24-25)
// -------------------------------------------------------------
console.log('\n--- 5. Logger Redaction & Meta Compliance Tests ---');

runTest('Test 24: logger.redactString masks Meta FB tokens and Google Gemini API keys', () => {
  const rawLog = 'Graph API call with token EAABwzFakeToken1234567890 and Gemini AIzaSyDfakeApiKey9876543210123456';
  const redacted = logger.redactString(rawLog);
  assert.ok(!redacted.includes('EAABwzFakeToken'));
  assert.ok(!redacted.includes('AIzaSyDfakeApiKey'));
  assert.ok(redacted.includes('[REDACTED_FB_TOKEN]'));
  assert.ok(redacted.includes('[REDACTED_GEMINI_KEY]'));
});

runTest('Test 25: validateContent blocks synthetic AI imagery for breaking news about real persons', () => {
  const realPersonPost = {
    category: 'trending_news',
    message: '🚨 ব্রেকিং নিউজ: ভারতের প্রধানমন্ত্রী নরেন্দ্র মোদী নতুন অর্থনৈতিক প্রকল্পের ঘোষণা দিলেন। #NarendraModi #BreakingNews',
    includeImage: true,
    isAiImage: true
  };
  const res = validateContent(realPersonPost, { isAutoPilot: false });
  assert.ok(res.reasons.some(r => r.includes('AI-generated synthetic imagery cannot be used for breaking news')));
});

console.log('\n=======================================================');
console.log(`📊 Test Results: ${passed} Passed, ${failed} Failed`);
console.log('=======================================================');

if (failed > 0) {
  process.exit(1);
} else {
  console.log('🎉 All 25 security and content safety tests passed successfully!');
  process.exit(0);
}
