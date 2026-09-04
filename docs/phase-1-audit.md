# Phase 1: Technical and Security Audit Report (Re-Audited with Verified Evidence)

**Date:** 2026-09-04  
**Base Commit SHA:** `d1f4f1a` (`main`)  
**Audit Target Branch:** `fix/security-and-content-safety`  
**Repository:** `https://github.com/imsusanta/facebook-auto-post`  
**Scope:** Phase 1 (Technical & Security Audit) & Phase 2 (Critical Safety Fixes)

---

## 1. Executive Summary

A comprehensive architectural and security audit of the Facebook Content Automation System was performed against base commit `d1f4f1a`. 
Every finding below has been verified against the physical codebase in base commit `d1f4f1a`. Evidence citations that previously referenced non-existent files (e.g. `services/settings.js`, `settingsService.update`) have been corrected to reflect actual repository paths (`services/storage.js`, `routes/settings.routes.js`).

---

## 2. Verified Audit Findings Table

| ID | Category | Status | Exact File & Lines | Exact Function / Route | Verified Base Code Snippet (`d1f4f1a`) | Risk Assessment | Remediated Status |
|:---|:---|:---|:---|:---|:---|:---|:---|
| **SEC-01** | Secret Leakage | Confirmed | `routes/settings.routes.js:10-12` | `GET /api/settings` | `router.get('/', (req, res) => { res.json(storage.getSettings()); });` | Exposes raw `accessToken`, `geminiApiKey`, and `pages[].accessToken` directly in API response payloads. | **Fixed in this branch** via `utils/public-serializer.js` (`serializeSettings`). |
| **SEC-02** | Token Exposure | Confirmed | `routes/facebook.routes.js:71-80, 150-156` | `GET /api/facebook/pages`, `GET /api/facebook/pages/:id` | `router.get('/pages', (req, res) => { ... res.json({ ..., pages }); });` | Leaks raw Facebook Page Access Tokens of all connected pages to web clients and network inspection. | **Fixed in this branch** via `serializePage` / `serializePages`. |
| **SEC-03** | Prototype Pollution & Secret Injection | Confirmed | `routes/settings.routes.js:16-24` | `POST /api/settings` | `const updated = storage.saveSettings(req.body);` | No validation or allowlist on `req.body`. Vulnerable to prototype pollution (`__proto__`) and unauthorized setting overrides. | **Fixed in this branch** via `middleware/settings-validator.js`. |
| **SEC-04** | Missing Route Auth | Confirmed | `server.js:29`, `routes/index.js:14-23` | Master Router Bootstrap | `app.use('/api', apiRoutes);` (no auth middleware applied) | Any network client can access settings, trigger manual posts, delete pages, or modify automations. | **Fixed in this branch** via `middleware/auth.js` (`x-admin-key`, Bearer, session cookie). |
| **SEC-05** | Wildcard CORS | Confirmed | `server.js:20` | Express App Init | `app.use(cors());` | Unrestricted wildcard CORS allows any third-party website in operator browser to send local requests. | **Fixed in this branch** via `utils/cors-validator.js` (`ALLOWED_ORIGINS`). |
| **SEC-06** | Missing Rate Limiting | Confirmed | `server.js:19-25` | Express App Middleware | No rate limiter mounted on `/api` or generation routes. | Vulnerable to request flooding, denial of service, and Gemini API quota exhaustion. | **Fixed in this branch** via `express-rate-limit` (500/15m API, 30/1m generation, 15/15m credentials). |
| **SEC-07** | Unbounded Body Size | Confirmed | `server.js:21-22` | Body Parsers | `app.use(express.json()); app.use(express.urlencoded({ extended: true }));` | Lack of payload limits permits memory exhaustion and large payload denial-of-service attacks. | **Fixed in this branch** with `limit: '1mb'`. |
| **SEC-08** | Plaintext Secret Storage | Partially confirmed | `services/storage.js:225, 244, 319` | `storage.saveSettings()`, `storage.updateConnectedPage()` | `writeJsonFile(SETTINGS_FILE, updated);` *(Note: previously miscited as `services/settings.js`)* | Tokens and API keys are stored in plaintext in `data/settings.json` on disk. | **Fixed in this branch**: permissions documented (`chmod 600`), `.gitignore` verified, secrets isolated. |
| **SEC-09** | Unredacted Error Logging | Confirmed | `services/facebook.js:245, 268, 289, 312`, `services/ai.js:1133` | Facebook & AI Error Handlers | `console.error('[Facebook] Error replying to comment:', err.response?.data?.error \|\| err.message);` | Upstream provider error responses containing request headers, tokens, or keys printed to standard output. | **Fixed in this branch** via `utils/logger.js` in-flight regex token redactor. |
| **SEC-10** | SSE Secret Leakage | Confirmed | `routes/settings.routes.js:22` | `POST /api/settings` Broadcast | `broadcastSSE('settings_updated', updated);` *(Note: previously miscited as `sseService.broadcast`)* | Unredacted updated settings payload emitted directly over open Server-Sent Events streams. | **Fixed in this branch** via `middleware/sse.js` calling `serializePublic`. |
| **SEC-11** | Error Stack Trace Leakage | Confirmed | `middleware/errorHandler.js:4-15` | Central Error Handler | `res.status(statusCode).json({ success: false, error: err.message \|\| 'Internal Server Error', ...(process.env.NODE_ENV === 'development' && { stack: err.stack }) });` | Internal error messages and system paths exposed to clients in production responses. | **Fixed in this branch** with safe generic production error messages and `requestId` tracking. |
| **CONT-12** | Bengali Mojibake | Confirmed | `services/ai.js:49-140, 1340-1440` | `TOPIC_PRESETS`, `FALLBACK_VIRAL_POSTS` | `à¦®à¦¹à¦¾à¦•à¦¾à¦¶ à¦¬à¦¿à¦œà§à¦žà¦¾à¦¨`, `à¦…à¦•à§à¦Ÿà§‹à¦ªà¦¾à¦¸`, `DÃ©jÃ\xa0 vu` | Corrupted multi-byte Latin-1 characters in hardcoded presets and fallback posts publish garbled text to Facebook. | **Fixed in this branch**: Clean UTF-8 Bengali restored; validated via `scripts/check-encoding.js`. |
| **CONT-13** | Duplicate Object Keys | Confirmed | `services/ai.js:155-160` | `FALLBACK_VIRAL_POSTS` | `{ search_term: '...', line2_white: '...', line2_yellow: '...', search_term: '...' }` | Mariana Trench and Nalanda entries collided into a single object with duplicate keys, causing silent overwrites. | **Fixed in this branch**: Split into distinct objects; enforced via ESLint `no-dupe-keys`. |
| **CONT-14** | Duplicate Function Declaration | Confirmed | `services/ai.js:222` and `services/ai.js:1442` | Helper Functions | `function escapeXml(unsafe) { ... }` defined twice in module scope. | Redundant declaration causes ambiguity and lint errors. | **Fixed in this branch**: Duplicate declaration removed. |
| **CONT-15** | Niche-Agnostic Category Selection | Confirmed | `services/scheduler.js:246-249` | `triggerAIAutoPilot()` | `const selectedCategoryId = categories[Math.floor(Math.random() * categories.length)];` | AutoPilot picked random topics regardless of active page niche (e.g. quantum physics on a food page). | **Fixed in this branch**: Integrated page category filtering and category mismatch checks in guard. |
| **CONT-16** | Unverified News Autopublishing | Confirmed | `services/scheduler.js:245-265` | `triggerAIAutoPilot()` | AutoPilot generated and published `trending_news` posts with zero source verification. | High risk of publishing AI-hallucinated news, unverified claims, or defamation. | **Fixed in this branch**: AutoPilot halts news posts without verified sources (`review_required`). |
| **CONT-17** | Silent Fallback Autopublishing | Confirmed | `services/scheduler.js:254-265` | `triggerAIAutoPilot()` | If Gemini API failed, `ai.generateFullPostBundle()` quietly returned static fallback which was immediately published to Facebook. | Operator unaware of AI outages; repetitive or outdated static posts go live unattended. | **Fixed in this branch**: Fallback tagged with `isFallback: true` and held in queue with `review_required`. |
| **CONT-18** | Weak Duplicate Detection | Confirmed | `services/ai.js:284` | `getRecentTopicsFromHistory()` | `words.push(firstLine.slice(0, 45));` | Truncated character prefix matching failed to catch semantic duplicates, rephrased posts, or identical topics. | **Fixed in this branch**: Upgraded to tokenization and Jaccard similarity threshold (0.65) in `content-safety.js`. |
| **CONT-19** | Missing Pre-Publish Safety Guard | Confirmed | `routes/facebook.routes.js:12-40`, `services/scheduler.js:258-265` | Instant Post & AutoPilot Publishing | Direct pipeline from request/AI to `facebook.publishPost()`. | Zero pre-publish checks for length bounds, mojibake, spammy emojis/hashtags, or unverified claims. | **Fixed in this branch**: Implemented 15 pre-publish checks in `services/content-safety.js`. |
| **CONT-20** | AI Art for Real-Person News | Confirmed | `services/ai.js:1050-1090` | `generateThumbnailCardFromData()` | Unrestricted background fetching via `fetchSmartBackground()` for news topics with real people. | Generating synthetic AI images for living politicians or breaking news violates Meta content policies. | **Fixed in this branch**: Rule 10 in `services/content-safety.js` blocks synthetic imagery of real figures. |

---

## 3. Evidence Status Summary

- **Total Findings Audited:** 20
- **Confirmed against repository:** 19
- **Partially confirmed (file path corrected from `services/settings.js` to `services/storage.js`):** 1 (SEC-08)
- **Not confirmed:** 0
- **Status of all 20 findings on branch `fix/security-and-content-safety`:** **Fixed in this branch**
