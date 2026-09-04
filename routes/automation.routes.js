const express = require('express');
const router = express.Router();
const storage = require('../services/storage');
const commentBot = require('../services/comment_bot');
const chatBot = require('../services/chat_bot');
const scheduler = require('../services/scheduler');
const { broadcastSSE } = require('../middleware/sse');

// GET /api/automation/status
router.get('/status', (req, res) => {
  res.json({
    scheduler: scheduler.getStatus(),
    rules: storage.getAutomationRules()
  });
});

// POST /api/automation/toggle (Scheduler Toggle)
router.post('/toggle', (req, res) => {
  const settings = storage.getSettings();
  const newState = !settings.autoPostEnabled;
  storage.saveSettings({ autoPostEnabled: newState });

  if (newState || settings.autoPilotEnabled) {
    scheduler.start();
  } else {
    scheduler.stop();
  }

  broadcastSSE('scheduler_toggled', { enabled: newState });
  res.json({ autoPostEnabled: newState, status: scheduler.getStatus() });
});

// POST /api/automation/run-now
router.post('/run-now', async (req, res, next) => {
  try {
    const result = await scheduler.runNow();
    res.json({ success: true, result });
  } catch (err) {
    next(err);
  }
});

// GET /api/automation/rules
router.get('/rules', (req, res) => {
  res.json(storage.getAutomationRules());
});

// POST /api/automation/rules
router.post('/rules', (req, res) => {
  const rules = storage.saveAutomationRules(req.body);
  broadcastSSE('rules_updated', rules);
  res.json({ success: true, rules });
});

// POST /api/automation/rules/comment
router.post('/rules/comment', (req, res) => {
  const newRule = storage.addCommentRule(req.body);
  res.json({ success: true, rule: newRule, rules: storage.getAutomationRules() });
});

// DELETE /api/automation/rules/comment/:id
router.delete('/rules/comment/:id', (req, res) => {
  const rules = storage.deleteCommentRule(req.params.id);
  res.json({ success: true, commentRules: rules });
});

// POST /api/automation/toggle-comment
router.post('/toggle-comment', (req, res) => {
  const rules = storage.getAutomationRules();
  rules.commentAutomationEnabled = !rules.commentAutomationEnabled;
  storage.saveAutomationRules(rules);
  broadcastSSE('rules_updated', rules);
  res.json({ success: true, enabled: rules.commentAutomationEnabled });
});

// POST /api/automation/toggle-chat
router.post('/toggle-chat', (req, res) => {
  const rules = storage.getAutomationRules();
  rules.chatAutomationEnabled = !rules.chatAutomationEnabled;
  storage.saveAutomationRules(rules);
  broadcastSSE('rules_updated', rules);
  res.json({ success: true, enabled: rules.chatAutomationEnabled });
});

// POST /api/automation/test-comment (Simulator)
router.post('/test-comment', async (req, res, next) => {
  const { message = '', senderName = 'অনন্যা ব্যানার্জী' } = req.body;
  try {
    const result = await commentBot.processComment({
      commentId: `sim_cmt_${Date.now()}`,
      postId: 'sim_post_1',
      message: message,
      senderName: senderName
    });
    broadcastSSE('comment_replied', result);
    res.json({ success: true, result });
  } catch (err) {
    next(err);
  }
});

// POST /api/automation/test-chat (Simulator)
router.post('/test-chat', async (req, res, next) => {
  const { message = '', senderName = 'রাহুল সেন' } = req.body;
  try {
    const result = await chatBot.processMessage({
      senderId: `sim_psid_${Date.now()}`,
      senderName: senderName,
      messageText: message
    });
    broadcastSSE('chat_replied', result);
    res.json({ success: true, result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
