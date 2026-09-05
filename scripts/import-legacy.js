// Explicit offline import: never assign existing data to the first person who signs up.
require('dotenv').config();
const fs = require('node:fs/promises');
const path = require('node:path');
const db = require('../services/db');
const context = require('../security/context');
const storage = require('../services/storage');
const media = require('../security/media');
async function main() {
  require('../config/env').validate();
  const [source, workspaceId, ownerEmail, queuePageId] = process.argv.slice(2);
  if (!source || !workspaceId || !ownerEmail)
    throw new Error(
      'Usage: npm run db:import-legacy -- /absolute/legacy/repository workspace-uuid owner@email [queue-page-id]'
    );
  const { rows } = await db.query(
    "SELECT 1 FROM workspace_members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND lower(u.email)=lower($2) AND m.role='owner' AND u.email_verified_at IS NOT NULL",
    [workspaceId, ownerEmail]
  );
  if (!rows.length)
    throw new Error('Verified owner and workspace do not match');
  const root = path.resolve(source),
    data = path.join(root, 'data');
  async function read(name, fallback) {
    try {
      return JSON.parse(await fs.readFile(path.join(data, name), 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return fallback;
      throw e;
    }
  }
  const settings = await read('settings.json', {}),
    queue = await read('queue.json', []),
    history = await read('history.json', []),
    templates = await read('templates.json', []),
    categories = await read('categories.json', []),
    rules = await read('automation_rules.json', {});
  if (queue.length && !queuePageId)
    throw new Error(
      'Legacy queue lacks destinations. Supply an explicit queue-page-id after reviewing every queued post.'
    );
  const mapped = new Map();
  await context.run(workspaceId, () =>
    db.transaction(async () => {
      if (
        (await storage.getConnectedPages()).length ||
        (await storage.getQueue()).length ||
        (await storage.getHistory()).length
      )
        throw new Error('Import requires an empty workspace; do not run twice');
      async function image(ref) {
        if (!ref || !ref.startsWith('/uploads/')) return ref;
        if (mapped.has(ref)) return mapped.get(ref);
        const name = ref.slice('/uploads/'.length);
        if (name !== path.basename(name) || name.includes('..'))
          throw new Error('Unsafe legacy media reference');
        const asset = await media.store(
          await fs.readFile(path.join(root, 'uploads', name))
        );
        mapped.set(ref, asset.url);
        return asset.url;
      }
      const pages =
        Array.isArray(settings.pages) && settings.pages.length
          ? settings.pages
          : settings.pageId
            ? [
                {
                  id: settings.pageId,
                  name: settings.pageName,
                  accessToken: settings.accessToken,
                  systemPrompt: settings.customSystemPrompt
                }
              ]
            : [];
      for (const p of pages)
        await storage.addConnectedPage({
          ...p,
          setAsActive: p.id === (settings.activePageId || settings.pageId),
          pictureUrl: await image(p.pictureUrl)
        });
      await storage.saveSettings({
        geminiApiKey: settings.geminiApiKey || '',
        customSystemPrompt:
          settings.customSystemPrompt ||
          (await storage.getDefaultSystemPrompt()),
        autoPostEnabled: false,
        autoPilotEnabled: false,
        isDemoMode: false,
        cronSchedule: settings.cronSchedule || '0 9,14,20 * * *',
        selectedCategories: settings.selectedCategories || []
      });
      for (const item of templates)
        await storage.addTemplate({
          ...item,
          imageUrl: await image(item.imageUrl)
        });
      for (const item of categories.filter((c) => !c.isDefault))
        await storage.addCategory(item);
      for (const item of history)
        await storage.addHistory({
          ...item,
          imageUrl: await image(item.imageUrl)
        });
      for (const item of queue) {
        const added = await storage.addToQueue({
          ...item,
          facebookPageId: queuePageId,
          imageUrl: await image(item.imageUrl)
        });
        if (item.status && item.status !== 'pending')
          await storage.updateQueueItem(added.id, {
            status: item.status === 'processing' ? 'needs_review' : item.status
          });
      }
      await storage.saveAutomationRules({
        ...rules,
        commentAutomationEnabled: false,
        chatAutomationEnabled: false
      });
    }, workspaceId)
  );
  console.log(
    'Import complete. Credentials encrypted; automation remains disabled. Verify each page and queued destination before enabling.'
  );
}
if (require.main === module)
  main()
    .catch((error) => {
      console.error(
        error.expose
          ? error.message
          : 'Import failed. Check arguments, ownership, and legacy data; nothing was committed.'
      );
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
module.exports = main;
