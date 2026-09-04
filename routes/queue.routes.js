const express = require('express');
const router = express.Router();
const path = require('path');
const storage = require('../services/storage');
const facebook = require('../services/facebook');
const upload = require('../middleware/upload');
const { broadcastSSE } = require('../middleware/sse');

// GET /api/queue
router.get('/', (req, res) => {
  res.json(storage.getQueue());
});

// POST /api/queue - Add post to scheduled queue
router.post('/', upload.single('image'), (req, res) => {
  const message = req.body.message || '';
  const imageUrl = req.file ? `/uploads/${req.file.filename}` : req.body.imageUrl;

  if (!message && !imageUrl) {
    return res.status(400).json({ error: 'Message or image is required for scheduled post.' });
  }

  const scheduledAt = req.body.scheduledAt || null;

  const item = storage.addToQueue({ message, imageUrl, scheduledAt });
  broadcastSSE('queue_updated', storage.getQueue());
  res.json({ success: true, item });
});

// DELETE /api/queue/:id - Remove post from queue
router.delete('/:id', (req, res) => {
  const queue = storage.removeFromQueue(req.params.id);
  broadcastSSE('queue_updated', queue);
  res.json({ success: true, queue });
});

// POST /api/queue/:id/publish-now - Publish queued post immediately
router.post('/:id/publish-now', async (req, res, next) => {
  const queue = storage.getQueue();
  const item = queue.find(q => q.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Queue item not found' });

  try {
    let localImagePath = null;
    if (item.imageUrl && item.imageUrl.startsWith('/uploads/')) {
      localImagePath = path.join(__dirname, '..', item.imageUrl);
    }
    const result = await facebook.postMessageOrPhoto(item.message, localImagePath);
    
    storage.removeFromQueue(item.id);
    const historyItem = storage.addHistory({
      status: result.success ? 'success' : 'failed',
      message: item.message,
      imageUrl: item.imageUrl,
      postId: result.postId || null,
      error: result.error || null,
      source: 'queue_instant'
    });

    broadcastSSE('queue_updated', storage.getQueue());
    broadcastSSE('history_updated', storage.getHistory());
    broadcastSSE('post_success', { postId: result.postId, message: item.message });

    res.json({ success: true, result, historyItem });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
