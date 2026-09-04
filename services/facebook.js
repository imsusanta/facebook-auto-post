const path = require('path');
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const storage = require('./storage');

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
        const dl = await axios.get(picUrl, { responseType: 'arraybuffer', timeout: 10000 });
        const localPath = path.join(__dirname, '..', 'public', 'pariksha_notes_logo.jpg');
        fs.writeFileSync(localPath, dl.data);
        console.log(`[Facebook] Downloaded & updated local page logo: ${localPath}`);
        return '/pariksha_notes_logo.jpg';
      }
    } catch (err) {
      console.log('[Facebook] Logo fetch notice:', err.message);
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
        const response = await axios.get(`${GRAPH_BASE_URL}/${targetId.trim()}`, {
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
          pageLink: response.data.link || `https://facebook.com/${response.data.id}`
        };
      } catch (err) {
        console.log(`[FB Verify] Direct lookup for ${targetId} failed, attempting /me auto-detection...`);
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
        pageLink: response.data.link || `https://facebook.com/${response.data.id}`
      };
    } catch (err) {
      const fbError = err.response?.data?.error;
      const errorMsg = fbError ? `${fbError.message} (Code: ${fbError.code})` : err.message;
      throw new Error(`Facebook Verification Failed: ${errorMsg}`);
    }
  }

  /**
   * Publish a Post to Facebook Page
   * @param {Object} options { message, imagePath, imageUrl, isDemo, source }
   */
  async publishPost(options = {}) {
    const { message, imagePath, imageUrl, isDemo = false, source = 'manual' } = options;
    const settings = storage.getSettings();

    // Check for demo mode
    if (isDemo || settings.isDemoMode || (!settings.accessToken && !settings.pageId)) {
      await new Promise(r => setTimeout(r, 1200));

      const mockPostId = `${settings.pageId || '100088992233'}_${Date.now()}`;
      const log = storage.addHistory({
        status: 'success',
        message: message || '(Demo post)',
        imageUrl: imagePath ? '/uploads/' + imagePath.split('/').pop() : imageUrl,
        postId: mockPostId,
        source: source
      });

      return {
        success: true,
        demo: true,
        postId: mockPostId,
        fbUrl: `https://facebook.com/${mockPostId}`,
        log: log
      };
    }

    const { pageId, accessToken } = settings;

    if (!accessToken) {
      const errMsg = 'Facebook Access Token is not configured in Settings.';
      storage.addHistory({
        status: 'failed',
        message: message || '',
        imageUrl: imagePath ? '/uploads/' + imagePath.split('/').pop() : imageUrl,
        error: errMsg,
        source: source
      });
      throw new Error(errMsg);
    }

    const targetEndpoint = (pageId && pageId.trim() !== '' && !pageId.startsWith('1000')) ? pageId.trim() : 'me';

    try {
      let result;

      // 1. Photo Post with local file
      if (imagePath && fs.existsSync(imagePath)) {
        try {
          const formData = new FormData();
          formData.append('source', fs.createReadStream(imagePath));
          if (message) formData.append('caption', message);
          formData.append('access_token', accessToken);

          const response = await axios.post(`${GRAPH_BASE_URL}/${targetEndpoint}/photos`, formData, {
            headers: formData.getHeaders(),
            timeout: 30000
          });
          result = response.data;
        } catch (photoErr) {
          console.warn('[FB Publish] Photo upload failed, falling back to text feed post:', photoErr.message);
          // Fallback to text feed post
          const feedResponse = await axios.post(`${GRAPH_BASE_URL}/${targetEndpoint}/feed`, {
            message: message,
            access_token: accessToken
          }, { timeout: 20000 });
          result = feedResponse.data;
        }
      }
      // 2. Photo Post with remote Image URL
      else if (imageUrl && imageUrl.startsWith('http')) {
        const payload = {
          url: imageUrl,
          caption: message || '',
          access_token: accessToken
        };

        const response = await axios.post(`${GRAPH_BASE_URL}/${targetEndpoint}/photos`, payload, {
          timeout: 20000
        });
        result = response.data;
      }
      // 3. Regular Text Post
      else {
        const payload = {
          message: message,
          access_token: accessToken
        };

        const response = await axios.post(`${GRAPH_BASE_URL}/${targetEndpoint}/feed`, payload, {
          timeout: 20000
        });
        result = response.data;
      }

      const postId = result.id || result.post_id;
      const log = storage.addHistory({
        status: 'success',
        message: message || '',
        imageUrl: imagePath ? '/uploads/' + imagePath.split('/').pop() : imageUrl,
        postId: postId,
        fbUrl: `https://facebook.com/${postId}`,
        source: source
      });

      return {
        success: true,
        postId: postId,
        fbUrl: `https://facebook.com/${postId}`,
        log: log
      };
    } catch (err) {
      const fbError = err.response?.data?.error;
      let errorMsg = err.message;
      if (fbError) {
        errorMsg = fbError.error_user_msg || fbError.message || `Facebook Error (${fbError.code})`;
      }

      storage.addHistory({
        status: 'failed',
        message: message || '',
        imageUrl: imagePath ? '/uploads/' + imagePath.split('/').pop() : imageUrl,
        error: errorMsg,
        source: source
      });

      throw new Error(errorMsg);
    }
  }

  /**
   * Post a public reply to a Facebook comment
   */
  async replyToComment(commentId, message) {
    const settings = storage.getSettings();
    if (!settings.accessToken || settings.isDemoMode || !commentId || commentId.startsWith('sim_') || commentId.startsWith('demo_')) {
      console.log(`[Facebook Demo/Sim] Simulating public reply to comment ${commentId}: "${message}"`);
      return { id: `demo_reply_${Date.now()}` };
    }

    try {
      const res = await axios.post(`${GRAPH_BASE_URL}/${commentId}/comments`, {
        message: message,
        access_token: settings.accessToken
      }, { timeout: 15000 });
      return res.data;
    } catch (err) {
      console.error('[Facebook] Error replying to comment:', err.response?.data?.error || err.message);
      throw err;
    }
  }

  /**
   * Send a private Messenger message (DM) to a commenter
   */
  async sendPrivateReply(commentId, message) {
    const settings = storage.getSettings();
    if (!settings.accessToken || settings.isDemoMode || !commentId || commentId.startsWith('sim_') || commentId.startsWith('demo_')) {
      console.log(`[Facebook Demo/Sim] Simulating private DM to commenter of ${commentId}: "${message}"`);
      return { success: true, demo: true };
    }

    try {
      // Graph API: POST /{comment_id}/private_replies
      const res = await axios.post(`${GRAPH_BASE_URL}/${commentId}/private_replies`, {
        message: message,
        access_token: settings.accessToken
      }, { timeout: 15000 });
      return res.data;
    } catch (err) {
      console.error('[Facebook] Error sending private reply:', err.response?.data?.error || err.message);
      throw err;
    }
  }

  /**
   * Like a Facebook comment to boost engagement
   */
  async likeComment(commentId) {
    const settings = storage.getSettings();
    if (!settings.accessToken || settings.isDemoMode || !commentId || commentId.startsWith('sim_') || commentId.startsWith('demo_')) {
      console.log(`[Facebook Demo/Sim] Simulating like on comment ${commentId}`);
      return { success: true };
    }

    try {
      const res = await axios.post(`${GRAPH_BASE_URL}/${commentId}/likes`, {
        access_token: settings.accessToken
      }, { timeout: 10000 });
      return res.data;
    } catch (err) {
      console.error('[Facebook] Error liking comment:', err.response?.data?.error || err.message);
      return null;
    }
  }

  /**
   * Send a direct Messenger chat message to a user
   */
  async sendMessengerMessage(recipientId, messageText) {
    const settings = storage.getSettings();
    if (!settings.accessToken || settings.isDemoMode || !recipientId || recipientId.startsWith('sim_') || recipientId.startsWith('demo_')) {
      console.log(`[Facebook Demo/Sim] Simulating Messenger chat reply to ${recipientId}: "${messageText}"`);
      return { recipient_id: recipientId, message_id: `demo_mid_${Date.now()}` };
    }

    try {
      const res = await axios.post(`${GRAPH_BASE_URL}/me/messages`, {
        recipient: { id: recipientId },
        message: { text: messageText },
        access_token: settings.accessToken
      }, { timeout: 15000 });
      return res.data;
    } catch (err) {
      console.error('[Facebook] Error sending Messenger message:', err.response?.data?.error || err.message);
      throw err;
    }
  }
}

module.exports = new FacebookService();
