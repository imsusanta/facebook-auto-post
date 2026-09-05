// PostgreSQL-backed, workspace-scoped repository. No implicit global/default tenant.
const { randomUUID } = require('node:crypto');
const db = require('./db');
const context = require('../security/context');
const secrets = require('../security/secrets');
const {
  DEFAULT_TEMPLATES,
  DEFAULT_RULES,
  DEFAULT_CATEGORIES
} = require('./defaults');
const DEFAULT_SYSTEM_PROMPT =
  'ব্যবহারকারীর টপিক ও নির্দেশনা অনুযায়ী তথ্যবহুল, মৌলিক ফেসবুক পোস্ট তৈরি করো।';
const TABLES = new Set([
  'facebook_pages',
  'scheduled_posts',
  'post_history',
  'templates',
  'categories'
]);
function workspace() {
  return context.current().workspaceId;
}
function fail(message, statusCode = 400) {
  throw Object.assign(new Error(message), { statusCode, expose: true });
}
async function list(table) {
  if (!TABLES.has(table)) throw new Error('Invalid table');
  return (
    await db.query(
      `SELECT data FROM ${table} WHERE workspace_id=$1 ORDER BY id`,
      [workspace()]
    )
  ).rows.map((r) => secrets.open(r.data));
}
async function put(table, value) {
  if (!TABLES.has(table)) throw new Error('Invalid table');
  if (table === 'scheduled_posts')
    await db.query(
      `INSERT INTO scheduled_posts(workspace_id,id,facebook_page_id,data) VALUES($1,$2,$3,$4)
 ON CONFLICT(workspace_id,id) DO UPDATE SET data=excluded.data`,
      [workspace(), value.id, value.facebookPageId, secrets.seal(value)]
    );
  else
    await db.query(
      `INSERT INTO ${table}(workspace_id,id,data) VALUES($1,$2,$3) ON CONFLICT(workspace_id,id) DO UPDATE SET data=excluded.data`,
      [workspace(), value.id, secrets.seal(value)]
    );
  return value;
}
async function remove(table, id) {
  if (!TABLES.has(table)) throw new Error('Invalid table');
  await db.query(`DELETE FROM ${table} WHERE workspace_id=$1 AND id=$2`, [
    workspace(),
    id
  ]);
}
async function document(table) {
  if (!['workspace_settings', 'automation_rules'].includes(table))
    throw new Error('Invalid table');
  return secrets.open(
    (
      await db.query(`SELECT data FROM ${table} WHERE workspace_id=$1`, [
        workspace()
      ])
    ).rows[0]?.data || {}
  );
}
async function saveDocument(table, data) {
  if (!['workspace_settings', 'automation_rules'].includes(table))
    throw new Error('Invalid table');
  await db.query(
    `INSERT INTO ${table}(workspace_id,data) VALUES($1,$2) ON CONFLICT(workspace_id) DO UPDATE SET data=excluded.data`,
    [workspace(), secrets.seal(data)]
  );
  return data;
}
const storage = {
  async getDefaultSystemPrompt() {
    return DEFAULT_SYSTEM_PROMPT;
  },
  async getSettings() {
    const settings = {
      pageId: '',
      pageName: 'My Facebook Page',
      accessToken: '',
      geminiApiKey: '',
      autoPostEnabled: false,
      autoPilotEnabled: false,
      isDemoMode: false,
      cronSchedule: '0 9,14,20 * * *',
      customSystemPrompt: DEFAULT_SYSTEM_PROMPT,
      ...(await document('workspace_settings'))
    };
    const page = await this.getActivePage();
    if (page)
      Object.assign(settings, {
        pageId: page.id,
        pageName: page.name,
        accessToken: page.accessToken || '',
        pictureUrl: page.pictureUrl || '',
        customSystemPrompt: page.systemPrompt || settings.customSystemPrompt
      });
    return settings;
  },
  async saveSettings(updates) {
    const data = await document('workspace_settings');
    // Credentials are write-only: an empty form field means unchanged.
    if (!updates.geminiApiKey) delete updates.geminiApiKey;
    const page = await this.getActivePage();
    if (page) {
      if (updates.accessToken) page.accessToken = updates.accessToken;
      if (updates.pageName) page.name = updates.pageName;
      if (typeof updates.customSystemPrompt === 'string')
        page.systemPrompt = updates.customSystemPrompt;
      await put('facebook_pages', page);
    } else if (updates.accessToken || updates.pageId)
      fail('Connect and verify a Facebook page first');
    const { pageId, pageName, accessToken, pages, activePageId, ...safe } =
      updates;
    await saveDocument('workspace_settings', {
      ...data,
      ...safe,
      updatedAt: new Date().toISOString()
    });
    return this.getSettings();
  },
  async getConnectedPages() {
    const pages = await list('facebook_pages'),
      settings = await document('workspace_settings');
    return pages.map((p) => ({
      ...p,
      isActive: p.id === settings.activePageId
    }));
  },
  async getActivePage() {
    const s = await document('workspace_settings'),
      pages = await list('facebook_pages');
    const target = context.current().targetPageId || s.activePageId;
    return (
      pages.find((p) => p.id === target) || (!target ? pages[0] : null) || null
    );
  },
  async getPageById(id) {
    return (await list('facebook_pages')).find((p) => p.id === id) || null;
  },
  async getPageSystemPrompt(id) {
    const page = id ? await this.getPageById(id) : await this.getActivePage();
    if (id && !page) fail('Page not found', 404);
    return page?.systemPrompt || DEFAULT_SYSTEM_PROMPT;
  },
  async addConnectedPage(data) {
    if (!/^\d{1,40}$/.test(data.id)) fail('Invalid Facebook Page ID');
    const elsewhere = await db.query(
      'SELECT workspace_id FROM facebook_pages WHERE id=$1',
      [data.id]
    );
    if (elsewhere.rows[0] && elsewhere.rows[0].workspace_id !== workspace())
      fail('Page cannot be connected', 409);
    const existing = await this.getPageById(data.id);
    const page = {
      ...existing,
      id: data.id,
      name: data.name || 'Facebook Page',
      accessToken: data.accessToken,
      pictureUrl: data.pictureUrl || '',
      category: data.category || 'General',
      systemPrompt: data.systemPrompt || DEFAULT_SYSTEM_PROMPT,
      connectedAt: new Date().toISOString()
    };
    await put('facebook_pages', page);
    if (
      data.setAsActive ||
      !(await document('workspace_settings')).activePageId
    )
      await this.setActivePage(page.id);
    return page;
  },
  async updateConnectedPage(id, updates) {
    const old = await this.getPageById(id);
    if (!old) return null;
    return put('facebook_pages', { ...old, ...updates, id: old.id });
  },
  async setActivePage(id) {
    const page = await this.getPageById(id);
    if (!page) return null;
    await saveDocument('workspace_settings', {
      ...(await document('workspace_settings')),
      activePageId: id
    });
    return page;
  },
  async removeConnectedPage(id) {
    if ((await this.getQueue()).some((j) => j.facebookPageId === id))
      fail('Remove queued jobs for this page before disconnecting');
    await remove('facebook_pages', id);
    const pages = await list('facebook_pages');
    const s = await document('workspace_settings');
    if (s.activePageId === id)
      await saveDocument('workspace_settings', {
        ...s,
        activePageId: pages[0]?.id || null
      });
    return pages;
  },
  async getCategories() {
    const rows = await list('categories');
    if (rows.length) return rows;
    for (const item of DEFAULT_CATEGORIES) await put('categories', item);
    return structuredClone(DEFAULT_CATEGORIES);
  },
  async addCategory(data) {
    const item = { ...data, id: 'cat_' + randomUUID(), isDefault: false };
    await put('categories', item);
    return item;
  },
  async updateCategory(id, data) {
    const old = (await this.getCategories()).find((v) => v.id === id);
    return old ? put('categories', { ...old, ...data, id: old.id }) : null;
  },
  async deleteCategory(id) {
    await remove('categories', id);
    return this.getCategories();
  },
  async getHistory() {
    return (await list('post_history')).sort((a, b) =>
      b.timestamp.localeCompare(a.timestamp)
    );
  },
  async addHistory(entry) {
    return put('post_history', {
      ...entry,
      id: 'hist_' + randomUUID(),
      timestamp: new Date().toISOString(),
      status: entry.status || 'success',
      facebookPageId:
        entry.facebookPageId || (await this.getActivePage())?.id || null
    });
  },
  async clearHistory() {
    await db.query('DELETE FROM post_history WHERE workspace_id=$1', [
      workspace()
    ]);
    return [];
  },
  async getQueue() {
    return (await list('scheduled_posts')).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt)
    );
  },
  async addToQueue(data) {
    const page = data.facebookPageId
      ? await this.getPageById(data.facebookPageId)
      : await this.getActivePage();
    if (!page) fail('Connect a Facebook page first');
    const item = {
      id: 'queue_' + randomUUID(),
      facebookPageId: page.id,
      message: data.message || '',
      imageUrl: data.imageUrl || null,
      scheduledAt: data.scheduledAt
        ? new Date(data.scheduledAt).toISOString()
        : null,
      createdAt: new Date().toISOString(),
      status: 'pending'
    };
    return put('scheduled_posts', item);
  },
  async updateQueueItem(id, updates) {
    const item = (await this.getQueue()).find((j) => j.id === id);
    if (!item) return null;
    return put('scheduled_posts', {
      ...item,
      ...updates,
      id: item.id,
      facebookPageId: item.facebookPageId
    });
  },
  async claimQueueItem(id) {
    const item = (await this.getQueue()).find((j) => j.id === id);
    if (!item || item.status !== 'pending') return null;
    return this.updateQueueItem(id, {
      status: 'processing',
      processingAt: new Date().toISOString()
    });
  },
  async removeFromQueue(id) {
    const item = (await this.getQueue()).find((j) => j.id === id);
    if (item?.status === 'processing')
      fail('Cannot remove a processing job', 409);
    await remove('scheduled_posts', id);
    return this.getQueue();
  },
  async getAutomationRules() {
    const saved = await document('automation_rules');
    return {
      ...structuredClone(DEFAULT_RULES),
      commentAutomationEnabled: false,
      chatAutomationEnabled: false,
      ...saved
    };
  },
  async saveAutomationRules(data) {
    return saveDocument('automation_rules', {
      ...(await this.getAutomationRules()),
      ...data
    });
  },
  async addCommentRule(data) {
    const s = await this.getAutomationRules();
    const rule = {
      ...data,
      id: 'rule_' + randomUUID(),
      keywords: Array.isArray(data.keywords)
        ? data.keywords
        : String(data.keywords || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
    };
    s.commentRules = [...(s.commentRules || []), rule];
    await saveDocument('automation_rules', s);
    return rule;
  },
  async deleteCommentRule(id) {
    const s = await this.getAutomationRules();
    s.commentRules = (s.commentRules || []).filter((r) => r.id !== id);
    await saveDocument('automation_rules', s);
    return s.commentRules;
  },
  async getTemplates() {
    const data = await list('templates');
    const s = await document('workspace_settings');
    if (!s.templatesInitialized) {
      for (const t of DEFAULT_TEMPLATES) await put('templates', t);
      await saveDocument('workspace_settings', {
        ...s,
        templatesInitialized: true
      });
      return list('templates');
    }
    return data;
  },
  async getTemplateById(id) {
    return (await this.getTemplates()).find((t) => t.id === id) || null;
  },
  async addTemplate(data) {
    return put('templates', {
      ...data,
      id: 'template_' + randomUUID(),
      createdAt: new Date().toISOString()
    });
  },
  async updateTemplate(id, data) {
    const old = await this.getTemplateById(id);
    return old ? put('templates', { ...old, ...data, id: old.id }) : null;
  },
  async deleteTemplate(id) {
    await remove('templates', id);
    return this.getTemplates();
  }
};
// Serialise each read-modify-write operation per workspace, including across processes.
for (const [name, fn] of Object.entries(storage))
  storage[name] = function (...args) {
    const id = workspace();
    return db.transaction(() => fn.apply(storage, args), id);
  };
module.exports = storage;
