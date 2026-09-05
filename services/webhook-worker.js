const db = require('./db');
const context = require('../security/context');
const { broadcastSSE } = require('../middleware/sse');
const { ENABLE_WEBHOOKS } = require('../config/env');
let timer,
  busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    const { rows } = await db.query(
      `UPDATE webhook_events SET status='processing' WHERE id=(SELECT id FROM webhook_events WHERE status='pending' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`
    );
    if (!rows[0]) return;
    const row = rows[0],
      data = { ...JSON.parse(row.data.payload), pageId: row.facebook_page_id };
    try {
      await context.run(
        row.workspace_id,
        async () => {
          const page = await require('./storage').getPageById(data.pageId);
          if (!page) return;
          if (
            data.change?.field === 'feed' &&
            data.change.value?.item === 'comment' &&
            data.change.value.verb === 'add'
          ) {
            const v = data.change.value;
            if (v.from?.id === data.pageId) return;
            const result = await require('./comment_bot').processComment({
              commentId: v.comment_id,
              postId: v.post_id,
              message: v.message || '',
              senderName: v.from?.name || 'Follower',
              senderId: v.from?.id
            });
            broadcastSSE('comment_replied', result);
          }
          if (
            data.message?.message &&
            !data.message.message.is_echo &&
            data.message.message.text
          ) {
            const result = await require('./chat_bot').processMessage({
              senderId: data.message.sender?.id,
              messageText: data.message.message.text,
              senderName: 'Messenger User'
            });
            broadcastSSE('chat_replied', result);
          }
        },
        { targetPageId: data.pageId }
      );
      await db.query(
        "UPDATE webhook_events SET status='completed' WHERE id=$1",
        [row.id]
      );
    } catch {
      await db.query(
        "UPDATE webhook_events SET status='needs_review',error='Handler failed; review delivery before retry' WHERE id=$1",
        [row.id]
      );
    }
  } catch {
    console.warn('[Webhook] Worker failure');
  } finally {
    busy = false;
  }
}
function start() {
  if (ENABLE_WEBHOOKS) {
    timer = setInterval(tick, 1000);
    timer.unref();
  }
}
function stop() {
  if (timer) clearInterval(timer);
}
module.exports = { start, stop, tick };
