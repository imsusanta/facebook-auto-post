const router = require('express').Router();
const storage = require('../services/storage');
const jobs = require('../services/jobs');
const publishing = require('../services/publishing');
const upload = require('../middleware/upload');
const requireIdempotency = require('../middleware/idempotency');
const { validatePost } = require('../security/validation');
const { broadcastSSE } = require('../middleware/sse');
router.get('/', async (req, res) => res.json(await storage.getQueue()));
router.get('/:id', async (req, res) => {
  const item = await jobs.get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Job not found' });
  res.json({ item });
});
router.post(
  '/',
  requireIdempotency,
  upload.single('image'),
  validatePost,
  async (req, res) => {
    const imageUrl = req.file?.url || req.body.imageUrl;
    if (!req.body.message && !imageUrl)
      return res.status(400).json({ error: 'Message or image required' });
    const item = await publishing.enqueue({
      ...req.body,
      imageUrl,
      source: 'scheduler',
      operationKey: req.operationKey
    });
    if (item.replayed && req.file && item.imageUrl !== req.file.url)
      await require('../security/media').remove(req.file.filename);
    broadcastSSE('queue_updated', await storage.getQueue());
    res
      .status(item.status === 'removed' ? 410 : 200)
      .json({
        success: item.status !== 'removed',
        item,
        replayed: !!item.replayed
      });
  }
);
router.delete('/:id', async (req, res) => {
  const queue = await storage.removeFromQueue(req.params.id);
  broadcastSSE('queue_updated', queue);
  res.json({ success: true, queue });
});
router.post('/:id/publish-now', async (req, res) => {
  const item = await jobs.get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Job not found' });
  publishing.respond(
    res,
    await publishing.processJob(item.id, { forceDue: true })
  );
});
router.post('/:id/retry', async (req, res) => {
  const item = await jobs.retry(req.params.id);
  broadcastSSE('queue_updated', await storage.getQueue());
  res.status(202).json({ success: true, published: false, item });
});
module.exports = router;
