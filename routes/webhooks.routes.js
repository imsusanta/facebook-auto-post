const router = require('express').Router();
const crypto = require('node:crypto');
const db = require('../services/db');
const { ENABLE_WEBHOOKS } = require('../config/env');
router.use((req, res, next) =>
  ENABLE_WEBHOOKS ? next() : res.sendStatus(404)
);
router.get('/facebook', (req, res) => {
  const expected = process.env.FB_VERIFY_TOKEN;
  const token = req.query['hub.verify_token'];
  if (
    expected &&
    typeof token === 'string' &&
    req.query['hub.mode'] === 'subscribe' &&
    Buffer.byteLength(token) === Buffer.byteLength(expected) &&
    crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  )
    return res.status(200).send(req.query['hub.challenge']);
  res.sendStatus(403);
});
router.post('/facebook', async (req, res) => {
  const signature = req.get('x-hub-signature-256') || '';
  if (
    !Buffer.isBuffer(req.body) ||
    !/^sha256=[a-f\d]{64}$/.test(signature) ||
    !process.env.FB_APP_SECRET
  )
    return res.sendStatus(403);
  const expected = crypto
    .createHmac('sha256', process.env.FB_APP_SECRET)
    .update(req.body)
    .digest();
  if (!crypto.timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex')))
    return res.sendStatus(403);
  let body;
  try {
    body = JSON.parse(req.body);
  } catch {
    return res.sendStatus(400);
  }
  if (
    body.object !== 'page' ||
    !Array.isArray(body.entry) ||
    body.entry.length > 100
  )
    return res.sendStatus(400);
  await db.transaction(async () => {
    for (const entry of body.entry) {
      const { rows } = await db.query(
        "SELECT workspace_id FROM facebook_pages WHERE id=$1 AND coalesce((data->>'connected')::boolean,true)",
        [String(entry.id)]
      );
      if (!rows[0]) continue;
      for (const event of [
        ...(entry.changes || []).map((change) => ({ change })),
        ...(entry.messaging || []).map((message) => ({ message }))
      ]) {
        const stable =
          event.message?.message?.mid ||
          event.change?.value?.comment_id ||
          JSON.stringify(event);
        const id = crypto
          .createHash('sha256')
          .update(`${entry.id}:${stable}:${event.change?.value?.verb || ''}`)
          .digest('hex');
        const data = { pageId: String(entry.id), ...event };
        await db.query(
          'INSERT INTO webhook_events(id,workspace_id,facebook_page_id,data) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING',
          [
            id,
            rows[0].workspace_id,
            String(entry.id),
            require('../security/secrets').seal({
              payload: JSON.stringify(data)
            })
          ]
        );
      }
    }
  });
  res.status(200).send('EVENT_RECEIVED');
});
module.exports = router;
