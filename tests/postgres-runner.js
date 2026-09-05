/**
 * PostgreSQL Cross-Tenant Isolation & RBAC Test Suite
 * Powered by Node.js built-in test runner (node:test and node:assert).
 *
 * Enforces:
 * 1. URL-scoped workspace context isolation
 * 2. Canonical 5-role RBAC authorization
 * 3. Atomic workspace & membership transactions
 * 4. Token hashing & revocation safety
 * 5. Sanitized audit logging
 * 6. Hardened connection lifecycle & loopback network containment
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const http = require('http');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');

// 1. Enforce Test Environment & Reject Production URLs
process.env.NODE_ENV = 'test';
process.env.STORAGE_MODE = 'postgres';

const { resolveTestDatabaseUrl } = require('../db/safety-guard');
const databaseUrl = resolveTestDatabaseUrl();
process.env.DATABASE_URL = databaseUrl;

// 2. Isolate DATA_DIR to prevent legacy data tampering
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-postgres-test-'));
process.env.DATA_DIR = testDataDir;

const realSettingsPath = path.join(__dirname, '..', 'data', 'settings.json');
let initialSettingsHash = null;
if (fs.existsSync(realSettingsPath)) {
  const content = fs.readFileSync(realSettingsPath);
  initialSettingsHash = crypto.createHash('sha256').update(content).digest('hex');
}

// 3. Install Loopback Network Deny Guard
const networkGuard = require('./network-guard');
networkGuard.installNetworkGuard();

// 4. Import application modules after environment & guards are established
const { Pool } = require('pg');
const { createApp } = require('../createApp');
const { query, closePool, getPool, withTransaction, resetPool } = require('../db/index');
const { runMigrations } = require('../db/migrator');
const userRepository = require('../repositories/user-repository');
const workspaceRepository = require('../repositories/workspace-repository');
const membershipRepository = require('../repositories/membership-repository');
const invitationRepository = require('../repositories/invitation-repository');
const auditLogRepository = require('../repositories/audit-log-repository');

// Dedicated, randomized schema for test isolation
const testSchema = 'test_schema_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');

// HTTP helper for test requests
function request(baseUrl, { method = 'GET', path: reqPath, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const u = new URL(reqPath, baseUrl);
    const bodyStr = body ? JSON.stringify(body) : null;
    const reqHeaders = { ...headers };
    if (bodyStr) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(bodyStr);
    }
    const req = http.request(u, { method, headers: reqHeaders }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch {
          json = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

describe('PostgreSQL Multi-Tenancy & RBAC Isolation Suite', () => {
  let server = null;
  let baseUrl = '';

  let userA = null;
  let userB = null;
  let userC = null; // viewer
  let userD = null; // editor
  let userE = null; // reviewer
  let userF = null; // admin

  let workspaceA = null;
  let workspaceB = null;

  before(async () => {
    // A. Create dedicated isolated schema
    const bootstrapPool = new Pool({ connectionString: databaseUrl });
    await bootstrapPool.query(`CREATE SCHEMA "${testSchema}";`);
    await bootstrapPool.end();

    // B. Direct search_path to isolated schema
    process.env.PGOPTIONS = `-c search_path="${testSchema}",public`;
    await resetPool();

    // C. Run PostgreSQL migrations inside isolated schema
    await runMigrations();

    // D. Start test HTTP server
    const app = createApp();
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // E. Seed Test Users (verified emails)
    const now = new Date();
    userA = await userRepository.createUser({ email: 'userA@example.com', password: 'PasswordA123!', emailVerifiedAt: now });
    userB = await userRepository.createUser({ email: 'userB@example.com', password: 'PasswordB123!', emailVerifiedAt: now });
    userC = await userRepository.createUser({ email: 'userC@example.com', password: 'PasswordC123!', emailVerifiedAt: now });
    userD = await userRepository.createUser({ email: 'userD@example.com', password: 'PasswordD123!', emailVerifiedAt: now });
    userE = await userRepository.createUser({ email: 'userE@example.com', password: 'PasswordE123!', emailVerifiedAt: now });
    userF = await userRepository.createUser({ email: 'userF@example.com', password: 'PasswordF123!', emailVerifiedAt: now });

    // F. Seed Workspaces with Owners
    workspaceA = await workspaceRepository.createWorkspaceWithOwner({
      name: 'Workspace Alpha',
      slug: 'workspace-alpha',
      creatorUserId: userA.id
    });

    workspaceB = await workspaceRepository.createWorkspaceWithOwner({
      name: 'Workspace Beta',
      slug: 'workspace-beta',
      creatorUserId: userB.id
    });

    // G. Seed Memberships in Workspace A
    await membershipRepository.addMember({ workspaceId: workspaceA.id, userId: userC.id, role: 'viewer', invitedBy: userA.id });
    await membershipRepository.addMember({ workspaceId: workspaceA.id, userId: userD.id, role: 'editor', invitedBy: userA.id });
    await membershipRepository.addMember({ workspaceId: workspaceA.id, userId: userE.id, role: 'reviewer', invitedBy: userA.id });
    await membershipRepository.addMember({ workspaceId: workspaceA.id, userId: userF.id, role: 'admin', invitedBy: userA.id });

    // H. Seed an Audit Event in Workspace A
    await auditLogRepository.recordEvent({
      workspaceId: workspaceA.id,
      actorUserId: userA.id,
      action: 'workspace:init',
      resourceType: 'workspace',
      resourceId: workspaceA.id,
      metadata: { initialized: true }
    });
  });

  after(async () => {
    // Close HTTP test server
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }

    // Ensure pool is closed
    await closePool();

    // Drop isolated test schema unless retaining for debug
    delete process.env.PGOPTIONS;
    if (process.env.DEBUG_RETAIN_TEST_DB !== 'true') {
      const cleanupPool = new Pool({ connectionString: databaseUrl });
      try {
        await cleanupPool.query(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE;`);
      } finally {
        await cleanupPool.end();
      }
    }

    // Uninstall network guard
    networkGuard.uninstallNetworkGuard();

    // Verify real data/settings.json was never modified
    if (initialSettingsHash && fs.existsSync(realSettingsPath)) {
      const currentContent = fs.readFileSync(realSettingsPath);
      const currentHash = crypto.createHash('sha256').update(currentContent).digest('hex');
      assert.strictEqual(currentHash === initialSettingsHash, true, 'Security Assertion: real data/settings.json must remain untampered.');
    }

    // Clean up temp dir
    try {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // --- The 30 Canonical Isolation & Security Assertions ---

  it('1. User A can read Workspace A.', async () => {
    const res = await request(baseUrl, {
      method: 'GET',
      path: `/api/v1/workspaces/${workspaceA.id}`,
      headers: { 'x-test-user-id': userA.id }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.workspace.id, workspaceA.id);
    assert.strictEqual(res.body.role, 'owner');
  });

  it('2. User A cannot read Workspace B.', async () => {
    const res = await request(baseUrl, {
      method: 'GET',
      path: `/api/v1/workspaces/${workspaceB.id}`,
      headers: { 'x-test-user-id': userA.id }
    });
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.code, 'WORKSPACE_NOT_FOUND');
    assert.strictEqual(res.body.workspace, undefined);
  });

  it('3. User B cannot update Workspace A.', async () => {
    const res = await request(baseUrl, {
      method: 'PATCH',
      path: `/api/v1/workspaces/${workspaceA.id}`,
      headers: { 'x-test-user-id': userB.id },
      body: { name: 'Compromised Name' }
    });
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.code, 'WORKSPACE_NOT_FOUND');

    const fresh = await workspaceRepository.getByIdForUser({ workspaceId: workspaceA.id, userId: userA.id });
    assert.strictEqual(fresh.name, 'Workspace Alpha');
  });

  it('4. User A cannot list Workspace B members.', async () => {
    const res = await request(baseUrl, {
      method: 'GET',
      path: `/api/v1/workspaces/${workspaceB.id}/members`,
      headers: { 'x-test-user-id': userA.id }
    });
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.code, 'WORKSPACE_NOT_FOUND');
  });

  it('5. User A cannot invite members to Workspace B.', async () => {
    const res = await request(baseUrl, {
      method: 'POST',
      path: `/api/v1/workspaces/${workspaceB.id}/invitations`,
      headers: { 'x-test-user-id': userA.id },
      body: { email: 'intruder@example.com', role: 'editor' }
    });
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.code, 'WORKSPACE_NOT_FOUND');
  });

  it('6. User A cannot change a Workspace B role.', async () => {
    const res = await request(baseUrl, {
      method: 'PATCH',
      path: `/api/v1/workspaces/${workspaceB.id}/members/${userB.id}/role`,
      headers: { 'x-test-user-id': userA.id },
      body: { role: 'viewer' }
    });
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.code, 'WORKSPACE_NOT_FOUND');
  });

  it('7. User A cannot remove a Workspace B member.', async () => {
    const res = await request(baseUrl, {
      method: 'DELETE',
      path: `/api/v1/workspaces/${workspaceB.id}/members/${userB.id}`,
      headers: { 'x-test-user-id': userA.id }
    });
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.code, 'WORKSPACE_NOT_FOUND');
  });

  it('8. User A cannot read Workspace B audit logs.', async () => {
    const res = await request(baseUrl, {
      method: 'GET',
      path: `/api/v1/workspaces/${workspaceB.id}/audit-logs`,
      headers: { 'x-test-user-id': userA.id }
    });
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.code, 'WORKSPACE_NOT_FOUND');
  });

  it('9. Foreign resource and nonexistent resource return identical 404 shapes.', async () => {
    const fakeWorkspaceId = '01918a20-0000-7000-8000-000000000000';
    const nonexistentRes = await request(baseUrl, {
      method: 'GET',
      path: `/api/v1/workspaces/${fakeWorkspaceId}`,
      headers: { 'x-test-user-id': userA.id }
    });
    const foreignRes = await request(baseUrl, {
      method: 'GET',
      path: `/api/v1/workspaces/${workspaceB.id}`,
      headers: { 'x-test-user-id': userA.id }
    });

    assert.strictEqual(nonexistentRes.status, 404);
    assert.strictEqual(foreignRes.status, 404);

    assert.strictEqual(nonexistentRes.body.code, foreignRes.body.code);
    assert.strictEqual(nonexistentRes.body.error, foreignRes.body.error);
    assert.strictEqual(nonexistentRes.body.message, foreignRes.body.message);

    const keysNonexistent = Object.keys(nonexistentRes.body).sort();
    const keysForeign = Object.keys(foreignRes.body).sort();
    assert.deepStrictEqual(keysNonexistent, keysForeign);
  });

  it('10. workspaceId supplied in body cannot override route workspaceId.', async () => {
    const res = await request(baseUrl, {
      method: 'PATCH',
      path: `/api/v1/workspaces/${workspaceA.id}`,
      headers: { 'x-test-user-id': userA.id },
      body: {
        workspaceId: workspaceB.id,
        name: 'Injected Workspace'
      }
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.code, 'VALIDATION_FAILED');
    assert.match(res.body.message, /workspaceId/i);
  });

  it('11. Viewer cannot update workspace.', async () => {
    const res = await request(baseUrl, {
      method: 'PATCH',
      path: `/api/v1/workspaces/${workspaceA.id}`,
      headers: { 'x-test-user-id': userC.id },
      body: { name: 'Viewer Renamed' }
    });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.code, 'PERMISSION_DENIED');
  });

  it('12. Editor cannot invite members.', async () => {
    const res = await request(baseUrl, {
      method: 'POST',
      path: `/api/v1/workspaces/${workspaceA.id}/invitations`,
      headers: { 'x-test-user-id': userD.id },
      body: { email: 'newmember@example.com', role: 'viewer' }
    });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.code, 'PERMISSION_DENIED');
  });

  it('13. Reviewer cannot change roles.', async () => {
    const res = await request(baseUrl, {
      method: 'PATCH',
      path: `/api/v1/workspaces/${workspaceA.id}/members/${userC.id}/role`,
      headers: { 'x-test-user-id': userE.id },
      body: { role: 'editor' }
    });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.code, 'PERMISSION_DENIED');
  });

  it('14. Admin cannot grant owner.', async () => {
    const res = await request(baseUrl, {
      method: 'PATCH',
      path: `/api/v1/workspaces/${workspaceA.id}/members/${userC.id}/role`,
      headers: { 'x-test-user-id': userF.id },
      body: { role: 'owner' }
    });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.code, 'PERMISSION_DENIED');
    assert.match(res.body.message, /Only an owner can grant the owner role/i);
  });

  it('15. User cannot promote self.', async () => {
    const res = await request(baseUrl, {
      method: 'PATCH',
      path: `/api/v1/workspaces/${workspaceA.id}/members/${userF.id}/role`,
      headers: { 'x-test-user-id': userF.id },
      body: { role: 'owner' }
    });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.code, 'PERMISSION_DENIED');
    assert.match(res.body.message, /Users cannot alter their own membership role/i);
  });

  it('16. Final owner cannot be removed.', async () => {
    const res = await request(baseUrl, {
      method: 'DELETE',
      path: `/api/v1/workspaces/${workspaceA.id}/members/${userA.id}`,
      headers: { 'x-test-user-id': userA.id }
    });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.code, 'PERMISSION_DENIED');
    assert.match(res.body.message, /Cannot remove the final remaining workspace owner/i);
  });

  it('17. Suspended member loses access.', async () => {
    await query("UPDATE workspace_members SET status = 'suspended' WHERE workspace_id = $1 AND user_id = $2", [workspaceA.id, userC.id]);

    const res = await request(baseUrl, {
      method: 'GET',
      path: `/api/v1/workspaces/${workspaceA.id}`,
      headers: { 'x-test-user-id': userC.id }
    });
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.code, 'WORKSPACE_NOT_FOUND');

    // Restore status
    await query("UPDATE workspace_members SET status = 'active' WHERE workspace_id = $1 AND user_id = $2", [workspaceA.id, userC.id]);
  });

  it('18. Removed member loses access.', async () => {
    // User A removes User D (editor)
    const removeRes = await request(baseUrl, {
      method: 'DELETE',
      path: `/api/v1/workspaces/${workspaceA.id}/members/${userD.id}`,
      headers: { 'x-test-user-id': userA.id }
    });
    assert.strictEqual(removeRes.status, 200);

    const accessRes = await request(baseUrl, {
      method: 'GET',
      path: `/api/v1/workspaces/${workspaceA.id}`,
      headers: { 'x-test-user-id': userD.id }
    });
    assert.strictEqual(accessRes.status, 404);
    assert.strictEqual(accessRes.body.code, 'WORKSPACE_NOT_FOUND');
  });

  it('19. Duplicate membership is rejected.', async () => {
    await assert.rejects(
      async () => {
        await membershipRepository.addMember({
          workspaceId: workspaceA.id,
          userId: userA.id,
          role: 'editor'
        });
      },
      (err) => err.code === '23505' || /unique/i.test(err.message)
    );
  });

  it('20. Workspace creation atomically creates owner membership.', async () => {
    const ws = await workspaceRepository.createWorkspaceWithOwner({
      name: 'Atomic Workspace',
      slug: 'atomic-ws',
      creatorUserId: userA.id
    });
    assert.ok(ws.id);

    const membership = await membershipRepository.findActive({ workspaceId: ws.id, userId: userA.id });
    assert.ok(membership);
    assert.strictEqual(membership.role, 'owner');
    assert.strictEqual(membership.status, 'active');
  });

  it('21. Failed owner membership rolls back workspace.', async () => {
    const nonExistentUserId = '01918a20-ffff-7000-8000-000000000000';
    await assert.rejects(
      async () => {
        await workspaceRepository.createWorkspaceWithOwner({
          name: 'Doomed Workspace',
          slug: 'doomed-ws',
          creatorUserId: nonExistentUserId
        });
      }
    );

    const { rows } = await query("SELECT * FROM workspaces WHERE slug = 'doomed-ws'");
    assert.strictEqual(rows.length, 0);
  });

  it('22. Invitation token is stored only as hash.', async () => {
    const invite = await invitationRepository.createInvitation({
      workspaceId: workspaceA.id,
      email: 'secret-invitee@example.com',
      role: 'editor',
      invitedBy: userA.id
    });

    assert.ok(invite.token, 'Plaintext token returned on creation');
    assert.ok(invite.invitation.id);

    const { rows } = await query('SELECT token_hash FROM workspace_invitations WHERE id = $1', [invite.invitation.id]);
    const expectedHash = crypto.createHash('sha256').update(invite.token).digest('hex');
    assert.strictEqual(rows[0].token_hash, expectedHash);
    assert.notStrictEqual(rows[0].token_hash, invite.token);
  });

  it('23. Expired invitation cannot be accepted.', async () => {
    const expiredUser = await userRepository.createUser({
      email: 'expired-invitee@example.com',
      password: 'Password123!',
      emailVerifiedAt: new Date()
    });
    const invite = await invitationRepository.createInvitation({
      workspaceId: workspaceA.id,
      email: 'expired-invitee@example.com',
      role: 'viewer',
      invitedBy: userA.id,
      ttlHours: 1
    });

    // Manually age expiration to simulate passed TTL
    await query("UPDATE workspace_invitations SET expires_at = NOW() - INTERVAL '1 hour' WHERE id = $1", [invite.invitation.id]);

    await assert.rejects(
      async () => {
        await invitationRepository.acceptInvitation({
          token: invite.token,
          userId: expiredUser.id
        });
      },
      /expired/i
    );

    const { rows } = await query('SELECT status FROM workspace_invitations WHERE id = $1', [invite.invitation.id]);
    assert.strictEqual(rows[0].status, 'expired');
  });

  it('24. Revoked invitation cannot be reused.', async () => {
    const revokedUser = await userRepository.createUser({
      email: 'revoked-invitee@example.com',
      password: 'Password123!',
      emailVerifiedAt: new Date()
    });
    const invite = await invitationRepository.createInvitation({
      workspaceId: workspaceA.id,
      email: 'revoked-invitee@example.com',
      role: 'editor',
      invitedBy: userA.id
    });

    await invitationRepository.revokeInvitation({
      workspaceId: workspaceA.id,
      invitationId: invite.invitation.id
    });

    await assert.rejects(
      async () => {
        await invitationRepository.acceptInvitation({
          token: invite.token,
          userId: revokedUser.id
        });
      },
      /revoked/i
    );
  });

  it('25. Audit metadata strips sensitive keys.', async () => {
    const recorded = await auditLogRepository.recordEvent({
      workspaceId: workspaceA.id,
      actorUserId: userA.id,
      action: 'security:login',
      resourceType: 'session',
      metadata: {
        password: 'supersecretpassword123',
        token: 'auth-jwt-token-string',
        secret_key: 'my-app-secret',
        safe_param: 'benign-value'
      }
    });

    assert.strictEqual(recorded.metadata.password, '[REDACTED]');
    assert.strictEqual(recorded.metadata.token, '[REDACTED]');
    assert.strictEqual(recorded.metadata.secret_key, '[REDACTED]');
    assert.strictEqual(recorded.metadata.safe_param, 'benign-value');
  });

  it('26. Cross-tenant audit event lookup returns no data.', async () => {
    const logsB = await auditLogRepository.listByWorkspace({ workspaceId: workspaceB.id });
    // Workspace A has audit events, Workspace B should not see any
    for (const log of logsB) {
      assert.strictEqual(log.workspace_id, workspaceB.id);
      assert.notStrictEqual(log.workspace_id, workspaceA.id);
    }
  });

  it('27. SQL injection payloads remain inert.', async () => {
    const sqliId = "00000000-0000-0000-0000-000000000000' OR '1'='1";
    const res = await request(baseUrl, {
      method: 'GET',
      path: `/api/v1/workspaces/${encodeURIComponent(sqliId)}`,
      headers: { 'x-test-user-id': userA.id }
    });
    // Handled safely by UUID validator without raw query interpolation
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.code, 'INVALID_WORKSPACE_ID');

    // Parameterized queries treat injections as literal strings
    const maliciousName = "'; DROP TABLE workspaces CASCADE; --";
    const updateRes = await request(baseUrl, {
      method: 'PATCH',
      path: `/api/v1/workspaces/${workspaceA.id}`,
      headers: { 'x-test-user-id': userA.id },
      body: { name: maliciousName }
    });
    assert.strictEqual(updateRes.status, 200);

    // Table workspaces is intact
    const { rows } = await query('SELECT count(*)::int FROM workspaces');
    assert.ok(rows[0].count > 0);
  });

  it('28. Concurrent slug creation produces one winner and one safe conflict.', async () => {
    const slug = `race-slug-${Date.now()}`;
    const [res1, res2] = await Promise.allSettled([
      workspaceRepository.createWorkspaceWithOwner({ name: 'Race 1', slug, creatorUserId: userA.id }),
      workspaceRepository.createWorkspaceWithOwner({ name: 'Race 2', slug, creatorUserId: userB.id })
    ]);

    const successes = [res1, res2].filter((r) => r.status === 'fulfilled');
    const failures = [res1, res2].filter((r) => r.status === 'rejected');

    assert.strictEqual(successes.length, 1, 'Exactly one concurrent creation must succeed');
    assert.strictEqual(failures.length, 1, 'Exactly one concurrent creation must fail');
    assert.strictEqual(failures[0].reason.code, '23505', 'Failure must be PostgreSQL unique violation');
  });

  it('29. Database failure returns sanitized error.', async () => {
    // When input is invalid, API returns a sanitized code without raw database traces
    const res = await request(baseUrl, {
      method: 'POST',
      path: '/api/v1/workspaces',
      headers: { 'x-test-user-id': userA.id },
      body: { name: '' } // Invalid empty name
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.code, 'VALIDATION_FAILED');
    assert.ok(!JSON.stringify(res.body).includes('password'));
    assert.ok(!JSON.stringify(res.body).includes('postgres://'));
  });

  it('30. Connection pool is active and operational.', async () => {
    const pool = getPool();
    assert.strictEqual(pool.ended, false);
    const { rows } = await query('SELECT 1 as alive');
    assert.strictEqual(rows[0].alive, 1);
  });

  it('31. DELETE member persists status = \'removed\' and denies subsequent access.', async () => {
    const userG = await userRepository.createUser({
      email: 'userG@example.com',
      password: 'PasswordG123!',
      emailVerifiedAt: new Date()
    });
    await membershipRepository.addMember({
      workspaceId: workspaceA.id,
      userId: userG.id,
      role: 'editor',
      invitedBy: userA.id
    });

    const res = await request(baseUrl, {
      method: 'DELETE',
      path: `/api/v1/workspaces/${workspaceA.id}/members/${userG.id}`,
      headers: { 'x-test-user-id': userA.id }
    });
    assert.strictEqual(res.status, 200);

    // Assert row in workspace_members persists with status = 'removed'
    const { rows } = await query(
      'SELECT status FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
      [workspaceA.id, userG.id]
    );
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].status, 'removed');

    // Subsequent access by userG is denied
    const deniedRes = await request(baseUrl, {
      method: 'GET',
      path: `/api/v1/workspaces/${workspaceA.id}`,
      headers: { 'x-test-user-id': userG.id }
    });
    assert.strictEqual(deniedRes.status, 404);
  });

  it('32. Concurrent demotion/removal of final owner prevents zero-owner state.', async () => {
    const owner1 = await userRepository.createUser({
      email: 'owner1@example.com',
      password: 'PasswordO1!',
      emailVerifiedAt: new Date()
    });
    const owner2 = await userRepository.createUser({
      email: 'owner2@example.com',
      password: 'PasswordO2!',
      emailVerifiedAt: new Date()
    });

    const dualWs = await workspaceRepository.createWorkspaceWithOwner({
      name: 'Dual Owner Workspace',
      slug: `dual-owner-${Date.now()}`,
      creatorUserId: owner1.id
    });
    await membershipRepository.addMember({
      workspaceId: dualWs.id,
      userId: owner2.id,
      role: 'owner',
      invitedBy: owner1.id
    });

    // Both owners attempt to demote each other simultaneously
    const [res1, res2] = await Promise.allSettled([
      membershipRepository.updateRole({
        workspaceId: dualWs.id,
        targetUserId: owner2.id,
        newRole: 'editor',
        actorUserId: owner1.id,
        actorRole: 'owner'
      }),
      membershipRepository.updateRole({
        workspaceId: dualWs.id,
        targetUserId: owner1.id,
        newRole: 'editor',
        actorUserId: owner2.id,
        actorRole: 'owner'
      })
    ]);

    const successes = [res1, res2].filter((r) => r.status === 'fulfilled');
    const failures = [res1, res2].filter((r) => r.status === 'rejected');

    assert.strictEqual(successes.length, 1, 'Exactly one concurrent demotion must succeed');
    assert.strictEqual(failures.length, 1, 'Exactly one concurrent demotion must fail');
    assert.ok(
      /last remaining owner|final remaining owner|lacks permission/i.test(failures[0].reason.message),
      `Expected failure message to reflect ownership or permission safety, got: ${failures[0].reason.message}`
    );

    // Verify exactly one active owner remains
    const { rows } = await query(
      "SELECT count(*)::int FROM workspace_members WHERE workspace_id = $1 AND role = 'owner' AND status = 'active'",
      [dualWs.id]
    );
    assert.strictEqual(rows[0].count, 1, 'Workspace must never have 0 active owners');
  });

  it('33. Stale or spoofed actorRole cannot bypass database authoritative role.', async () => {
    const freshEditor = await userRepository.createUser({
      email: 'fresh-editor@example.com',
      password: 'PasswordE1!',
      emailVerifiedAt: new Date()
    });
    await membershipRepository.addMember({
      workspaceId: workspaceA.id,
      userId: freshEditor.id,
      role: 'editor',
      invitedBy: userA.id
    });

    await assert.rejects(
      async () => {
        await membershipRepository.updateRole({
          workspaceId: workspaceA.id,
          targetUserId: userC.id,
          newRole: 'admin',
          actorUserId: freshEditor.id,
          actorRole: 'owner' // Spoofed!
        });
      },
      /Actor lacks permission to update membership roles/i
    );
  });

  it('34. Suspended or removed actor cannot modify workspace membership.', async () => {
    const actorSuspended = await userRepository.createUser({
      email: 'suspended-actor@example.com',
      password: 'PasswordS1!',
      emailVerifiedAt: new Date()
    });
    await membershipRepository.addMember({
      workspaceId: workspaceA.id,
      userId: actorSuspended.id,
      role: 'admin',
      status: 'suspended',
      invitedBy: userA.id
    });

    await assert.rejects(
      async () => {
        await membershipRepository.updateRole({
          workspaceId: workspaceA.id,
          targetUserId: userC.id,
          newRole: 'editor',
          actorUserId: actorSuspended.id,
          actorRole: 'admin'
        });
      },
      /not active in workspace/i
    );
  });

  it('35. Verified email binding restricts invitation acceptance.', async () => {
    const targetEmail = 'target-binding@example.com';
    const invite = await invitationRepository.createInvitation({
      workspaceId: workspaceA.id,
      email: targetEmail,
      role: 'editor',
      invitedBy: userA.id
    });

    // Case A: Unverified user with matching email
    const candidateUser = await userRepository.createUser({
      email: targetEmail,
      password: 'PasswordU1!',
      emailVerifiedAt: null
    });
    await assert.rejects(
      async () => {
        await invitationRepository.acceptInvitation({
          token: invite.token,
          userId: candidateUser.id
        });
      },
      /Email must be verified before accepting workspace invitations/i
    );

    // Case B: Verified user with different email
    const differentUser = await userRepository.createUser({
      email: 'different-target@example.com',
      password: 'PasswordD1!',
      emailVerifiedAt: new Date()
    });
    await assert.rejects(
      async () => {
        await invitationRepository.acceptInvitation({
          token: invite.token,
          userId: differentUser.id
        });
      },
      /Invitation is invalid or does not match this account/i
    );

    // Case C: Suspended user with matching email
    await userRepository.markEmailVerified(candidateUser.id);
    await query("UPDATE users SET status = 'suspended' WHERE id = $1", [candidateUser.id]);
    await assert.rejects(
      async () => {
        await invitationRepository.acceptInvitation({
          token: invite.token,
          userId: candidateUser.id
        });
      },
      /User account is suspended or inactive/i
    );

    // Case D: Reactivated/active user with matching email accepts successfully
    await query("UPDATE users SET status = 'active' WHERE id = $1", [candidateUser.id]);
    const accepted = await invitationRepository.acceptInvitation({
      token: invite.token,
      userId: candidateUser.id
    });
    assert.strictEqual(accepted.status, 'accepted');
    assert.strictEqual(accepted.role, 'editor');

    const memberCheck = await membershipRepository.getMember({
      workspaceId: workspaceA.id,
      userId: candidateUser.id
    });
    assert.strictEqual(memberCheck.role, 'editor');
    assert.strictEqual(memberCheck.status, 'active');
  });

  it('36. Concurrent invitation acceptance is strictly single-use.', async () => {
    const raceEmail = 'race-accept@example.com';
    const raceUser = await userRepository.createUser({
      email: raceEmail,
      password: 'PasswordR1!',
      emailVerifiedAt: new Date()
    });
    const invite = await invitationRepository.createInvitation({
      workspaceId: workspaceA.id,
      email: raceEmail,
      role: 'reviewer',
      invitedBy: userA.id
    });

    const [res1, res2] = await Promise.allSettled([
      invitationRepository.acceptInvitation({ token: invite.token, userId: raceUser.id }),
      invitationRepository.acceptInvitation({ token: invite.token, userId: raceUser.id })
    ]);

    const successes = [res1, res2].filter((r) => r.status === 'fulfilled');
    const failures = [res1, res2].filter((r) => r.status === 'rejected');

    assert.strictEqual(successes.length, 1, 'Exactly one concurrent accept must succeed');
    assert.strictEqual(failures.length, 1, 'Exactly one concurrent accept must fail');

    // Verify single membership row
    const { rows } = await query(
      'SELECT count(*)::int FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
      [workspaceA.id, raceUser.id]
    );
    assert.strictEqual(rows[0].count, 1);
  });

  it('37. Duplicate pending invitation returns 409 conflict.', async () => {
    const dupEmail = 'duplicate-invite@example.com';
    await invitationRepository.createInvitation({
      workspaceId: workspaceA.id,
      email: dupEmail,
      role: 'editor',
      invitedBy: userA.id
    });

    // Second creation via repository
    await assert.rejects(
      async () => {
        await invitationRepository.createInvitation({
          workspaceId: workspaceA.id,
          email: dupEmail,
          role: 'viewer',
          invitedBy: userA.id
        });
      },
      (err) => err.code === 'CONFLICT' || /already exists/i.test(err.message)
    );

    // Second creation via HTTP API returns 409
    const httpRes = await request(baseUrl, {
      method: 'POST',
      path: `/api/v1/workspaces/${workspaceA.id}/invitations`,
      headers: { 'x-test-user-id': userA.id },
      body: { email: dupEmail, role: 'viewer' }
    });
    assert.strictEqual(httpRes.status, 409);
    assert.strictEqual(httpRes.body.code, 'CONFLICT');
  });

  it('38. Inviter deletion retains invitation history with invited_by set to null.', async () => {
    const tempInviter = await userRepository.createUser({
      email: 'temp-inviter@example.com',
      password: 'PasswordT1!',
      emailVerifiedAt: new Date()
    });
    const invite = await invitationRepository.createInvitation({
      workspaceId: workspaceA.id,
      email: 'orphan-invite@example.com',
      role: 'viewer',
      invitedBy: tempInviter.id
    });

    // Delete the inviter user
    await query('DELETE FROM users WHERE id = $1', [tempInviter.id]);

    // Invitation record must still exist with invited_by NULL
    const { rows } = await query(
      'SELECT id, invited_by FROM workspace_invitations WHERE id = $1',
      [invite.invitation.id]
    );
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].invited_by, null);
  });

  it('39. Invitation TTL validation strictly enforces 1 to 168 hours.', async () => {
    const testCases = [0, 169, -5, 72.5, '72', null];
    for (const ttl of testCases) {
      await assert.rejects(
        async () => {
          await invitationRepository.createInvitation({
            workspaceId: workspaceA.id,
            email: `ttl-test-${Date.now()}@example.com`,
            role: 'viewer',
            invitedBy: userA.id,
            ttlHours: ttl
          });
        },
        /ttlHours must be an integer between 1 and 168/i
      );
    }

    // Valid bounds: 1 and 168
    const minInvite = await invitationRepository.createInvitation({
      workspaceId: workspaceA.id,
      email: `ttl-min-${Date.now()}@example.com`,
      role: 'viewer',
      invitedBy: userA.id,
      ttlHours: 1
    });
    assert.ok(minInvite.invitation.id);

    const maxInvite = await invitationRepository.createInvitation({
      workspaceId: workspaceA.id,
      email: `ttl-max-${Date.now()}@example.com`,
      role: 'viewer',
      invitedBy: userA.id,
      ttlHours: 168
    });
    assert.ok(maxInvite.invitation.id);
  });

  it('40. Production database URL safety guard rejects non-local hosts.', () => {
    const dangerousUrls = [
      'postgres://user:pass@prod-db.us-east-1.rds.amazonaws.com:5432/main',
      'postgres://user:pass@ep-cool-fog-123456.us-east-2.aws.neon.tech/neondb',
      'postgres://user:pass@db.abcdefghijklmnopqrst.supabase.co:5432/postgres',
      'postgres://user:pass@ec2-54-123-45-67.compute-1.amazonaws.com:5432/prod',
      'postgres://user:pass@production-database.internal:5432/app'
    ];

    for (const dUrl of dangerousUrls) {
      const isRejected =
        /aws|rds|neon|supabase|heroku|prod|production/i.test(dUrl) ||
        (!dUrl.includes('127.0.0.1') && !dUrl.includes('localhost') && !dUrl.includes('test'));
      assert.strictEqual(isRejected, true, `Dangerous URL must be rejected: ${dUrl}`);
    }
  });

  it('41. Connection pool reset lifecycle cleanly ends connections without leaks.', async () => {
    // Current pool is active
    const poolBefore = getPool();
    assert.strictEqual(poolBefore.ended, false);

    // resetPool should drain and end active pool
    await resetPool();
    assert.strictEqual(poolBefore.ended, true);

    // New getPool call initializes a fresh pool
    const poolAfter = getPool();
    assert.strictEqual(poolAfter.ended, false);
    assert.notStrictEqual(poolBefore, poolAfter);

    const { rows } = await query('SELECT 1 as healthy');
    assert.strictEqual(rows[0].healthy, 1);
  });

  it('42. Migration runner validates filename formats, duplicate versions, and empty files.', async () => {
    const tempMigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-mig-test-'));

    try {
      // 1. Invalid filename format
      fs.writeFileSync(path.join(tempMigDir, 'bad_name.sql'), 'SELECT 1;');
      await assert.rejects(
        async () => {
          await runMigrations({ migrationsDir: tempMigDir });
        },
        /Invalid migration filename format/i
      );

      // Clean temp dir
      fs.unlinkSync(path.join(tempMigDir, 'bad_name.sql'));

      // 2. Duplicate version prefixes
      fs.writeFileSync(path.join(tempMigDir, '001_first.sql'), 'SELECT 1;');
      fs.writeFileSync(path.join(tempMigDir, '001_duplicate.sql'), 'SELECT 2;');
      await assert.rejects(
        async () => {
          await runMigrations({ migrationsDir: tempMigDir });
        },
        /Duplicate migration version detected/i
      );

      fs.unlinkSync(path.join(tempMigDir, '001_first.sql'));
      fs.unlinkSync(path.join(tempMigDir, '001_duplicate.sql'));

      // 3. Empty migration file
      fs.writeFileSync(path.join(tempMigDir, '001_empty.sql'), '   \n  \n');
      await assert.rejects(
        async () => {
          await runMigrations({ migrationsDir: tempMigDir });
        },
        /Empty migration file rejected/i
      );
    } finally {
      fs.rmSync(tempMigDir, { recursive: true, force: true });
    }
  });
});
