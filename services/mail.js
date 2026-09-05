const nodemailer = require('nodemailer');
const { APP_ORIGIN } = require('../config/env');
let testDelivery;
function setTestDelivery(fn) {
  if (process.env.NODE_ENV !== 'test') throw new Error('Test-only hook');
  testDelivery = fn;
}
async function sendToken(email, purpose, token) {
  const url = `${APP_ORIGIN}/auth.html#${purpose}=${token}`;
  const mail = {
    from: process.env.MAIL_FROM,
    to: email,
    subject:
      purpose === 'verify'
        ? 'Verify your AutoPost account'
        : 'Reset your AutoPost password',
    text: `${purpose === 'verify' ? 'Verify your email' : 'Reset your password'}: ${url}\n\nThis link expires in 30 minutes. If you did not request it, ignore this email.`
  };
  if (testDelivery) return testDelivery(mail);
  if (!process.env.SMTP_URL || !process.env.MAIL_FROM)
    throw new Error('Email delivery is not configured');
  await nodemailer.createTransport(process.env.SMTP_URL).sendMail(mail);
}
module.exports = { sendToken, setTestDelivery };
