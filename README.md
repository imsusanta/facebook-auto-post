# 🚀 Facebook Auto-Poster & Automation SaaS Engine

A Facebook Page automation application with a security and PostgreSQL foundation, powered by **Node.js, Express, Sharp, Google Gemini AI, and Meta Graph API v20.0**.

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

## Security and database foundation

The application now requires authenticated, email-verified accounts and PostgreSQL. The old shared JSON runtime, default-admin SQLite scaffold, public credential APIs and public uploads are no longer used.

**Breaking setup change:** read [the migration and deployment guide](docs/SECURITY_SETUP.md) before running this branch against real data. No production deployment is performed automatically.

## Tech stack

- Node.js 22+ / Express 5
- PostgreSQL 16+ with workspace-scoped repositories and versioned migrations
- Opaque cookie sessions, scrypt password hashes, AES-256-GCM credential encryption
- Sharp image decoding/re-encoding; protected workspace media
- Gemini / Meta Graph API integration (live provider validation required)
- Vanilla JavaScript, compiled Tailwind CSS, local Lucide and DOMPurify

## Quick start

```sh
npm ci
cp .env.example .env
# Configure PostgreSQL, encryption key, APP_ORIGIN and SMTP first.
npm run db:migrate
npm run build:css
npm start
```

Create an account, verify the email, then log in. Connect each customer's Facebook Page and Gemini key inside that customer's authenticated workspace. Automation and webhooks are disabled by default pending staging checks.

## Development checks

```sh
npm run check
npm run build:css
TEST_DATABASE_URL=postgresql://user:password@localhost:5432/autopost_test npm test
npm audit --omit=dev
```

See [SECURITY.md](SECURITY.md) and [the setup guide](docs/SECURITY_SETUP.md) for role permissions, migration steps, test coverage and known limitations. Billing, OAuth onboarding, production job recovery and operational readiness remain later SaaS phases.

---

## 📄 License

MIT License. Feel free to use and customize for your own projects!
