/**
 * Application Constants
 */
module.exports = {
  APP_NAME: 'AutoPost Facebook Automation',
  VERSION: '2.5.0',
  DEFAULT_PORT: 3000,
  
  // Storage files
  DATA_DIR: 'data',
  UPLOADS_DIR: 'uploads',
  
  // Event types for Server-Sent Events (SSE)
  SSE_EVENTS: {
    SCHEDULER_TOGGLED: 'scheduler_toggled',
    QUEUE_UPDATED: 'queue_updated',
    POST_SUCCESS: 'post_success',
    POST_FAILED: 'post_failed',
    COMMENT_REPLIED: 'comment_replied',
    CHAT_REPLIED: 'chat_replied',
    SETTINGS_UPDATED: 'settings_updated'
  },
  
  // Facebook Graph API versions & limits
  FACEBOOK: {
    GRAPH_API_VERSION: 'v20.0',
    MAX_IMAGE_SIZE_MB: 15,
    ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  },

  // Default post categories
  DEFAULT_CATEGORIES: [
    { id: 'trending_news', title: 'Trending News', emoji: '📰' },
    { id: 'science_nature', title: 'Science & Nature', emoji: '🔬' },
    { id: 'history_civilization', title: 'History & Heritage', emoji: '🏛️' },
    { id: 'psychology_mind', title: 'Psychology & Mind', emoji: '🧠' },
    { id: 'world_geography', title: 'World Wonders', emoji: '🌍' },
    { id: 'tech_inventions', title: 'Tech & Future', emoji: '💡' },
    { id: 'philosophy_wisdom', title: 'Life Wisdom', emoji: '✨' }
  ]
};
