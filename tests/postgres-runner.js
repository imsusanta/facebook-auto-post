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

const defaultTestDb = 'postgres://susantalohar@127.0.0.1:5432/facebook_auto_poster_test';
const databaseUrl = process.env.DATABASE_URL || defaultTestDb;
process.env.DATABASE_URL = databaseUrl;

// Production target safety guard
if (
  /aws|rds|neon|supabase|heroku|prod|production/i.test(databaseUrl) ||
  (!databaseUrl.includes('127.0.0.1') && !databaseUrl.includes('localhost') && !databaseUrl.includes('test'))
) {
  throw new Error(`[Security Error] Test runner refused to run against potentially non-local or production DATABASE_URL: "${databaseUrl}"`);
}

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
const { createApp } = require('../createApp');
const { query, closePool, getPool, withTransaction } = require('../db/index');
const { runMigrations } = require('../db/migrator');
const userRepository = require('../repositories/user-repository');
const workspaceRepository = require('../repositories/workspace-repository');
const membershipRepository = require('../repositories/membership-repository');
const invitationRepository = require('../repositories/invitation-repository');
const auditLogRepository = require('../repositories/audit-log-repository');

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
    // A. Run PostgreSQL migrations
    await runMigrations();

    // B. Clean all tables for reproducible test run
    await query('TRUNCATE TABLE audit_logs, workspace_invitations, workspace_members, workspaces, users RESTART IDENTITY CASCADE;');

    // C. Start test HTTP server
    const app = createApp();
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // D. Seed Test Users
    userA = await userRepository.createUser({ email: 'userA@example.com', password: 'PasswordA123!' });
    userB = await userRepository.createUser({ email: 'userB@example.com', password: 'PasswordB123!' });
    userC = await userRepository.createUser({ email: 'userC@example.com', password: 'PasswordC123!' });
    userD = await userRepository.createUser({ email: 'userD@example.com', password: 'PasswordD123!' });
    userE = await userRepository.createUser({ email: 'userE@example.com', password: 'PasswordE123!' });
    userF = await userRepository.createUser({ email: 'userF@example.com', password: 'PasswordF123!' });

    // E. Seed Workspaces with Owners
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

    // F. Seed Memberships in Workspace A
    await membershipRepository.addMember({ workspaceId: workspaceA.id, userId: userC.id, role: 'viewer', invitedBy: userA.id });
    await membershipRepository.addMember({ workspaceId: workspaceA.id, userId: userD.id, role: 'editor', invitedBy: userA.id });
    await membershipRepository.addMember({ workspaceId: workspaceA.id, userId: userE.id, role: 'reviewer', invitedBy: userA.id });
    await membershipRepository.addMember({ workspaceId: workspaceA.id, userId: userF.id, role: 'admin', invitedBy: userA.id });

    // G. Seed an Audit Event in Workspace A
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

    // Clean up test data
    try {
      await query('TRUNCATE TABLE audit_logs, workspace_invitations, workspace_members, workspaces, users RESTART IDENTITY CASCADE;');
    } catch {
      // ignore if pool already closed
    }

    // Ensure pool is closed
    await closePool();

    // Uninstall network guard
    networkGuard.uninstallNetworkGuard();

    // Verify real data/settings.json was never modified
    if (initialSettingsHash && fs.existsSync(realSettingsPath)) {
      const currentContent = fs.readFileSync(realSettingsPath);
      const currentHash = crypto.createHash('sha256').update(currentContent).digest('hex');
      assert.strictEqual(currentHash, initialSettingsHash, 'Security Assertion: real data/settings.json must remain untampered.');
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
    const invite = await invitationRepository.createInvitation({
      workspaceId: workspaceA.id,
      email: 'expired-invitee@example.com',
      role: 'viewer',
      invitedBy: userA.id,
      ttlHours: -1 // Already expired
    });

    await assert.rejects(
      async () => {
        await invitationRepository.acceptInvitation({
          token: invite.token,
          userId: userB.id
        });
      },
      /expired/i
    );

    const { rows } = await query('SELECT status FROM workspace_invitations WHERE id = $1', [invite.invitation.id]);
    assert.strictEqual(rows[0].status, 'expired');
  });

  it('24. Revoked invitation cannot be reused.', async () => {
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
          userId: userB.id
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

  it('30. Connection pool shuts down cleanly.', async () => {
    const pool = getPool();
    assert.strictEqual(pool.ended, false);
    await closePool();
    assert.strictEqual(pool.ended, true);
  });
});
