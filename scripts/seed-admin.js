'use strict';

require('dotenv').config();
const crypto = require('crypto');
const { getPool, closePool } = require('../db/index');
const passwords = require('../security/passwords');

async function seedAdmin() {
  const email = (process.env.ADMIN_EMAIL || 'susantalohr@gmail.com').trim();
  const password = process.env.ADMIN_PASSWORD || 'SusantaAdmin123!';
  const workspaceName = process.env.WORKSPACE_NAME || 'Susanta Media Workspace';
  const workspaceSlug = (process.env.WORKSPACE_SLUG || 'susanta-media').trim().toLowerCase();

  const normalizedEmail = email.toLowerCase();

  console.log(`🌱 Seeding admin account: ${email}`);

  if (!passwords.validPassword(password)) {
    throw new Error('Password must be at least 12 characters');
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Check or insert user
    const userRes = await client.query('SELECT * FROM users WHERE email_normalized = $1', [normalizedEmail]);
    let userId;
    if (userRes.rows.length === 0) {
      userId = crypto.randomUUID();
      const passwordHash = await passwords.hash(password);
      await client.query(
        `INSERT INTO users (id, email, email_normalized, password_hash, password_algorithm, status, email_verified_at, auth_version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'argon2id', 'active', NOW(), 0, NOW(), NOW())`,
        [userId, email, normalizedEmail, passwordHash]
      );
      console.log(`✅ Created user: ${email} (ID: ${userId})`);
    } else {
      userId = userRes.rows[0].id;
      const passwordHash = await passwords.hash(password);
      await client.query(
        `UPDATE users
         SET password_hash = $2, password_algorithm = 'argon2id', status = 'active', email_verified_at = COALESCE(email_verified_at, NOW()), updated_at = NOW()
         WHERE id = $1`,
        [userId, passwordHash]
      );
      console.log(`ℹ️ Updated existing user: ${email} (ID: ${userId})`);
    }

    // 2. Check or insert workspace
    const wsRes = await client.query('SELECT * FROM workspaces WHERE slug = $1', [workspaceSlug]);
    let workspaceId;
    if (wsRes.rows.length === 0) {
      workspaceId = crypto.randomUUID();
      await client.query(
        `INSERT INTO workspaces (id, name, slug, status, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, 'active', $4, NOW(), NOW())`,
        [workspaceId, workspaceName, workspaceSlug, userId]
      );
      console.log(`✅ Created workspace: ${workspaceName} (${workspaceSlug}) (ID: ${workspaceId})`);
    } else {
      workspaceId = wsRes.rows[0].id;
      console.log(`ℹ️ Existing workspace found: ${wsRes.rows[0].name} (ID: ${workspaceId})`);
    }

    // 3. Check or insert workspace member
    const memberRes = await client.query(
      'SELECT * FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
      [workspaceId, userId]
    );
    if (memberRes.rows.length === 0) {
      await client.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, status, joined_at, created_at, updated_at)
         VALUES ($1, $2, 'owner', 'active', NOW(), NOW(), NOW())`,
        [workspaceId, userId]
      );
      console.log(`✅ Assigned user as workspace owner`);
    } else {
      await client.query(
        `UPDATE workspace_members SET role = 'owner', status = 'active', updated_at = NOW() WHERE workspace_id = $1 AND user_id = $2`,
        [workspaceId, userId]
      );
      console.log(`ℹ️ Workspace membership verified (role: owner)`);
    }

    // 4. Initialize workspace settings if absent
    const settingsRes = await client.query('SELECT * FROM workspace_settings WHERE workspace_id = $1', [workspaceId]);
    if (settingsRes.rows.length === 0) {
      await client.query(
        `INSERT INTO workspace_settings (workspace_id, settings, created_at, updated_at)
         VALUES ($1, $2, NOW(), NOW())`,
        [workspaceId, JSON.stringify({ autoPostingEnabled: false, defaultIntervalHours: 2 })]
      );
      console.log(`✅ Initialized workspace settings`);
    }

    await client.query('COMMIT');
    console.log(`🎉 Super Admin successfully seeded!`);
    console.log(`   Email:     ${email}`);
    console.log(`   Workspace: ${workspaceName} (slug: ${workspaceSlug})`);
    console.log(`   Role:      owner`);

    return { userId, workspaceId, email };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to seed admin:', err.message);
    throw err;
  } finally {
    client.release();
    await closePool();
  }
}

if (require.main === module) {
  seedAdmin()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { seedAdmin };
