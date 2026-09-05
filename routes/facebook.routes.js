const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const media = require('../security/media');
const { validatePost } = require('../security/validation');
const context = require('../security/context');
const facebook = require('../services/facebook');
const storage = require('../services/storage');
const upload = require('../middleware/upload');
const { broadcastSSE } = require('../middleware/sse');

// POST /api/post (or /api/facebook/post) - Instant Post Publishing
router.post(
  '/post',
  require('../middleware/idempotency'),
  upload.single('image'),
  validatePost,
  async (req, res) => {
    const publishing = require('../services/publishing');
    const item = await publishing.enqueue({
      ...req.body,
      imageUrl: req.file?.url || req.body.imageUrl,
      source: 'manual',
      operationKey: req.operationKey
    });
    if (item.replayed && req.file && item.imageUrl !== req.file.url)
      await media.remove(req.file.filename);
    const result = item.id
      ? await publishing.processJob(item.id, { forceDue: true })
      : item;
    publishing.respond(res, result);
  }
);

// GET /api/facebook/account - Returns currently active page account info
router.get('/account', async (req, res, next) => {
  const activePage = await storage.getActivePage();
  const settings = await storage.getSettings();
  try {
    const pageId = activePage?.id || settings.pageId || '';
    const pageName =
      activePage?.name || settings.pageName || 'My Facebook Page';
    let pictureUrl = activePage?.pictureUrl || settings.pictureUrl || '';

    res.json({
      success: true,
      pageId,
      pageName,
      pictureUrl,
      category: activePage?.category || 'Education & Notes',
      connected: !!(activePage?.accessToken || settings.accessToken),
      pagesCount: (await storage.getConnectedPages()).length
    });
  } catch (err) {
    next(err);
  }
});

// ================= MULTI-PAGE MANAGEMENT APIS =================

// GET /api/facebook/pages - List all connected pages
router.get('/pages', async (req, res) => {
  const s = await storage.getSettings();
  const pages = await storage.getConnectedPages();
  res.json({
    success: true,
    activePageId: s.activePageId || pages[0]?.id,
    activePage: await storage.getActivePage(),
    pages
  });
});

// POST /api/facebook/pages - Connect new page with Graph API verification
router.post('/pages', async (req, res, next) => {
  const { pageId, accessToken, name, setAsActive = true } = req.body;
  if (!pageId || !accessToken) {
    return res
      .status(400)
      .json({
        success: false,
        error: 'Page ID and Access Token are required.'
      });
  }

  try {
    let verifiedName = name;
    let pictureUrl = '/pariksha_notes_logo.jpg';
    let category = 'General';

    const info = await facebook.verifyConnection(pageId, accessToken);
    if (info.pageId !== pageId.trim())
      return res
        .status(400)
        .json({ error: 'Token does not belong to the requested page' });
    verifiedName = info.pageName || verifiedName || 'Facebook Page';
    category = info.category || 'General';
    pictureUrl = info.pictureUrl || '';

    const addedPage = await storage.addConnectedPage({
      id: pageId.trim(),
      name: verifiedName.trim(),
      accessToken: accessToken.trim(),
      pictureUrl,
      category,
      setAsActive: !!setAsActive
    });

    broadcastSSE('page_switched', {
      activePage: await storage.getActivePage(),
      pages: await storage.getConnectedPages()
    });

    res.json({
      success: true,
      page: addedPage,
      pages: await storage.getConnectedPages(),
      activePageId: (await storage.getActivePage())?.id
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/facebook/pages/switch - Switch active Facebook Page
router.post('/pages/switch', async (req, res) => {
  const { pageId } = req.body;
  if (!pageId) {
    return res
      .status(400)
      .json({ success: false, error: 'Page ID is required to switch.' });
  }

  const switched = await storage.setActivePage(pageId);
  if (!switched) {
    return res
      .status(404)
      .json({ success: false, error: 'Page not found in connected pages.' });
  }

  broadcastSSE('page_switched', {
    activePage: switched,
    pages: await storage.getConnectedPages()
  });

  res.json({
    success: true,
    activePage: switched,
    pages: await storage.getConnectedPages()
  });
});

// GET /api/facebook/pages/:id - Get single page details including systemPrompt
router.get('/pages/:id', async (req, res) => {
  const page = await storage.getPageById(req.params.id);
  if (!page) {
    return res.status(404).json({ success: false, error: 'Page not found.' });
  }
  res.json({ success: true, page });
});

// PUT /api/facebook/pages/:id - Edit connected page info and custom system prompt
router.put('/pages/:id', async (req, res, next) => {
  const { name, category, accessToken, systemPrompt, pictureUrl } = req.body;
  try {
    const existing = await storage.getPageById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Page not found.' });
    }

    if (accessToken) {
      const info = await facebook.verifyConnection(req.params.id, accessToken);
      if (info.pageId !== req.params.id)
        return res.status(400).json({ error: 'Token does not match page' });
    }
    const updates = {};
    if (typeof name === 'string' && name.trim()) updates.name = name.trim();
    if (typeof category === 'string' && category.trim())
      updates.category = category.trim();
    if (typeof accessToken === 'string' && accessToken.trim())
      updates.accessToken = accessToken.trim();
    if (typeof systemPrompt === 'string')
      updates.systemPrompt = systemPrompt.trim();
    if (typeof pictureUrl === 'string' && pictureUrl.trim())
      updates.pictureUrl = pictureUrl.trim();

    const updated = await storage.updateConnectedPage(req.params.id, updates);
    broadcastSSE('page_switched', {
      activePage: await storage.getActivePage(),
      pages: await storage.getConnectedPages()
    });

    res.json({
      success: true,
      page: updated,
      pages: await storage.getConnectedPages(),
      activePage: await storage.getActivePage()
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/facebook/pages/:id - Disconnect a Facebook Page
router.delete('/pages/:id', async (req, res) => {
  try {
    const remaining = await storage.removeConnectedPage(req.params.id);
    broadcastSSE('page_switched', {
      activePage: await storage.getActivePage(),
      pages: remaining
    });
    res.json({
      success: true,
      pages: remaining,
      activePage: await storage.getActivePage()
    });
  } catch (err) {
    res
      .status(400)
      .json({
        success: false,
        error: 'Operation failed. Check settings and try again.'
      });
  }
});

// POST /api/facebook/test-connection
router.post('/test-connection', async (req, res) => {
  const settings = await storage.getSettings();
  const pageId = req.body.pageId || settings.pageId;
  const accessToken = req.body.accessToken || settings.accessToken;

  try {
    const info = await facebook.verifyConnection(pageId, accessToken);
    res.json({ success: true, info });
  } catch (err) {
    res
      .status(400)
      .json({
        success: false,
        error: 'Operation failed. Check settings and try again.'
      });
  }
});

// GET /api/facebook/logo
router.get('/logo', async (req, res) => {
  const settings = await storage.getSettings();
  const logoPath = path.join(
    __dirname,
    '..',
    'public',
    'pariksha_notes_logo.jpg'
  );
  if (fs.existsSync(logoPath)) {
    return res.json({ success: true, url: '/pariksha_notes_logo.jpg' });
  }
  if (settings.pageId) {
    const fetched = await facebook.fetchPagePicture(settings.pageId);
    if (fetched) return res.json({ success: true, url: fetched });
  }
  res.json({ success: false, url: null });
});

// POST /api/facebook/refresh-logo
router.post('/refresh-logo', async (req, res, next) => {
  const active = await storage.getActivePage();
  const pageId = req.body.pageId || active?.id || '';
  try {
    const fetched = await facebook.fetchPagePicture(pageId);
    if (fetched) {
      if (active && active.id === pageId) {
        active.pictureUrl = fetched;
        await storage.saveSettings({ pictureUrl: fetched });
      }
      return res.json({ success: true, url: fetched });
    }
    res.json({ success: false, error: 'Could not fetch logo from Facebook' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
