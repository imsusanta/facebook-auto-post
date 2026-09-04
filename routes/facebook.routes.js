const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const facebook = require('../services/facebook');
const storage = require('../services/storage');
const upload = require('../middleware/upload');
const { broadcastSSE } = require('../middleware/sse');

// POST /api/post (or /api/facebook/post) - Instant Post Publishing
router.post('/post', upload.single('image'), async (req, res, next) => {
  const message = req.body.message || '';
  let imageUrl = req.body.imageUrl || '';
  const isDemo = req.body.isDemo === 'true' || req.body.isDemo === true;
  let imagePath = req.file ? req.file.path : null;

  // Resolve local uploaded or AI generated thumbnail
  if (!imagePath && imageUrl && imageUrl.startsWith('/uploads/')) {
    const localFile = path.join(__dirname, '..', imageUrl);
    if (fs.existsSync(localFile)) {
      imagePath = localFile;
      imageUrl = null;
    }
  }

  try {
    broadcastSSE('posting_started', { message, timestamp: new Date().toISOString() });
    
    const result = await facebook.publishPost({
      message,
      imagePath,
      imageUrl,
      isDemo,
      source: 'manual'
    });

    broadcastSSE('history_updated', storage.getHistory());
    res.json(result);
  } catch (err) {
    broadcastSSE('history_updated', storage.getHistory());
    next(err);
  }
});

// GET /api/facebook/account - Returns currently active page account info
router.get('/account', async (req, res, next) => {
  const activePage = storage.getActivePage();
  const settings = storage.getSettings();
  try {
    const pageId = activePage?.id || settings.pageId || '';
    const pageName = activePage?.name || settings.pageName || 'My Facebook Page';
    let pictureUrl = activePage?.pictureUrl || settings.pictureUrl || '';
    
    res.json({
      success: true,
      pageId,
      pageName,
      pictureUrl,
      category: activePage?.category || 'Education & Notes',
      connected: !!(activePage?.accessToken || settings.accessToken),
      pagesCount: storage.getConnectedPages().length
    });
  } catch (err) {
    next(err);
  }
});

// ================= MULTI-PAGE MANAGEMENT APIS =================

// GET /api/facebook/pages - List all connected pages
router.get('/pages', (req, res) => {
  const s = storage.getSettings();
  const pages = storage.getConnectedPages();
  res.json({
    success: true,
    activePageId: s.activePageId || pages[0]?.id,
    activePage: storage.getActivePage(),
    pages
  });
});

// POST /api/facebook/pages - Connect new page with Graph API verification
router.post('/pages', async (req, res, next) => {
  const { pageId, accessToken, name, setAsActive = true } = req.body;
  if (!pageId || !accessToken) {
    return res.status(400).json({ success: false, error: 'Page ID and Access Token are required.' });
  }

  try {
    let verifiedName = name;
    let pictureUrl = '/pariksha_notes_logo.jpg';
    let category = 'General';

    try {
      const info = await facebook.verifyConnection(pageId, accessToken);
      if (info.pageName) verifiedName = info.pageName;
      if (info.category) category = info.category;

      const fetchedPic = await facebook.fetchPagePicture(pageId);
      if (fetchedPic) pictureUrl = fetchedPic;
    } catch (graphErr) {
      console.warn('[Facebook Add Page] Could not auto-fetch info from Graph API:', graphErr.message);
      if (!verifiedName) verifiedName = `Facebook Page (${pageId})`;
    }

    const addedPage = storage.addConnectedPage({
      id: pageId.trim(),
      name: verifiedName.trim(),
      accessToken: accessToken.trim(),
      pictureUrl,
      category,
      setAsActive: !!setAsActive
    });

    broadcastSSE('page_switched', { activePage: storage.getActivePage(), pages: storage.getConnectedPages() });

    res.json({
      success: true,
      page: addedPage,
      pages: storage.getConnectedPages(),
      activePageId: storage.getActivePage()?.id
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/facebook/pages/switch - Switch active Facebook Page
router.post('/pages/switch', (req, res) => {
  const { pageId } = req.body;
  if (!pageId) {
    return res.status(400).json({ success: false, error: 'Page ID is required to switch.' });
  }

  const switched = storage.setActivePage(pageId);
  if (!switched) {
    return res.status(404).json({ success: false, error: 'Page not found in connected pages.' });
  }

  broadcastSSE('page_switched', { activePage: switched, pages: storage.getConnectedPages() });

  res.json({
    success: true,
    activePage: switched,
    pages: storage.getConnectedPages()
  });
});

// GET /api/facebook/pages/:id - Get single page details including systemPrompt
router.get('/pages/:id', (req, res) => {
  const page = storage.getPageById(req.params.id);
  if (!page) {
    return res.status(404).json({ success: false, error: 'Page not found.' });
  }
  res.json({ success: true, page });
});

// PUT /api/facebook/pages/:id - Edit connected page info and custom system prompt
router.put('/pages/:id', async (req, res, next) => {
  const { name, category, accessToken, systemPrompt, pictureUrl } = req.body;
  try {
    const existing = storage.getPageById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Page not found.' });
    }

    const updates = {};
    if (typeof name === 'string' && name.trim()) updates.name = name.trim();
    if (typeof category === 'string' && category.trim()) updates.category = category.trim();
    if (typeof accessToken === 'string' && accessToken.trim()) updates.accessToken = accessToken.trim();
    if (typeof systemPrompt === 'string') updates.systemPrompt = systemPrompt.trim();
    if (typeof pictureUrl === 'string' && pictureUrl.trim()) updates.pictureUrl = pictureUrl.trim();

    const updated = storage.updateConnectedPage(req.params.id, updates);
    broadcastSSE('page_switched', { activePage: storage.getActivePage(), pages: storage.getConnectedPages() });

    res.json({
      success: true,
      page: updated,
      pages: storage.getConnectedPages(),
      activePage: storage.getActivePage()
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/facebook/pages/:id - Disconnect a Facebook Page
router.delete('/pages/:id', (req, res) => {
  try {
    const remaining = storage.removeConnectedPage(req.params.id);
    broadcastSSE('page_switched', { activePage: storage.getActivePage(), pages: remaining });
    res.json({
      success: true,
      pages: remaining,
      activePage: storage.getActivePage()
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// POST /api/facebook/test-connection
router.post('/test-connection', async (req, res) => {
  const settings = storage.getSettings();
  const pageId = req.body.pageId || settings.pageId;
  const accessToken = req.body.accessToken || settings.accessToken;

  try {
    const info = await facebook.verifyConnection(pageId, accessToken);
    res.json({ success: true, info });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// GET /api/facebook/logo
router.get('/logo', async (req, res) => {
  const settings = storage.getSettings();
  const logoPath = path.join(__dirname, '..', 'public', 'pariksha_notes_logo.jpg');
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
  const active = storage.getActivePage();
  const pageId = req.body.pageId || active?.id || '';
  try {
    const fetched = await facebook.fetchPagePicture(pageId);
    if (fetched) {
      if (active && active.id === pageId) {
        active.pictureUrl = fetched;
        storage.saveSettings({ pictureUrl: fetched });
      }
      return res.json({ success: true, url: fetched });
    }
    res.json({ success: false, error: 'Could not fetch logo from Facebook' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
