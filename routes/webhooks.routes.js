const express = require('express');
const router = express.Router();
const storage = require('../services/storage');
const commentBot = require('../services/comment_bot');
const chatBot = require('../services/chat_bot');
const { broadcastSSE } = require('../middleware/sse');

// GET /api/webhook/facebook - Meta Challenge Verification
router.get('/facebook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const settings = storage.getSettings();
  const verifyToken = settings.webhookVerifyToken || 'autopost_secure_verify_token_2026';

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('[Meta Webhook] Verified successfully by Meta!');
    return res.status(200).send(challenge);
  }
  console.warn('[Meta Webhook] Token mismatch or invalid mode.');
  return res.sendStatus(403);
});

// POST /api/webhook/facebook - Ingest feed comments and Messenger messages
router.post('/facebook', async (req, res) => {
  const body = req.body;

  // Acknowledge receipt to Meta immediately within milliseconds
  res.status(200).send('EVENT_RECEIVED');

  if (body.object === 'page') {
    for (const entry of body.entry || []) {
      // 1. Feed / Post Comment Event
      if (entry.changes) {
        for (const change of entry.changes) {
          if (change.field === 'feed' && change.value?.item === 'comment' && change.value?.verb === 'add') {
            const commentVal = change.value;
            console.log(`[Meta Webhook] Incoming comment on post ${commentVal.post_id}: "${commentVal.message}" by ${commentVal.from?.name}`);
            
            commentBot.processComment({
              commentId: commentVal.comment_id,
              postId: commentVal.post_id,
              message: commentVal.message,
              senderName: commentVal.from?.name || 'Follower',
              senderId: commentVal.from?.id
            }).then(result => {
              broadcastSSE('comment_replied', result);
            }).catch(err => console.error('[Webhook Comment Error]', err.message));
          }
        }
      }

      // 2. Messenger Message Event
      if (entry.messaging) {
        for (const msgEvent of entry.messaging) {
          if (msgEvent.message && !msgEvent.message.is_echo) {
            const senderId = msgEvent.sender?.id;
            const text = msgEvent.message.text;
            console.log(`[Meta Webhook] Incoming Messenger message from ${senderId}: "${text}"`);

            chatBot.processMessage({
              senderId: senderId,
              messageText: text,
              senderName: 'Messenger User'
            }).then(result => {
              broadcastSSE('chat_replied', result);
            }).catch(err => console.error('[Webhook Chat Error]', err.message));
          }
        }
      }
    }
  }
});

module.exports = router;
