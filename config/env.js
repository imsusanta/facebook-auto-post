require('dotenv').config();
const path = require('node:path');
const production = process.env.NODE_ENV === 'production';
const APP_ORIGIN = process.env.APP_ORIGIN || 'http://localhost:3000';
function validate() {
  const url = new URL(APP_ORIGIN);
  if (url.origin !== APP_ORIGIN || (production && url.protocol !== 'https:'))
    throw new Error('APP_ORIGIN must be an exact origin (HTTPS in production)');
  if (!process.env.DATABASE_URL)
    throw new Error(
      'DATABASE_URL is required; run npm run db:migrate before starting'
    );
  if (!/^[a-fA-F0-9]{64}$/.test(process.env.DATA_ENCRYPTION_KEY || ''))
    throw new Error(
      'DATA_ENCRYPTION_KEY must be 32 random bytes encoded as 64 hex characters'
    );
  if (production && (!process.env.SMTP_URL || !process.env.MAIL_FROM))
    throw new Error('SMTP_URL and MAIL_FROM are required in production');
  if (
    process.env.ENABLE_WEBHOOKS === 'true' &&
    (!process.env.FB_APP_SECRET || !process.env.FB_VERIFY_TOKEN)
  )
    throw new Error('Webhooks require FB_APP_SECRET and FB_VERIFY_TOKEN');
}
module.exports = {
  PORT: Number(process.env.PORT || 3000),
  NODE_ENV: process.env.NODE_ENV || 'development',
  production,
  APP_ORIGIN,
  validate,
  DATA_ROOT: path.resolve(
    process.env.DATA_ROOT || path.join(__dirname, '..', 'data')
  ),
  ENABLE_AUTOMATION: process.env.ENABLE_AUTOMATION === 'true',
  ENABLE_WEBHOOKS: process.env.ENABLE_WEBHOOKS === 'true'
};
