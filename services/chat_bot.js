const storage = require('./storage');
const facebook = require('./facebook');
const axios = require('axios');

class ChatBotService {
  /**
   * Process incoming Messenger chat message (from Meta Webhook or Test Simulator)
   */
  async processMessage(data = {}) {
    const {
      senderId = 'user_sample_psid',
      senderName = 'শিক্ষার্থী / Student',
      messageText = ''
    } = data;

    const rulesData = storage.getAutomationRules();
    const chatSettings = rulesData.chatSettings || {};

    if (!rulesData.chatAutomationEnabled || !chatSettings.enabled) {
      return { handled: false, reason: 'Messenger Chatbot automation is currently paused.' };
    }

    const cleanText = (messageText || '').toLowerCase().trim();

    // 1. Quick greetings handling
    let replyText = '';
    const greetings = ['hi', 'hello', 'hey', 'হ্যালো', 'নমস্কার', 'সালাম', 'kemon acho'];
    if (greetings.some(g => cleanText === g || cleanText.startsWith(g))) {
      const s = storage.getSettings();
      replyText = `${chatSettings.welcomeMessage || `হ্যালো! 👋 স্বাগতম ${s.pageName || 'আমাদের পেজে'}।`}\n\nআপনার যেকোনো তথ্য বা সহায়তার জন্য আমাদের বলুন।`;
    } else {
      // 2. Gemini AI Conversational Support
      replyText = await this.generateAiChatReply(messageText, senderName, chatSettings.personaPrompt);
    }

    // Execute message send via Meta Graph API
    try {
      await facebook.sendMessengerMessage(senderId, replyText);

      storage.addHistory({
        status: 'success',
        message: `[Messenger Bot Reply to ${senderName}]: "${replyText.slice(0, 80)}..."`,
        source: 'messenger_bot'
      });

      return {
        handled: true,
        senderId: senderId,
        senderName: senderName,
        userMessage: messageText,
        botReply: replyText,
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      console.error('[ChatBot] Error sending Messenger reply:', err.message);
      return { handled: false, error: err.message };
    }
  }

  /**
   * Use Google Gemini AI to formulate conversational customer support responses
   */
  async generateAiChatReply(userMessage, senderName, customPersona) {
    const settings = storage.getSettings();
    const geminiApiKey = settings.geminiApiKey ? settings.geminiApiKey.trim() : '';

    const pageName = settings.pageName || 'our Facebook Page';
    const defaultPersona = `You are a helpful, polite, and encouraging assistant for "${pageName}" on Facebook Messenger.
Help followers with their questions, queries, and guidance.
Always answer in clear, friendly Bengali (with English technical terms where appropriate).
Keep replies concise and friendly (2-3 sentences max). Use 1-2 positive emojis.`;

    const effectivePersona = customPersona || defaultPersona;

    if (!geminiApiKey) {
      return `হ্যালো ${senderName}! আপনার বার্তার জন্য ধন্যবাদ। আমাদের টিম শীঘ্রই আপনার সাথে যোগাযোগ করবে। যেকোনো জরুরি তথ্যের জন্য আমাদের পেজের পোস্টগুলো দেখুন! 😊`;
    }

    const candidateModels = ['gemini-3.1-flash-lite', 'gemini-2.5-flash'];
    const prompt = `System Persona:
${effectivePersona}

User Name: "${senderName}"
User Message: "${userMessage}"

Respond directly to the user as the assistant in polite, supportive Bengali:`;

    for (const model of candidateModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;
        const res = await axios.post(url, {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 200, temperature: 0.8 }
        }, { timeout: 10000 });

        const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text) return text;
      } catch (e) {
        // cascade
      }
    }

    return `হ্যালো ${senderName}! ধন্যবাদ আপনার বার্তার জন্য। আমরা খুব শীঘ্রই আপনার প্রশ্নের উত্তর বিস্তারিতভাবে দেব। সাথে থাকুন! 📚✨`;
  }
}

module.exports = new ChatBotService();
