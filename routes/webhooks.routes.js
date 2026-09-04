/**
 * Meta / Facebook Webhook Routes
 * Ingests comment events and Messenger chat messages with strict HMAC-SHA256 signature verification.
 */

const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const storage = require('../services/storage');
const commentBot = require('../services/comment_bot');
const chatBot = require('../services/chat_bot');
const { broadcastSSE } = require('../middleware/sse');
const logger = require('../utils/logger');

/**
 * Constant-time string comparison helper
 */
function timingSafeCheck(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// GET /api/webhook/facebook - Meta Challenge Verification
router.get('/facebook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const settings = storage.getSettings();
  const verifyToken = process.env.FB_VERIFY_TOKEN || settings.webhookVerifyToken || 'autopost_secure_verify_token_2026';

  if (mode === 'subscribe' && timingSafeCheck(token, verifyToken)) {
    logger.info('[Meta Webhook] Verified successfully by Meta!');
    return res.status(200).send(challenge);
  }
  logger.warn('[Meta Webhook] Token mismatch or invalid mode.');
  return res.sendStatus(403);
});

// Middleware: Verify Meta X-Hub-Signature-256 using raw request body
function verifyMetaSignature(req, res, next) {
  const signatureHeader = req.headers['x-hub-signature-256'];
  if (!signatureHeader || typeof signatureHeader !== 'string') {
    logger.warn('[Meta Webhook] Signature missing on incoming webhook event.');
    return res.status(401).json({
      success: false,
      error: 'Missing webhook signature.',
      code: 'SIGNATURE_MISSING'
    });
  }

  if (!signatureHeader.startsWith('sha256=')) {
    return res.status(401).json({
      success: false,
      error: 'Malformed webhook signature format. Expected sha256=...',
      code: 'INVALID_SIGNATURE_FORMAT'
    });
  }

  const settings = storage.getSettings();
  const appSecret = process.env.FB_APP_SECRET || settings.fbAppSecret;

  if (!appSecret) {
    logger.error('[Meta Webhook] FB_APP_SECRET is not configured. Cannot verify webhook authenticity.');
    return res.status(500).json({
      success: false,
      error: 'Server webhook configuration missing.',
      code: 'WEBHOOK_CONFIG_MISSING'
    });
  }

  const rawBody = req.rawBody ? req.rawBody : Buffer.from(JSON.stringify(req.body || {}));
  const expectedHash = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const signatureHash = signatureHeader.slice(7);

  if (!timingSafeCheck(signatureHash, expectedHash)) {
    logger.warn('[Meta Webhook] Invalid webhook signature detected. Event rejected.');
    return res.status(401).json({
      success: false,
      error: 'Invalid webhook signature.',
      code: 'INVALID_SIGNATURE'
    });
  }

  return next();
}

// POST /api/webhook/facebook - Ingest feed comments and Messenger messages
router.post('/facebook', verifyMetaSignature, async (req, res) => {
  const body = req.body;

  // Acknowledge receipt to Meta immediately within milliseconds
  res.status(200).send('EVENT_RECEIVED');

  if (body && body.object === 'page') {
    for (const entry of body.entry || []) {
      // 1. Feed / Post Comment Event
      if (entry.changes) {
        for (const change of entry.changes) {
          if (change.field === 'feed' && change.value?.item === 'comment' && change.value?.verb === 'add') {
            const commentVal = change.value;
            logger.info(`[Meta Webhook] Incoming comment on post ${commentVal.post_id}: "${commentVal.message}" by ${commentVal.from?.name}`);

            commentBot.processComment({
              commentId: commentVal.comment_id,
              postId: commentVal.post_id,
              message: commentVal.message,
              senderName: commentVal.from?.name || 'Follower',
              senderId: commentVal.from?.id
            }).then(result => {
              broadcastSSE('comment_replied', result);
            }).catch(err => logger.error('[Webhook Comment Error]', err.message));
          }
        }
      }

      // 2. Messenger Message Event
      if (entry.messaging) {
        for (const msgEvent of entry.messaging) {
          if (msgEvent.message && !msgEvent.message.is_echo) {
            const senderId = msgEvent.sender?.id;
            const text = msgEvent.message.text;
            logger.info(`[Meta Webhook] Incoming Messenger message from ${senderId}: "${text}"`);

            chatBot.processMessage({
              senderId: senderId,
              messageText: text,
              senderName: 'Messenger User'
            }).then(result => {
              broadcastSSE('chat_replied', result);
            }).catch(err => logger.error('[Webhook Chat Error]', err.message));
          }
        }
      }
    }
  }
});

module.exports = router;
