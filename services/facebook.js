const path = require('path');
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const storage = require('./storage');
const media = require('../security/media');
const { PublishingError, fromFacebook } = require('./publishing-errors');

const FB_GRAPH_API_VERSION = 'v20.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${FB_GRAPH_API_VERSION}`;

class FacebookService {
  /**
   * Fetch and Cache Facebook Page Profile Picture Locally
   */
  async fetchPagePicture(pageId) {
    if (!pageId) return null;
    try {
      const cleanId = pageId.trim();
      const url = `https://graph.facebook.com/${FB_GRAPH_API_VERSION}/${cleanId}/picture?type=large&redirect=false`;
      const res = await axios.get(url, { timeout: 8000 });
      const picUrl = res.data?.data?.url;
      if (picUrl) {
        const asset = await media.store(await media.load(picUrl));
        return asset.url;
      }
    } catch (err) {
      console.log('[facebook] operation event');
    }
    return null;
  }

  /**
   * Verify Page ID and Page Access Token
   */
  async verifyConnection(pageId, accessToken) {
    if (!accessToken) {
      throw new Error('Facebook Access Token is required.');
    }

    let targetId = pageId;

    // First attempt: try with provided pageId
    if (targetId && targetId.trim() !== '') {
      try {
        const response = await axios.get(
          `${GRAPH_BASE_URL}/${targetId.trim()}`,
          {
            params: {
              fields: 'id,name,picture{url},fan_count,category,link',
              access_token: accessToken
            },
            timeout: 10000
          }
        );

        return {
          valid: true,
          pageId: response.data.id,
          pageName: response.data.name,
          category: response.data.category || 'Page',
          fanCount: response.data.fan_count || 0,
          pictureUrl: response.data.picture?.data?.url || null,
          pageLink:
            response.data.link || `https://facebook.com/${response.data.id}`
        };
      } catch (err) {
        console.log('[facebook] operation event');
      }
    }

    // Fallback: Auto-detect Page ID using /me endpoint from token
    try {
      const response = await axios.get(`${GRAPH_BASE_URL}/me`, {
        params: {
          fields: 'id,name,picture{url},fan_count,category,link',
          access_token: accessToken
        },
        timeout: 10000
      });

      return {
        valid: true,
        pageId: response.data.id,
        pageName: response.data.name,
        category: response.data.category || 'Page',
        fanCount: response.data.fan_count || 0,
        pictureUrl: response.data.picture?.data?.url || null,
        pageLink:
          response.data.link || `https://facebook.com/${response.data.id}`
      };
    } catch (err) {
      const fbError = err.response?.data?.error;
      const errorMsg = fbError
        ? `${fbError.message} (Code: ${fbError.code})`
        : err.message;
      throw new Error(`Facebook Verification Failed: ${errorMsg}`);
    }
  }

  /**
   * Publish a Post to Facebook Page
   * @param {Object} options { message, imagePath, imageUrl, isDemo, source }
   */
  async publishPost({
    message = '',
    imagePath = null,
    imageUrl = null,
    isDemo = false
  } = {}) {
    const settings = await storage.getSettings();
    if (!settings.pageId || !settings.accessToken)
      throw new PublishingError(
        'MISSING_CREDENTIALS',
        'Facebook Page ID and access token are required'
      );
    if (isDemo || settings.isDemoMode)
      throw new PublishingError(
        'DEMO_DISABLED',
        'Demo publication is disabled; previews are not real posts'
      );
    if (imageUrl)
      throw new PublishingError(
        'UNPREPARED_IMAGE',
        'Images must be prepared before the dispatch checkpoint'
      );
    if (imagePath) {
      const authorized = await media.resolve(
        '/uploads/' + path.basename(imagePath)
      );
      if (authorized !== imagePath || !fs.existsSync(authorized))
        throw new PublishingError(
          'INVALID_IMAGE',
          'Owned image is not available'
        );
    }
    if (!message.trim() && !imagePath)
      throw new PublishingError('EMPTY_POST', 'Message or image required');
    try {
      let response;
      if (imagePath) {
        const form = new FormData();
        form.append('source', fs.createReadStream(imagePath));
        if (message) form.append('caption', message);
        form.append('access_token', settings.accessToken);
        response = await axios.post(
          `${GRAPH_BASE_URL}/${settings.pageId}/photos`,
          form,
          { headers: form.getHeaders(), timeout: 30000 }
        );
      } else
        response = await axios.post(
          `${GRAPH_BASE_URL}/${settings.pageId}/feed`,
          { message, access_token: settings.accessToken },
          { timeout: 20000 }
        );
      const postId = response.data?.post_id || response.data?.id;
      if (typeof postId !== 'string' || !postId)
        throw new PublishingError(
          'DELIVERY_UNKNOWN',
          'Facebook response did not include a post ID',
          { delivery: 'unknown' }
        );
      return { success: true, postId, fbUrl: `https://facebook.com/${postId}` };
    } catch (error) {
      throw fromFacebook(error);
    }
  }

  /**
   * Post a public reply to a Facebook comment
   */
  async replyToComment(commentId, message) {
    const settings = await storage.getSettings();
    if (
      commentId &&
      (commentId.startsWith('sim_') || commentId.startsWith('demo_'))
    ) {
      console.log('[facebook] operation event');
      return { id: `demo_reply_${Date.now()}` };
    }

    if (!settings.accessToken || settings.isDemoMode)
      throw new PublishingError(
        'MISSING_CREDENTIALS',
        'Real replies require valid Facebook credentials and demo mode disabled'
      );
    try {
      const res = await axios.post(
        `${GRAPH_BASE_URL}/${commentId}/comments`,
        {
          message: message,
          access_token: settings.accessToken
        },
        { timeout: 15000 }
      );
      return res.data;
    } catch (err) {
      console.log('[facebook] operation event');
      throw err;
    }
  }

  /**
   * Send a private Messenger message (DM) to a commenter
   */
  async sendPrivateReply(commentId, message) {
    const settings = await storage.getSettings();
    if (
      commentId &&
      (commentId.startsWith('sim_') || commentId.startsWith('demo_'))
    ) {
      console.log('[facebook] operation event');
      return { success: true, demo: true };
    }

    if (!settings.accessToken || settings.isDemoMode)
      throw new PublishingError(
        'MISSING_CREDENTIALS',
        'Real replies require valid Facebook credentials and demo mode disabled'
      );
    try {
      // Graph API: POST /{comment_id}/private_replies
      const res = await axios.post(
        `${GRAPH_BASE_URL}/${commentId}/private_replies`,
        {
          message: message,
          access_token: settings.accessToken
        },
        { timeout: 15000 }
      );
      return res.data;
    } catch (err) {
      console.log('[facebook] operation event');
      throw err;
    }
  }

  /**
   * Like a Facebook comment to boost engagement
   */
  async likeComment(commentId) {
    const settings = await storage.getSettings();
    if (
      commentId &&
      (commentId.startsWith('sim_') || commentId.startsWith('demo_'))
    ) {
      console.log('[facebook] operation event');
      return { success: true };
    }

    if (!settings.accessToken || settings.isDemoMode)
      throw new PublishingError(
        'MISSING_CREDENTIALS',
        'Real replies require valid Facebook credentials and demo mode disabled'
      );
    try {
      const res = await axios.post(
        `${GRAPH_BASE_URL}/${commentId}/likes`,
        {
          access_token: settings.accessToken
        },
        { timeout: 10000 }
      );
      return res.data;
    } catch (err) {
      console.log('[facebook] operation event');
      return null;
    }
  }

  /**
   * Send a direct Messenger chat message to a user
   */
  async sendMessengerMessage(recipientId, messageText) {
    const settings = await storage.getSettings();
    if (
      recipientId &&
      (recipientId.startsWith('sim_') || recipientId.startsWith('demo_'))
    ) {
      console.log('[facebook] operation event');
      return {
        recipient_id: recipientId,
        message_id: `demo_mid_${Date.now()}`
      };
    }

    if (!settings.accessToken || settings.isDemoMode)
      throw new PublishingError(
        'MISSING_CREDENTIALS',
        'Real replies require valid Facebook credentials and demo mode disabled'
      );
    try {
      const res = await axios.post(
        `${GRAPH_BASE_URL}/me/messages`,
        {
          recipient: { id: recipientId },
          message: { text: messageText },
          access_token: settings.accessToken
        },
        { timeout: 15000 }
      );
      return res.data;
    } catch (err) {
      console.log('[facebook] operation event');
      throw err;
    }
  }
}

module.exports = new FacebookService();
