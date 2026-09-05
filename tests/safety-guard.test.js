'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  validateLoopbackDatabaseUrl,
  assertSafeTestDatabaseUrl,
  redactDatabaseUrl
} = require('../db/safety-guard');

describe('Database Safety Guard & URL Sanitizer', () => {
  describe('redactDatabaseUrl', () => {
    it('redacts password from valid database URLs', () => {
      const redacted = redactDatabaseUrl('postgres://dbuser:supersecretpass@127.0.0.1:5432/testdb');
      assert.strictEqual(redacted.includes('supersecretpass'), false);
      assert.strictEqual(redacted.includes('***'), true);
      assert.strictEqual(redacted, 'postgres://dbuser:***@127.0.0.1:5432/testdb');
    });

    it('handles empty or malformed inputs without throwing', () => {
      assert.strictEqual(redactDatabaseUrl(''), '[EMPTY_URL]');
      assert.strictEqual(redactDatabaseUrl(null), '[EMPTY_URL]');
      assert.strictEqual(redactDatabaseUrl('not a valid url:::'), '[MALFORMED_URL]');
    });
  });

  describe('validateLoopbackDatabaseUrl', () => {
    it('accepts standard loopback IPv4 address 127.0.0.1', () => {
      const res = validateLoopbackDatabaseUrl('postgres://127.0.0.1:5432/facebook_auto_poster_test');
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.hostname, '127.0.0.1');
    });

    it('accepts localhost hostname', () => {
      const res = validateLoopbackDatabaseUrl('postgres://postgres:pass@localhost:5432/test_db');
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.hostname, 'localhost');
    });

    it('accepts IPv6 loopback [::1]', () => {
      const res = validateLoopbackDatabaseUrl('postgresql://[::1]:5432/test_db');
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.hostname, '[::1]');
    });

    it('rejects remote domain hosts', () => {
      const res = validateLoopbackDatabaseUrl('postgres://user:pass@db.example.com:5432/test_db');
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error.includes('Non-loopback host'), true);
      assert.strictEqual(res.redactedUrl.includes('pass'), false);
    });

    it('rejects cloud provider hosts (AWS, RDS, Neon, Supabase)', () => {
      const urls = [
        'postgres://aws.rds.amazonaws.com:5432/test',
        'postgres://ep-test.neon.tech/db',
        'postgres://db.project.supabase.co:5432/postgres'
      ];
      for (const u of urls) {
        const res = validateLoopbackDatabaseUrl(u);
        assert.strictEqual(res.valid, false);
      }
    });

    it('rejects userinfo spoofing attempts where localhost is in userinfo but host is remote', () => {
      const spoofed = 'postgres://localhost:secret@attacker.com:5432/test';
      const res = validateLoopbackDatabaseUrl(spoofed);
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.hostname, 'attacker.com');
      assert.strictEqual(res.redactedUrl.includes('secret'), false);
    });

    it('rejects deceptive hostnames that prefix loopback addresses', () => {
      const res = validateLoopbackDatabaseUrl('postgres://127.0.0.1.attacker.com:5432/test');
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.hostname, '127.0.0.1.attacker.com');
    });

    it('rejects production keywords in database path or query params', () => {
      const prodUrls = [
        'postgres://127.0.0.1:5432/production',
        'postgres://127.0.0.1:5432/app_prod',
        'postgres://127.0.0.1:5432/test?db=production'
      ];
      for (const u of prodUrls) {
        const res = validateLoopbackDatabaseUrl(u);
        assert.strictEqual(res.valid, false);
        assert.strictEqual(res.error.includes('production keywords'), true);
      }
    });

    it('rejects non-postgres protocols', () => {
      const res = validateLoopbackDatabaseUrl('mysql://127.0.0.1:3306/test');
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error.includes('Invalid protocol'), true);
    });

    it('rejects malformed URLs cleanly', () => {
      const res = validateLoopbackDatabaseUrl(':::not-a-url:::');
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error.includes('Malformed database connection URL'), true);
    });
  });

  describe('assertSafeTestDatabaseUrl', () => {
    it('returns valid loopback connection string unchanged', () => {
      const valid = 'postgres://127.0.0.1:5432/facebook_auto_poster_test';
      assert.strictEqual(assertSafeTestDatabaseUrl(valid), valid);
    });

    it('throws error without exposing secret credentials when rejected', () => {
      const sensitiveUrl = 'postgres://admin:SuperSecretVaultKey999@remote.database.com:5432/test';
      assert.throws(
        () => assertSafeTestDatabaseUrl(sensitiveUrl),
        (err) => {
          assert.strictEqual(err.message.includes('SuperSecretVaultKey999'), false, 'Credentials must never be leaked in error message');
          assert.strictEqual(err.message.includes('***'), true);
          assert.strictEqual(err.message.includes('[Security Error]'), true);
          return true;
        }
      );
    });
  });
});
