const storage = require('./storage');
const facebook = require('./facebook');
const axios = require('axios');

class CommentBotService {
  /**
   * Process an incoming comment event (from Meta Webhook or Test Simulator)
   */
  async processComment(data = {}) {
    const {
      commentId = `cmt_${Date.now()}`,
      postId = 'post_sample',
      message = '',
      senderName = 'শিক্ষার্থী / Follower',
      senderId = 'user_123'
    } = data;

    const rulesData = (await storage.getAutomationRules());
    if (!rulesData.commentAutomationEnabled) {
      return { handled: false, reason: 'Comment automation is currently paused.' };
    }

    const cleanMessage = (message || '').toLowerCase();
    const commentRules = rulesData.commentRules || [];

    let matchedRule = null;

    // 1. Keyword rule evaluation
    for (const rule of commentRules) {
      if (!rule.isActive) continue;
      const keywords = rule.keywords || [];
      const isMatch = keywords.some(k => cleanMessage.includes(k.toLowerCase().trim()));
      if (isMatch) {
        matchedRule = rule;
        break;
      }
    }

    let publicReplyText = '';
    let privateDmText = '';
    let privateDmSent = false;
    let autoLiked = false;
    let source = 'keyword_rule';

    if (matchedRule) {
      // Personalize with sender's name
      publicReplyText = (matchedRule.publicReply || '').replace(/{name}/g, senderName);
      if (matchedRule.sendPrivateDm && matchedRule.privateDm) {
        privateDmText = matchedRule.privateDm.replace(/{name}/g, senderName);
      }
      autoLiked = !!matchedRule.autoLike;
    } else if (rulesData.aiCommentFallbackEnabled) {
      // 2. Gemini AI Smart Comment Responder
      source = 'gemini_ai';
      publicReplyText = await this.generateAiCommentReply(message, senderName);
      autoLiked = true;
    }

    if (!publicReplyText) {
      return { handled: false, reason: 'No matching keyword and AI fallback is disabled.' };
    }

    // Execute Facebook actions
    try {
      // A. Auto-Like
      if (autoLiked) {
        await facebook.likeComment(commentId);
      }

      // B. Public Reply
      let publicReplyRes = null;
      if (publicReplyText) {
        publicReplyRes = await facebook.replyToComment(commentId, publicReplyText);
      }

      // C. Private Messenger DM (if configured)
      let privateDmRes = null;
      if (privateDmText) {
        try {
          privateDmRes = await facebook.sendPrivateReply(commentId, privateDmText);
          privateDmSent = true;
        } catch (dmErr) {
          console.log('[comment_bot] operation event');
        }
      }

      // Record to history / logs
      const logEntry = {
        type: 'comment_reply',
        source: source,
        ruleName: matchedRule ? matchedRule.name : 'AI Smart Responder',
        senderName: senderName,
        commentText: message,
        publicReply: publicReplyText,
        privateDmSent: privateDmSent,
        timestamp: new Date().toISOString(),
        status: 'success'
      };

      (await storage.addHistory({
        status: 'success',
        message: `[Comment Auto-Reply to ${senderName}]: "${publicReplyText.slice(0, 80)}..."`,
        source: 'comment_bot'
      }));

      return {
        handled: true,
        source: source,
        ruleName: matchedRule ? matchedRule.name : 'Gemini AI Responder',
        senderName: senderName,
        publicReply: publicReplyText,
        privateDmSent: privateDmSent,
        autoLiked: autoLiked,
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      console.log('[comment_bot] operation event');
      return { handled: false, error: 'Operation failed. Check settings and try again.' };
    }
  }

  /**
   * Use Google Gemini AI to formulate a contextual reply to a follower's comment
   */
  async generateAiCommentReply(commentText, senderName) {
    const settings = (await storage.getSettings());
    const geminiApiKey = settings.geminiApiKey ? settings.geminiApiKey.trim() : '';

    if (!geminiApiKey) {
      return `ধন্যবাদ ${senderName}! আপনার মন্তব্যটির জন্য অনেক কৃতজ্ঞতা। সাথে থাকুন! ❤️`;
    }

    const candidateModels = ['gemini-3.1-flash-lite', 'gemini-2.5-flash'];
    const pageName = settings.pageName || 'our Facebook Page';
    const prompt = `You are the friendly, helpful social media manager of the Facebook page "${pageName}".
A user named "${senderName}" commented on our post:
"${commentText}"

Write a warm, polite, encouraging response in 1 or 2 short sentences in Bengali. Use 1 suitable emoji.
Do NOT use hashtags. Address the user politely. Output ONLY the response text.`;

    for (const model of candidateModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;
        const res = await axios.post(url, {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 120, temperature: 0.8 }
        }, { timeout: 8000 });

        const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text) return text;
      } catch (e) {
        // cascade next
      }
    }

    return `ধন্যবাদ ${senderName}! আপনার সুন্দর মন্তব্যের জন্য আন্তরিক ধন্যবাদ। নতুন তথ্যের জন্য পেজটি ফলো রাখুন! 🌸`;
  }
}

module.exports = new CommentBotService();
