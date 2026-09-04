const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const facebook = require('../services/facebook');
const storage = require('../services/storage');
const upload = require('../middleware/upload');
const { broadcastSSE } = require('../middleware/sse');
const { serializePage, serializePages } = require('../utils/public-serializer');
const { validateContent } = require('../services/content-safety');

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

  // Enforce pre-publish content safety guard
  const activePage = storage.getActivePage();
  const safetyCheck = validateContent(
    { message, imageUrl, imagePath },
    { history: storage.getHistory(), isAutoPilot: false, pageCategory: activePage?.category }
  );

  if (!safetyCheck.safe && safetyCheck.reasons.length > 0) {
    return res.status(400).json({
      success: false,
      error: `Content safety check failed: ${safetyCheck.reasons.join('; ')}`,
      reasons: safetyCheck.reasons,
      warnings: safetyCheck.warnings
    });
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

// GET /api/facebook/pages - List all connected pages (credentials redacted)
router.get('/pages', (req, res) => {
  const s = storage.getSettings();
  const pages = storage.getConnectedPages();
  res.json({
    success: true,
    activePageId: s.activePageId || pages[0]?.id,
    activePage: serializePage(storage.getActivePage()),
    pages: serializePages(pages)
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

    broadcastSSE('page_switched', {
      activePage: serializePage(storage.getActivePage()),
      pages: serializePages(storage.getConnectedPages())
    });

    res.json({
      success: true,
      page: serializePage(addedPage),
      pages: serializePages(storage.getConnectedPages()),
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

  broadcastSSE('page_switched', {
    activePage: serializePage(switched),
    pages: serializePages(storage.getConnectedPages())
  });

  res.json({
    success: true,
    activePage: serializePage(switched),
    pages: serializePages(storage.getConnectedPages())
  });
});

// GET /api/facebook/pages/:id - Get single page details including systemPrompt
router.get('/pages/:id', (req, res) => {
  const page = storage.getPageById(req.params.id);
  if (!page) {
    return res.status(404).json({ success: false, error: 'Page not found.' });
  }
  res.json({ success: true, page: serializePage(page) });
});

const rateLimit = require('express-rate-limit');

const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many credential update attempts. Please wait.' }
});

// PUT /api/facebook/pages/:id/credential - Dedicated endpoint for page access token
router.put('/pages/:id/credential', credentialLimiter, async (req, res) => {
  const { accessToken } = req.body || {};
  if (!accessToken || typeof accessToken !== 'string' || accessToken.trim().length < 15 || accessToken.trim().length > 1000) {
    return res.status(400).json({
      success: false,
      error: 'Invalid access token format. Must be between 15 and 1000 characters.',
      code: 'INVALID_CREDENTIAL'
    });
  }

  const existing = storage.getPageById(req.params.id);
  if (!existing) {
    return res.status(404).json({ success: false, error: 'Page not found.', code: 'PAGE_NOT_FOUND' });
  }

  const cleanToken = accessToken.trim();
  storage.updateConnectedPage(req.params.id, { accessToken: cleanToken });

  const activePage = storage.getActivePage();
  if (activePage && activePage.id === req.params.id) {
    storage.saveSettings({ accessToken: cleanToken });
  }

  broadcastSSE('page_switched', {
    activePage: serializePage(storage.getActivePage()),
    pages: serializePages(storage.getConnectedPages())
  });

  return res.json({
    success: true,
    configured: true
  });
});

// PUT /api/facebook/pages/:id - Edit connected page general info and custom system prompt
router.put('/pages/:id', async (req, res, next) => {
  if ('accessToken' in req.body) {
    return res.status(400).json({
      success: false,
      error: 'Access token cannot be updated via general page endpoint. Use PUT /api/facebook/pages/:id/credential.',
      code: 'CREDENTIAL_UPDATE_FORBIDDEN'
    });
  }

  const { name, category, systemPrompt, pictureUrl } = req.body;
  try {
    const existing = storage.getPageById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Page not found.' });
    }

    const updates = {};
    if (typeof name === 'string' && name.trim()) updates.name = name.trim();
    if (typeof category === 'string' && category.trim()) updates.category = category.trim();
    if (typeof systemPrompt === 'string') updates.systemPrompt = systemPrompt.trim();
    if (typeof pictureUrl === 'string' && pictureUrl.trim()) updates.pictureUrl = pictureUrl.trim();

    const updated = storage.updateConnectedPage(req.params.id, updates);
    broadcastSSE('page_switched', {
      activePage: serializePage(storage.getActivePage()),
      pages: serializePages(storage.getConnectedPages())
    });

    res.json({
      success: true,
      page: serializePage(updated),
      pages: serializePages(storage.getConnectedPages()),
      activePage: serializePage(storage.getActivePage())
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/facebook/pages/:id - Disconnect a Facebook Page
router.delete('/pages/:id', (req, res) => {
  try {
    const remaining = storage.removeConnectedPage(req.params.id);
    broadcastSSE('page_switched', {
      activePage: serializePage(storage.getActivePage()),
      pages: serializePages(remaining)
    });
    res.json({
      success: true,
      pages: serializePages(remaining),
      activePage: serializePage(storage.getActivePage())
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
    res.json({
      success: true,
      info: {
        pageId: info.pageId,
        pageName: info.pageName,
        category: info.category
      }
    });
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
