require('dotenv').config();
const { DEFAULT_PORT } = require('./constants');

module.exports = {
  PORT: parseInt(process.env.PORT, 10) || DEFAULT_PORT,
  NODE_ENV: process.env.NODE_ENV || 'development',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  FB_PAGE_ID: process.env.FB_PAGE_ID || '',
  FB_PAGE_ACCESS_TOKEN: process.env.FB_PAGE_ACCESS_TOKEN || '',
  FB_VERIFY_TOKEN: process.env.FB_VERIFY_TOKEN || 'autopost_verify_secret_token_2026',
  SIMULATION_MODE: process.env.SIMULATION_MODE === 'true'
};
