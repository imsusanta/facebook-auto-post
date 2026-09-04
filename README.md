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

## 🔒 Security & Privacy Notice

- Never commit your `.env` file or `data/settings.json` containing live tokens or API keys to version control.
- Ensure your Facebook Page Access Token has appropriate expiry and security settings in the Meta Developer Portal.

---

## 📄 License

MIT License. Feel free to use and customize for your own projects!
