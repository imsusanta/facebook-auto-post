/**
 * DEPRECATED / LEGACY MODULE: services/db.js
 *
 * WARNING: This SQLite implementation is completely unimported, unused, and deprecated.
 * It is NOT used as the production or testing database.
 * The production SaaS database is PostgreSQL 16 managed via db/index.js and migrations/postgres/.
 * This file is retained temporarily solely for legacy compatibility reference.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, '..', 'data', 'saas.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Initialize SaaS Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    plan TEXT DEFAULT 'pro',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    user_id TEXT PRIMARY KEY,
    page_id TEXT DEFAULT '',
    page_name TEXT DEFAULT '',
    page_access_token TEXT DEFAULT '',
    gemini_api_key TEXT DEFAULT '',
    is_demo_mode INTEGER DEFAULT 0,
    auto_post_enabled INTEGER DEFAULT 1,
    auto_pilot_cron TEXT DEFAULT '0 9,14,20 * * *',
    custom_system_prompt TEXT DEFAULT '',
    auto_comment_reply_enabled INTEGER DEFAULT 1,
    auto_chat_reply_enabled INTEGER DEFAULT 1,
    auto_reply_ai_prompt TEXT DEFAULT '',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS scheduled_posts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    message TEXT NOT NULL,
    image_url TEXT,
    category TEXT DEFAULT '',
    scheduled_at TEXT,
    status TEXT DEFAULT 'pending',
    fb_post_id TEXT,
    error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS post_history (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT,
    image_url TEXT,
    fb_post_id TEXT,
    fb_url TEXT,
    error TEXT,
    source TEXT DEFAULT 'manual',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS auto_reply_rules (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    channel TEXT NOT NULL, -- 'comment' or 'chat'
    keyword TEXT DEFAULT '*',
    reply_text TEXT DEFAULT '',
    use_ai INTEGER DEFAULT 1,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS conversation_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    channel TEXT NOT NULL, -- 'comment' or 'chat'
    sender_id TEXT,
    sender_name TEXT,
    incoming_text TEXT NOT NULL,
    reply_text TEXT NOT NULL,
    fb_post_id TEXT,
    fb_comment_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// Seed or migrate default user from settings.json if exists
function seedDefaultAdmin() {
  const isDevOrTest = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
  const initialPassword = process.env.ADMIN_INITIAL_PASSWORD || process.env.ADMIN_PASSWORD || (isDevOrTest ? 'admin123' : null);
  if (!initialPassword) return;

  const existingUser = db.prepare('SELECT id FROM users LIMIT 1').get();
  if (!existingUser) {
    const adminId = 'usr_admin_' + Date.now();
    const defaultPasswordHash = bcrypt.hashSync(initialPassword, 10);

    // Read old settings if present
    let oldSettings = {};
    const oldSettingsPath = path.join(__dirname, '..', 'data', 'settings.json');
    if (fs.existsSync(oldSettingsPath)) {
      try {
        oldSettings = JSON.parse(fs.readFileSync(oldSettingsPath, 'utf8'));
      } catch (e) {}
    }

    db.prepare(`
      INSERT INTO users (id, email, password_hash, name, role, plan)
      VALUES (?, ?, ?, ?, 'admin', 'agency')
    `).run(
      adminId,
      'admin@autopost.io',
      defaultPasswordHash,
      oldSettings.pageName || 'Sushanta Digital'
    );

    db.prepare(`
      INSERT INTO user_settings (
        user_id, page_id, page_name, page_access_token, gemini_api_key,
        is_demo_mode, auto_post_enabled, auto_pilot_cron, custom_system_prompt,
        auto_comment_reply_enabled, auto_chat_reply_enabled, auto_reply_ai_prompt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)
    `).run(
      adminId,
      oldSettings.pageId || '',
      oldSettings.pageName || 'My Facebook Page',
      oldSettings.accessToken || '',
      oldSettings.geminiApiKey || '',
      oldSettings.isDemoMode ? 1 : 0,
      oldSettings.autoPostEnabled !== false ? 1 : 0,
      '0 9,14,20 * * *',
      oldSettings.customSystemPrompt || 'তুমি ফেসবুক পেজের জন্য একজন দক্ষ কনটেন্ট ক্রিয়েটর।',
      'তুমি একজন অত্যন্ত বিনয়ী, সহায়ক ও প্রফেশনাল ফেসবুক পেজ অ্যাসিস্ট্যান্ট। ব্যবহারকারীর প্রশ্ন বা মন্তব্যের সুন্দর ও প্রাঞ্জল বাংলায় উত্তর দাও।'
    );

    // Seed default auto reply rules
    const rule1Id = 'rule_comment_' + Date.now();
    db.prepare(`
      INSERT INTO auto_reply_rules (id, user_id, channel, keyword, reply_text, use_ai, is_active)
      VALUES (?, ?, 'comment', '*', 'সুন্দর মন্তব্যের জন্য ধন্যবাদ! আরও তথ্যের জন্য আমাদের পেজ ফলো রাখুন।', 1, 1)
    `).run(rule1Id, adminId);

    const rule2Id = 'rule_chat_' + Date.now();
    db.prepare(`
      INSERT INTO auto_reply_rules (id, user_id, channel, keyword, reply_text, use_ai, is_active)
      VALUES (?, ?, 'chat', '*', 'হ্যালো! আমাদের পেজে আপনাকে স্বাগতম। কীভাবে আপনাকে সাহায্য করতে পারি?', 1, 1)
    `).run(rule2Id, adminId);

    console.log('[Database] Default admin user initialized: admin@autopost.io / admin123');
  }
}

seedDefaultAdmin();

module.exports = db;
