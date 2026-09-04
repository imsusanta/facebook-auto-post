# 🚀 Facebook Auto-Poster & Automation SaaS Engine

An intelligent, full-featured Facebook Page Automation SaaS platform powered by **Node.js, Express, Sharp, Google Gemini AI, and Meta Graph API v20.0**.

---

## ✨ Features

- **Multi-Page Management**: Connect and switch between multiple Facebook pages seamlessly.
- **AI Content Generator**: Generate viral Bengali/English posts with custom prompts, multi-style writing presets (Storytelling, Breaking News, Debate, Tips, etc.), and emojis/hashtags.
- **Dynamic Card & Poster Generator**: Automated high-res image generation with Sharp (multiple design layouts, contrast overlays, and customizable headers/badges).
- **Regenerate & Tweak**: Re-generate AI post captions or card images on the fly with single-click actions.
- **Template Library**: Add, manage, delete, and apply customizable post templates with visual previews.
- **Smart Auto-Pilot Scheduler**: Cron-based auto-posting across selected niche categories (Trending News, Science & Nature, History, Psychology, Life Wisdom, Tech & Future).
- **Auto-Reply & Messenger Bot**: Intelligent webhook listener for automated comment replies, private DMs, and conversational AI support via Facebook Messenger.
- **Live Feed Preview**: Real-time mock preview mimicking Facebook's feed UI to inspect text formatting and image layout before publishing.
- **Real-Time SSE Feed**: Server-Sent Events (SSE) live updates for automated queue execution, post successes, and webhook activities.

---

## 🛠️ Tech Stack

- **Backend**: Node.js, Express.js
- **Database**: SQLite3 (`better-sqlite3`) & JSON File Storage
- **Image Processing**: `sharp`
- **AI Engine**: Google Gemini API (`gemini-3.1-flash-lite`, `gemini-2.5-flash`)
- **APIs**: Meta Graph API v20.0
- **Frontend**: Vanilla JavaScript (ES6+), Tailwind CSS, Lucide Icons

---

## 📦 Installation & Setup

### 1. Clone the Repository
```bash
git clone https://github.com/imsusanta/facebook-auto-post.git
cd facebook-auto-post
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Setup Environment Configuration
Copy the sample environment file:
```bash
cp .env.example .env
```
Fill in your credentials in `.env` or configure them directly from the web settings dashboard:
- `ADMIN_API_KEY`: Secret key for dashboard & API endpoints (`x-admin-key: <token>` or `Authorization: Bearer <token>`).
- `ALLOWED_ORIGINS`: Comma-separated CORS origins (default: `http://localhost:3000`).
- `GEMINI_API_KEY`: Your Google Gemini API Key.
- `FB_PAGE_ID`: Your Facebook Page ID.
- `FB_PAGE_ACCESS_TOKEN`: Your Page Access Token (with `pages_manage_posts`, `pages_read_engagement`, `pages_messaging` permissions).
- `FB_VERIFY_TOKEN`: Verification token for Meta Webhooks.

### 4. Start the Application
```bash
npm start
```
Or in development mode with auto-reload:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🛡️ Security & Content Safety (Phase 1 & Phase 2 Hardened)

The application implements rigorous defense-in-depth controls for credentials, network traffic, and published content:

1. **Zero Token Leakage:** Credentials (`accessToken`, `geminiApiKey`, etc.) are stripped from all API responses (`utils/public-serializer.js`) and replaced with safe boolean indicators (`geminiConfigured`, `facebookConnected`).
2. **Route Authentication:** All API routes (except the Meta webhook) are protected via `ADMIN_API_KEY` with timing-safe comparison (`middleware/auth.js`).
3. **Settings Allowlist & Prototype Pollution Guard:** Strict payload filtering blocks unauthorized keys and prototype injection vectors (`__proto__`, `constructor`, `prototype`).
4. **HTTP Hardening:** Helmet security headers, restricted CORS (`ALLOWED_ORIGINS`), 1MB JSON body limits, and multi-tier rate limiting (`express-rate-limit`).
5. **Safe Logging:** Automatic in-flight redaction of Facebook access tokens, Gemini keys, and authorization headers in server logs (`utils/logger.js`).
6. **15 Pre-Publish Content Safety Checks:** Checks for mojibake encoding corruption, duplicate posts (Jaccard similarity threshold 0.65), spammy emoji/hashtag ratios, real-person AI image restrictions, source verification for news, and valid image files (`services/content-safety.js`).
7. **Fail-Closed AutoPilot:** When AI generation fails, emergency fallback templates are held in the queue with `status: 'review_required'` rather than being silently auto-published to Facebook (`services/scheduler.js`).

For full technical specifications, see:
- [Phase 1 Technical & Security Audit](docs/phase-1-audit.md)
- [Security Architecture & Operations Runbook](docs/security.md)
- [Content Safety Architecture & Publishing Guardrails](docs/content-safety.md)

---

## 🧪 Testing & Verification

Run the automated test and validation suite:

```bash
# Run the hermetic test suite (25 automated test cases)
npm test

# Verify source files for UTF-8 integrity and mojibake prevention
npm run check:encoding

# Run ESLint checks
npm run lint
```

---

## 🔒 Security & Privacy Notice

- Never commit your `.env` file or `data/settings.json` containing live tokens or API keys to version control.
- Ensure your Facebook Page Access Token has appropriate expiry and security settings in the Meta Developer Portal.
- Keep file permissions restricted (`chmod 600 .env data/settings.json`).

---

## 📄 License

MIT License. Feel free to use and customize for your own projects!
