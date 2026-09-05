'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assertSafeTestDatabaseUrl, validateLoopbackDatabaseUrl, redactDatabaseUrl, assertLeastPrivilegedTestRole } = require('../db/safety-guard');
const optedIn = { NODE_ENV: 'test', ALLOW_TEST_DATABASE: 'true' };
const valid = 'postgres://app_test:synthetic_password@127.0.0.1:55432/app_test';
for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
  test(`permits explicit loopback fixture ${host}`, () => {
    const url = `postgresql://app_test:synthetic@${host}:55432/app_test`;
    assert.equal(assertSafeTestDatabaseUrl(url, optedIn), url);
  });
}
for (const env of [{}, { NODE_ENV: 'test' }, { NODE_ENV: 'production', ALLOW_TEST_DATABASE: 'true' }, { NODE_ENV: 'development', ALLOW_TEST_DATABASE: 'true' }]) {
  test(`rejects missing test-mode/opt-in ${JSON.stringify(env)}`, () => assert.throws(() => assertSafeTestDatabaseUrl(valid, env), /Security Error/));
}
for (const url of [
  'postgres://app_test:secret@test.example.com/app_test',
  'postgres://localhost:secret@evil.example/app_test',
  'postgres://app_test@127.0.0.1.evil.example/app_test',
  'postgres://app_test@127.0.0.1/app_prod',
  'postgres://app_test@127.0.0.1/production_test',
  'postgres://app_test@127.0.0.1/app_test?host=evil.example',
  'postgres://app_test@127.0.0.1/app_test?password=CANARY',
  'postgres://app_test@127.0.0.1/app_test#CANARY',
  'postgres://postgres@127.0.0.1/app_test',
  'postgres://127.0.0.1/app_test',
  'mysql://app_test@127.0.0.1/app_test',
  'not-a-url', ''
]) {
  test(`rejects unsafe database fixture ${url.replace(/secret|CANARY/g, '[synthetic]')}`, () => {
    assert.equal(validateLoopbackDatabaseUrl(url).valid, false);
    assert.throws(() => assertSafeTestDatabaseUrl(url, optedIn), /Security Error/);
  });
}
test('URL errors and redaction disclose no user, password, query, or malformed input', () => {
  for (const url of ['postgres://USERNAME_CANARY:PASSWORD_CANARY@remote/DB_CANARY?secret=QUERY_CANARY', 'malformed_CANARY']) {
    const text = JSON.stringify(validateLoopbackDatabaseUrl(url)) + redactDatabaseUrl(url);
    assert.ok(!text.includes('CANARY'));
    assert.throws(() => assertSafeTestDatabaseUrl(url, optedIn), err => !err.message.includes('CANARY'));
  }
});
test('rejects privileged or inherited database roles using the exact guard', async () => {
  for (const key of ['rolsuper', 'rolcreatedb', 'rolcreaterole', 'rolreplication', 'rolbypassrls', 'inherits_roles']) {
    await assert.rejects(assertLeastPrivilegedTestRole({ query: async () => ({ rows: [{ [key]: true, database_name: 'app_test' }] }) }), /non-privileged/);
  }
  await assertLeastPrivilegedTestRole({ query: async () => ({ rows: [{ database_name: 'app_test' }] }) });
});
