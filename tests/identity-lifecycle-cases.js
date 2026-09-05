'use strict';
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const passwords = require('../security/passwords');
const mail = require('../services/account-mail');
const lifecycle = require('../services/account-lifecycle');
const users = require('../repositories/user-repository');
const events = require('../repositories/account-security-repository');
module.exports = function register({ request, query, getPool, baseUrl }) {
  describe('Identity lifecycle via actual HTTP and PostgreSQL', () => {
    const pw = 'Lifecycle Password 123!';
    const newPw = 'Replacement Password 456!';
    let saved;
    const keys = ['ALLOW_TEST_MAIL', 'AUTH_MAIL_ADAPTER', 'AUTH_MAIL_ENCRYPTION_KEY', 'AUTH_PUBLIC_ORIGIN'];
    before(() => {
      saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
      process.env.ALLOW_TEST_MAIL = 'true'; process.env.AUTH_MAIL_ADAPTER = 'test';
      process.env.AUTH_MAIL_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
      process.env.AUTH_PUBLIC_ORIGIN = baseUrl();
    });
    after(() => {
      mail.resetTestMailbox();
      for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    });
    beforeEach(async () => { await query('DELETE FROM auth_rate_buckets'); mail.resetTestMailbox(); });
    const address = () => `lifecycle-${crypto.randomBytes(8).toString('hex')}@example.test`;
    const tokenFrom = message => new URL(message.link).hash.slice('#token='.length);
    const post = (path, body = {}, auth = null, headers = {}) => request({ method: 'POST', path: '/api/auth' + path, body, headers: { ...(auth ? { Cookie: auth.cookie, 'x-csrf-token': auth.csrf } : {}), ...headers } });
    async function signup(email = address(), password = pw, extra = {}) {
      const response = await post('/signup', { email, password, ...extra });
      assert.equal(response.status, 202);
      const message = mail.takeTestMessages().find(m => m.to === email && m.purpose === 'verify_email');
      assert.ok(message, 'Signup must deliver through the test-only mail adapter');
      return { email, password, message, token: tokenFrom(message) };
    }
    async function verified() {
      const account = await signup();
      assert.equal((await post('/verify-email', { token: account.token })).status, 200);
      return account;
    }
    async function login(account, password = account.password) {
      const r = await post('/login', { email: account.email, password });
      assert.equal(r.status, 200);
      assert.equal(r.body.user.role, 'user');
      return { cookie: r.headers['set-cookie'][0].split(';')[0], csrf: r.body.csrfToken, id: r.body.user.id };
    }
    async function recovery(account) {
      assert.equal((await post('/forgot-password', { email: account.email })).status, 202);
      const message = mail.takeTestMessages().find(m => m.to === account.email && m.purpose === 'reset_password');
      assert.ok(message); return tokenFrom(message);
    }
    async function authenticated(auth) {
      return (await request({ path: '/api/auth/session', headers: { Cookie: auth.cookie } })).body.authenticated;
    }
    it('HTTP signup -> captured verification -> login -> workspace mutation/read -> logout; privilege injection ignored', async () => {
      const a = await signup(address(), pw, { status: 'active', role: 'super_admin', email_verified_at: new Date().toISOString() });
      let row = await users.findByEmail(a.email);
      const tokenRows = await query('SELECT * FROM auth_action_tokens WHERE user_id = $1', [row.id]);
      assert.ok(!JSON.stringify(tokenRows.rows).includes(a.token));
      assert.equal(row.status, 'pending_verification'); assert.equal(row.email_verified_at, null);
      assert.equal(row.password_algorithm, 'argon2id'); assert.ok(row.password_hash.startsWith('$argon2id$'));
      assert.equal((await post('/login', { email: a.email, password: pw })).status, 401);
      assert.equal((await post('/verify-email', { token: a.token })).status, 200);
      const auth = await login(a);
      const created = await request({ method: 'POST', path: '/api/v1/workspaces', headers: { Cookie: auth.cookie, 'x-csrf-token': auth.csrf }, body: { name: 'Lifecycle ' + crypto.randomBytes(4).toString('hex') } });
      assert.equal(created.status, 201);
      assert.equal((await request({ path: `/api/v1/workspaces/${created.body.workspace.id}`, headers: { Cookie: auth.cookie } })).status, 200);
      assert.equal((await request({ method: 'PATCH', path: `/api/v1/workspaces/${created.body.workspace.id}`, headers: { Cookie: auth.cookie }, body: { name: 'Forbidden' } })).status, 403);
      assert.equal((await post('/logout', {}, auth)).status, 200); assert.equal(await authenticated(auth), false);
      const audit = await query('SELECT action FROM account_security_events WHERE user_id = $1', [auth.id]);
      for (const action of ['account.registered', 'email.verified', 'session.created']) assert.ok(audit.rows.some(r => r.action === action));
    });
    it('Duplicate and concurrent signup preserve the original credential and return generic responses', async () => {
      const email = address();
      const result = await Promise.all([post('/signup', { email, password: pw }), post('/signup', { email, password: pw })]);
      assert.deepEqual(result.map(r => r.status), [202, 202]);
      assert.equal(result[0].body.message, result[1].body.message);
      const messages = mail.takeTestMessages().filter(m => m.to === email); assert.equal(messages.length, 1);
      const row = await users.findByEmail(email); assert.equal(await passwords.verify(row.password_hash, pw), true);
      assert.equal((await post('/signup', { email, password: newPw })).status, 202);
      assert.equal(mail.takeTestMessages().length, 0);
      assert.equal((await users.findByEmail(email)).password_hash, row.password_hash);
      const audit = await query("SELECT id FROM account_security_events WHERE user_id = $1 AND action = 'account.registered'", [row.id]); assert.equal(audit.rowCount, 1);
    });
    it('Resend invalidates older verification tokens; known and unknown email responses match', async () => {
      const a = await signup();
      const known = await post('/resend-verification', { email: a.email });
      const unknown = await post('/resend-verification', { email: address() });
      assert.equal(known.status, unknown.status); assert.equal(known.body.message, unknown.body.message);
      const newToken = tokenFrom(mail.takeTestMessages()[0]);
      assert.notEqual(newToken, a.token);
      assert.equal((await post('/verify-email', { token: a.token })).status, 400);
      assert.equal((await post('/verify-email', { token: newToken })).status, 200);
      assert.equal((await post('/verify-email', { token: newToken })).status, 400);
    });
    it('Malformed, expired and wrong-purpose tokens fail without consuming valid actions', async () => {
      const a = await signup();
      assert.equal((await post('/verify-email', { token: 'malformed' })).status, 400);
      assert.equal((await post('/reset-password', { token: a.token, password: newPw })).status, 400);
      const hash = crypto.createHash('sha256').update(a.token).digest('hex');
      await query("UPDATE auth_action_tokens SET created_at = NOW() - INTERVAL '2 days', expires_at = NOW() - INTERVAL '1 second' WHERE token_hash = $1", [hash]);
      assert.equal((await post('/verify-email', { token: a.token })).status, 400);
      assert.equal((await users.findByEmail(a.email)).email_verified_at, null);
      await post('/resend-verification', { email: a.email });
      const fresh = tokenFrom(mail.takeTestMessages()[0]);
      assert.equal((await post('/verify-email', { token: fresh })).status, 200);
      const reset = await recovery(a);
      assert.equal((await post('/verify-email', { token: reset })).status, 400);
      assert.equal((await post('/reset-password', { token: reset, password: newPw })).status, 200);
    });
    it('Concurrent verification and reset each consume one token exactly once', async () => {
      const a = await signup();
      let results = await Promise.all([post('/verify-email', { token: a.token }), post('/verify-email', { token: a.token })]);
      assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
      const token = await recovery(a);
      results = await Promise.all([post('/reset-password', { token, password: newPw }), post('/reset-password', { token, password: newPw })]);
      assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
      assert.equal((await users.findByEmail(a.email)).auth_version, 1);
    });
    it('Recovery resend revokes older links; expired reset tokens cannot change a credential', async () => {
      const a = await verified(); const first = await recovery(a); const second = await recovery(a);
      assert.equal((await post('/reset-password', { token: first, password: newPw })).status, 400);
      const hash = crypto.createHash('sha256').update(second).digest('hex');
      await query("UPDATE auth_action_tokens SET created_at = NOW() - INTERVAL '2 hours', expires_at = NOW() - INTERVAL '1 second' WHERE token_hash = $1", [hash]);
      assert.equal((await post('/reset-password', { token: second, password: newPw })).status, 400);
      await login(a);
    });
    it('Recovery is generic; successful reset revokes every cookie and rejects old password/replay', async () => {
      const a = await verified(); const auth1 = await login(a), auth2 = await login(a);
      const known = await post('/forgot-password', { email: a.email });
      const unknown = await post('/forgot-password', { email: address() });
      assert.equal(known.status, unknown.status); assert.equal(known.body.message, unknown.body.message);
      const token = tokenFrom(mail.takeTestMessages()[0]);
      assert.equal((await post('/reset-password', { token, password: newPw })).status, 200);
      assert.equal(await authenticated(auth1), false); assert.equal(await authenticated(auth2), false);
      assert.equal((await post('/login', { email: a.email, password: pw })).status, 401);
      await login(a, newPw);
      const after = await users.findByEmail(a.email);
      assert.equal((await post('/reset-password', { token, password: 'Different Password 789!' })).status, 400);
      assert.equal((await users.findByEmail(a.email)).password_hash, after.password_hash);
    });
    it('Password change requires current password and CSRF; logout-all revokes sessions and recovery tokens', async () => {
      const a = await verified(); let auth = await login(a); const second = await login(a);
      assert.equal((await post('/change-password', { currentPassword: pw, newPassword: newPw }, auth, { 'x-csrf-token': 'wrong' })).status, 403);
      assert.equal((await post('/change-password', { currentPassword: 'wrong', newPassword: newPw }, auth)).status, 400);
      assert.equal((await post('/change-password', { currentPassword: pw, newPassword: newPw }, auth)).status, 200);
      assert.equal(await authenticated(auth), false); assert.equal(await authenticated(second), false);
      auth = await login(a, newPw);
      const resetToken = await recovery(a);
      assert.equal((await post('/logout-all', {}, auth, { 'x-csrf-token': 'wrong' })).status, 403);
      assert.equal((await post('/logout-all', {}, auth)).status, 200);
      assert.equal(await authenticated(auth), false);
      assert.equal((await post('/reset-password', { token: resetToken, password: pw })).status, 400);
    });
    it('Suspension/deletion revoke cookies and actions; fixture reactivation cannot resurrect old sessions', async () => {
      const a = await verified(); const auth = await login(a); const token = await recovery(a);
      assert.equal(await users.suspendUser(auth.id), true);
      assert.equal(await authenticated(auth), false);
      assert.equal((await post('/login', { email: a.email, password: pw })).status, 401);
      assert.equal((await post('/reset-password', { token, password: newPw })).status, 400);
      // Test fixture only, not a public or production suspension-lift flow.
      await query("UPDATE users SET status = 'active' WHERE id = $1", [auth.id]);
      assert.equal(await authenticated(auth), false);
      const fresh = await login(a); assert.equal(await users.softDelete(auth.id), true);
      assert.equal(await authenticated(fresh), false);
      assert.equal((await post('/login', { email: a.email, password: pw })).status, 401);
    });
    it('Successful legacy PBKDF2 login upgrades to Argon2id without changing the password', async () => {
      const email = address(); const oldPassword = ' oldpass ';
      const user = await users.createUser({ email, password: pw, emailVerifiedAt: new Date() });
      const salt = crypto.randomBytes(16).toString('hex');
      const oldHash = `pbkdf2_sha512$100000$${salt}$${crypto.pbkdf2Sync(oldPassword, salt, 100000, 64, 'sha512').toString('hex')}`;
      await query("UPDATE users SET password_hash = $2, password_algorithm = 'pbkdf2_sha512' WHERE id = $1", [user.id, oldHash]);
      await login({ email, password: oldPassword });
      const upgraded = await users.findByEmail(email);
      assert.equal(upgraded.password_algorithm, 'argon2id'); assert.equal(upgraded.auth_version, 0);
      assert.equal(await passwords.verify(upgraded.password_hash, oldPassword), true);
      assert.equal(await passwords.verify(upgraded.password_hash, oldPassword.trim()), false);
      assert.equal((await query("SELECT id FROM account_security_events WHERE user_id = $1 AND action = 'password.hash_upgraded'", [user.id])).rowCount, 1);
    });
    it('Hash parameters are bounded and password work fails closed above its concurrency limit', async () => {
      for (const h of ['pbkdf2_sha512$999999999$x$y', '$argon2id$v=19$m=999999,t=2,p=1$bad$bad', '$argon2id$v=19$m=19456,m=19456,p=1$bad$bad']) assert.equal(await passwords.verify(h, pw), false);
      const results = await Promise.allSettled(Array.from({ length: 5 }, () => passwords.hash(pw)));
      assert.equal(results.filter(x => x.status === 'fulfilled').length, 4);
      assert.equal(results.filter(x => x.status === 'rejected')[0].reason.code, 'AUTH_BUSY');
      assert.equal((await post('/signup', { email: address(), password: 'short' })).status, 400);
      assert.equal(passwords.validPassword('😀'.repeat(6)), false);
      assert.equal(passwords.validPassword('😀'.repeat(12)), true);
    });
    async function orderedUserRace(id, first, second) {
      const blocker = await getPool().connect(); const requests = [];
      const wait = async n => {
        const deadline = Date.now() + 7000;
        while (Date.now() < deadline) {
          const rows = await query("SELECT COUNT(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND usename = current_user AND wait_event_type = 'Lock' AND query LIKE '%FROM users%FOR UPDATE%'");
          if (rows.rows[0].n >= n) return;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        throw new Error('Account row-lock barrier timed out');
      };
      try {
        await blocker.query('BEGIN'); await blocker.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [id]);
        requests.push(Promise.allSettled([first()])); await wait(1);
        requests.push(Promise.allSettled([second()])); await wait(2);
        await blocker.query('COMMIT');
        return (await Promise.all(requests)).flat().map(result => { if (result.status === 'rejected') throw result.reason; return result.value; });
      } finally { await blocker.query('ROLLBACK'); blocker.release(); await Promise.all(requests); }
    }
    for (const first of ['login', 'reset']) it(`Concurrent login/reset: ${first} locks first; no stale session survives`, async () => {
      const a = await verified(); const user = await users.findByEmail(a.email); const token = await recovery(a);
      const operations = { login: () => post('/login', { email: a.email, password: pw }), reset: () => post('/reset-password', { token, password: newPw }) };
      const results = await orderedUserRace(user.id, operations[first], operations[first === 'login' ? 'reset' : 'login']);
      if (first === 'login') {
        assert.deepEqual(results.map(r => r.status), [200, 200]);
        const cookie = results[0].headers['set-cookie'][0].split(';')[0]; assert.equal(await authenticated({ cookie }), false);
      } else assert.deepEqual(results.map(r => r.status), [200, 401]);
      assert.equal((await query('SELECT token_hash FROM auth_sessions WHERE user_id = $1', [user.id])).rowCount, 0);
    });
    it('Logout-all racing login rejects a pending login using the old account version', async () => {
      const a = await verified(), auth = await login(a);
      const results = await orderedUserRace(auth.id, () => post('/logout-all', {}, auth), () => post('/login', { email: a.email, password: pw }));
      assert.deepEqual(results.map(r => r.status), [200, 401]);
      assert.equal(await authenticated(auth), false);
    });
    it('Encrypted outbox survives delivery failure, retries once, and scrubs delivered payloads', async () => {
      mail.configureTestFailure(true); const email = address();
      assert.equal((await post('/signup', { email, password: pw })).status, 202);
      assert.equal(mail.takeTestMessages().length, 0);
      const user = await users.findByEmail(email);
      const outbox = (await query('SELECT * FROM auth_mail_outbox WHERE user_id = $1', [user.id])).rows[0];
      assert.equal(outbox.state, 'pending'); assert.equal(outbox.attempts, 1);
      assert.ok(!outbox.payload.includes(email)); assert.ok(!outbox.payload.includes('token=')); assert.ok(!outbox.payload.includes(pw));
      mail.configureTestFailure(false);
      await query('UPDATE auth_mail_outbox SET available_at = NOW() WHERE id = $1', [outbox.id]);
      await mail.drain(); const received = mail.takeTestMessages(); assert.equal(received.length, 1);
      await mail.drain(); assert.equal(mail.takeTestMessages().length, 0);
      const sent = (await query('SELECT * FROM auth_mail_outbox WHERE id = $1', [outbox.id])).rows[0];
      assert.equal(sent.state, 'sent'); assert.equal(sent.payload, null);
      assert.equal((await post('/verify-email', { token: tokenFrom(received[0]) })).status, 200);
    });
    it('Mail capture followed by a failed DB commit retries idempotently without duplicate delivery', async () => {
      mail.configureTestFailure(true); const email = address();
      assert.equal((await post('/signup', { email, password: pw })).status, 202);
      const user = await users.findByEmail(email);
      const outbox = (await query('SELECT id FROM auth_mail_outbox WHERE user_id = $1', [user.id])).rows[0];
      await query('UPDATE auth_mail_outbox SET available_at = NOW() WHERE id = $1', [outbox.id]);
      mail.configureTestFailure(false);
      const pool = getPool(); const originalConnect = pool.connect; let failCommit = true;
      pool.connect = async function (...args) {
        if (args.some(arg => typeof arg === 'function')) return originalConnect.apply(this, args);
        const client = await originalConnect.apply(this, args);
        const originalQuery = client.query; const originalRelease = client.release;
        client.query = function (text, ...rest) {
          if (text === 'COMMIT' && failCommit) { failCommit = false; return Promise.reject(new Error('SYNTHETIC_COMMIT_FAILURE')); }
          return originalQuery.call(this, text, ...rest);
        };
        client.release = function (...releaseArgs) { client.query = originalQuery; client.release = originalRelease; return originalRelease.apply(this, releaseArgs); };
        return client;
      };
      try { await mail.dispatch(outbox.id); } finally { pool.connect = originalConnect; }
      assert.equal(failCommit, false);
      assert.equal(mail.takeTestMessages().length, 1);
      assert.equal((await query('SELECT state FROM auth_mail_outbox WHERE id = $1', [outbox.id])).rows[0].state, 'pending');
      await query('UPDATE auth_mail_outbox SET available_at = NOW() WHERE id = $1', [outbox.id]);
      await mail.dispatch(outbox.id);
      assert.equal(mail.takeTestMessages().length, 0);
      assert.equal((await query('SELECT state FROM auth_mail_outbox WHERE id = $1', [outbox.id])).rows[0].state, 'sent');
    });
    it('Resend cancels obsolete queued mail and trusted origin ignores forged Host', async () => {
      mail.configureTestFailure(true); const email = address();
      assert.equal((await post('/signup', { email, password: pw }, null, { Host: 'attacker.example' })).status, 202);
      const user = await users.findByEmail(email);
      mail.configureTestFailure(false); await post('/resend-verification', { email });
      const message = mail.takeTestMessages()[0]; assert.equal(new URL(message.link).origin, baseUrl());
      const rows = await query('SELECT state, payload FROM auth_mail_outbox WHERE user_id = $1 ORDER BY created_at', [user.id]);
      assert.deepEqual(rows.rows.map(r => r.state), ['cancelled', 'sent']); assert.ok(rows.rows.every(r => r.payload === null));
    });
    it('Shared rate limiter bounds recovery requests and table admission without account lockouts', async () => {
      for (let i = 0; i < 5; i++) assert.equal((await post('/forgot-password', { email: address() })).status, 202);
      assert.equal((await post('/forgot-password', { email: address() })).status, 429);
      await query('DELETE FROM auth_rate_buckets');
      await query("INSERT INTO auth_rate_buckets(bucket_key,hits,expires_at) SELECT 'fixture-' || n,1,NOW()+INTERVAL '15 minutes' FROM generate_series(1,10000) n");
      assert.equal((await post('/login', { email: address(), password: pw })).status, 429);
      assert.equal((await query('SELECT COUNT(*)::int AS n FROM auth_rate_buckets')).rows[0].n, 10000);
    });
    it('Auth HTTP fault canaries never appear in response headers/body or captured logger output', async () => {
      const original = lifecycle.signup; const log = console.error; const captured = [];
      try {
        console.error = (...args) => captured.push(JSON.stringify(args));
        const canary = 'PASSWORD_TOKEN_CANARY_' + crypto.randomBytes(6).toString('hex');
        lifecycle.signup = async () => { const e = new Error(`password invalid ${canary}`); e.code = 'PASSWORD_POLICY'; throw e; };
        const r = await post('/signup', { email: address(), password: pw }, null, { 'x-request-id': canary });
        assert.equal(r.status, 503); assert.equal(r.headers['x-request-id'], r.body.requestId);
        assert.ok(!JSON.stringify([r, captured]).includes(canary));
      } finally { lifecycle.signup = original; console.error = log; }
    });
    it('Audit failure rolls back signup, verification, reset/change, logout-all and suspension', async () => {
      const a = await signup(); const original = events.record;
      const breakAudit = () => { events.record = async () => { throw new Error('SYNTHETIC_ACCOUNT_AUDIT_FAILURE'); }; };
      const restore = () => { events.record = original; };
      const missingEmail = address();
      try {
        breakAudit(); assert.equal((await post('/signup', { email: missingEmail, password: pw })).status, 503);
        assert.equal(await users.findByEmail(missingEmail), null); assert.equal(mail.takeTestMessages().length, 0);
        assert.equal((await post('/verify-email', { token: a.token })).status, 503);
        assert.equal((await users.findByEmail(a.email)).email_verified_at, null);
        restore(); assert.equal((await post('/verify-email', { token: a.token })).status, 200);
        const auth = await login(a); const token = await recovery(a); const before = await users.findByEmail(a.email);
        breakAudit();
        assert.equal((await post('/reset-password', { token, password: newPw })).status, 503);
        assert.equal((await post('/change-password', { currentPassword: pw, newPassword: newPw }, auth)).status, 503);
        assert.equal((await post('/logout-all', {}, auth)).status, 503);
        await assert.rejects(users.suspendUser(auth.id), /SYNTHETIC_ACCOUNT_AUDIT_FAILURE/);
        const after = await users.findByEmail(a.email);
        assert.equal(after.password_hash, before.password_hash); assert.equal(after.auth_version, before.auth_version); assert.equal(after.status, 'active');
        assert.equal(await authenticated(auth), true);
        restore(); assert.equal((await post('/reset-password', { token, password: newPw })).status, 200);
      } finally { restore(); }
    });
    it('Production gate and test-mail boundary cannot be bypassed; browser origin checks remain enforced', async () => {
      const prior = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        for (const path of ['/signup', '/verify-email', '/resend-verification', '/forgot-password', '/reset-password', '/change-password', '/logout-all', '/login']) assert.equal((await post(path, { email: address(), password: pw })).status, 404);
        assert.throws(() => mail.takeTestMessages(), /not configured/);
      } finally { process.env.NODE_ENV = prior; }
      assert.equal((await post('/signup', { email: address(), password: pw }, null, { Origin: 'https://attacker.example' })).status, 403);
      const priorAdapter = process.env.AUTH_MAIL_ADAPTER;
      try { delete process.env.AUTH_MAIL_ADAPTER; assert.equal((await post('/signup', { email: address(), password: pw })).status, 503); }
      finally { process.env.AUTH_MAIL_ADAPTER = priorAdapter; }
    });
    it('Migration 009 rollback invalidates sessions; reapplying it restores the schema without cookie resurrection', async () => {
      const a = await verified(); const auth = await login(a);
      const { rollbackLatestMigration, runMigrations } = require('../db/migrator');
      const latest = (await query('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1')).rows[0]?.version;
      if (latest === '010') {
        await rollbackLatestMigration();
      }
      await rollbackLatestMigration();
      try {
        const columns = await query("SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'auth_version'");
        assert.equal(columns.rowCount, 0);
        assert.equal((await query('SELECT token_hash FROM auth_sessions')).rowCount, 0);
      } finally {
        await runMigrations();
      }
      assert.equal(await authenticated(auth), false);
      const fresh = await login(a); assert.equal(await authenticated(fresh), true);
    });
  });
};
