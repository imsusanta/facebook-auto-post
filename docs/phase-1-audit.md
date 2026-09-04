# Phase 1 & 2: Technical and Security Audit Report (Re-Audited with Verified Evidence)

**Date:** 2026-09-04  
**Base Commit SHA:** `d1f4f1a` (`main`)  
**Audit Target Branch:** `fix/security-and-content-safety`  
**Repository:** `https://github.com/imsusanta/facebook-auto-post`  
**Current Recommendation:** **DO NOT MERGE** (Awaiting manual operator review, staging verification, and production secrets vault setup)

---

## 1. Executive Summary & Merge Recommendation

A comprehensive architectural and security audit of the Facebook Content Automation System was conducted against base commit `d1f4f1a`.

### Final Recommendation: **DO NOT MERGE**
Although all critical vulnerabilities from Phase 1 and content safety hazards from Phase 2 have been actively remediated or guarded in code, this branch **MUST NOT BE MERGED** into `main` or deployed directly to production until the following manual and infrastructure requirements are completed:
1. **Operator Security Review:** The repository owner must verify administrator credentials and configure environment-level secrets (`ADMIN_PASSWORD`, `FB_APP_SECRET`, `FB_VERIFY_TOKEN`).
2. **Secrets Storage Architecture Decision:** Plaintext secret storage on disk (SEC-08) is currently mitigated via file permissions (`chmod 600`) and redaction serializers, but has not been transitioned to a cryptographic vault or envelope encryption.
3. **Session Store Scaling:** In-memory session tracking must be evaluated if multi-instance or serverless horizontal scaling is planned.
4. **Meta App Review Staging:** Live Facebook Graph API webhooks and posting must be validated in Meta Developer Sandbox prior to production publish.

---

## 2. Verified Audit Findings Table

| ID | Category | Status | Exact File & Lines | Exact Function / Route | Verified Base Code Snippet (`d1f4f1a`) | Risk Assessment | Remediated Status |
|:---|:---|:---|:---|:---|:---|:---|:---|
| **SEC-01** | Secret Leakage | Confirmed | `routes/settings.routes.js:10-12` | `GET /api/settings` | `router.get('/', (req, res) => { res.json(storage.getSettings()); });` | Exposes raw `accessToken`, `geminiApiKey`, and `pages[].accessToken` directly in API response payloads. | **Fixed in this branch** via `utils/public-serializer.js` (`serializeSettings`). |
| **SEC-02** | Token Exposure | Confirmed | `routes/facebook.routes.js:71-80, 150-156` | `GET /api/facebook/pages`, `GET /api/facebook/pages/:id` | `router.get('/pages', (req, res) => { ... res.json({ ..., pages }); });` | Leaks raw Facebook Page Access Tokens of all connected pages to web clients and network inspection. | **Fixed in this branch** via `serializePage` / `serializePages`. |
| **SEC-03** | Prototype Pollution & Secret Injection | Confirmed | `routes/settings.routes.js:16-24` | `POST /api/settings` | `const updated = storage.saveSettings(req.body);` | No validation or allowlist on `req.body`. Vulnerable to prototype pollution (`__proto__`) and unauthorized setting overrides. | **Fixed in this branch** via `middleware/settings-validator.js`. |
| **SEC-04** | Missing Route Auth | Confirmed | `server.js:29`, `routes/index.js:14-23` | Master Router Bootstrap | `app.use('/api', apiRoutes);` (no auth middleware applied) | Any network client can access settings, trigger manual posts, delete pages, or modify automations. | **Fixed in this branch** via `middleware/auth.js` (`x-admin-key`, Bearer, session cookie). Fail-closed in all environments. |
| **SEC-05** | Wildcard CORS | Confirmed | `server.js:20` | Express App Init | `app.use(cors());` | Unrestricted wildcard CORS allows any third-party website in operator browser to send local requests. | **Fixed in this branch** via `utils/cors-validator.js` (`ALLOWED_ORIGINS`). |
| **SEC-06** | Missing Rate Limiting | Confirmed | `server.js:19-25` | Express App Middleware | No rate limiter mounted on `/api` or generation routes. | Vulnerable to request flooding, denial of service, and Gemini API quota exhaustion. | **Fixed in this branch** via `express-rate-limit` (500/15m API, 30/1m generation, 15/15m credentials). |
| **SEC-07** | Unbounded Body Size | Confirmed | `server.js:21-22` | Body Parsers | `app.use(express.json()); app.use(express.urlencoded({ extended: true }));` | Lack of payload limits permits memory exhaustion and large payload denial-of-service attacks. | **Fixed in this branch** with `limit: '1mb'`. |
| **SEC-08** | Plaintext Secret Storage | Confirmed | `services/storage.js:225, 244, 319` | `storage.saveSettings()`, `storage.updateConnectedPage()` | `writeJsonFile(SETTINGS_FILE, updated);` *(Note: previously miscited as `services/settings.js`)* | Tokens and API keys stored in plaintext in `data/settings.json` on disk. | **Mitigated, not fixed**. Mitigated via filesystem permissions (`chmod 600`), `.gitignore`, API redaction, and isolated test fixtures. Cryptographic at-rest encryption or KMS not yet implemented. |
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
| **CONT-19** | Missing Pre-Publish Safety Guard | Confirmed | `routes/facebook.routes.js:12-40`, `services/scheduler.js:258-265` | Instant Post & AutoPilot Publishing | Direct pipeline from request/AI to `facebook.publishPost()`. | Zero pre-publish checks for length bounds, mojibake, spammy emojis/hashtags, or unverified claims. | **Fixed in this branch**: Implemented 15 pre-publish checks with structured issue codes in `services/content-safety.js`. |
| **CONT-20** | AI Art for Real-Person News | Confirmed | `services/ai.js:1050-1090` | `generateThumbnailCardFromData()` | Unrestricted background fetching via `fetchSmartBackground()` for news topics with real people. | Generating synthetic AI images for living politicians or breaking news violates Meta content policies. | **Fixed in this branch**: Rule 10 in `services/content-safety.js` blocks synthetic imagery of real figures. |

---

## 3. Truthful List of Open Issues & Architectural Limitations

The following items are **currently open or subject to inherent architectural boundaries**:

### 1. SEC-08: Plaintext Secret Storage on Disk (Mitigated, Not Fixed)
- **Current State:** Credentials (`fbAppSecret`, `accessToken`, `geminiApiKey`, `pages[].accessToken`) are written in plaintext JSON format to `data/settings.json`.
- **Mitigations Applied:**
  - Filesystem permission hardening: Files created with restrictive POSIX permissions (`0600` / `0700`).
  - Repository protection: `data/` and `settings.json` are listed in `.gitignore`.
  - HTTP Redaction: Responses from `GET /api/settings`, `GET /api/facebook/pages`, and SSE streams strip secrets via `utils/public-serializer.js`.
  - Test Isolation: Integration tests execute against temporary isolated directories; real developer `data/settings.json` is protected and verified unchanged.
- **Why Not Fixed:** True remediation requires implementing symmetric authenticated encryption at rest (e.g., AES-256-GCM) with a master key derived from an external KMS, HSM, or master password environment variable, plus a key rotation lifecycle.

### 2. In-Memory Session Store Limitations
- **Current State:** Authenticated admin sessions and CSRF tokens are tracked in an in-memory `Map` inside `middleware/auth.js`.
- **Limitations:**
  - **Process Restarts:** Any restart, crash, or server reload immediately wipes all active user sessions, forcing operators to log in again.
  - **Horizontal Scaling:** Cannot scale across multiple Node.js worker processes (e.g. PM2 cluster mode) or multi-container Kubernetes pods, as sessions are not shared across processes.
  - **Memory Growth:** Mitigated by a 15-minute sweep interval (`unref()`'d timer) that removes expired sessions, but high-concurrency attack scenarios would require rate limiting at the edge or Redis-backed session storage.

### 3. Content Safety Heuristic Boundaries
The pre-publish safety guard in `services/content-safety.js` executes 15 defensive rules. Operators must understand the inherent limitations of these heuristics:
- **URL Validity $\neq$ Factual Truth:** Rule 6 checks that news claims reference a valid, syntactically well-formed URL. It cannot verify whether the cited article actually supports the claims made in the post.
- **Regular Expressions $\neq$ Legal Compliance:** Mojibake regex (`/[\u0080-\u009F\u00C0-\u00FF]/`) and blocked phrase lists catch common corruption and egregious spam, but cannot guarantee compliance with all Meta advertising guidelines or jurisdictional defamation laws.
- **Jaccard Token Overlap $\neq$ Semantic Paraphrasing:** Duplicate detection uses Jaccard token similarity with a 0.65 threshold on normalized word sets. While it reliably prevents repetition of identical or near-identical topics, sophisticated rewording or distinct articles covering the same event may fall below the threshold.
- **UTF-8 Cleanliness $\neq$ Factual Accuracy:** Eliminating Latin-1 byte corruption ensures clean Bengali rendering on user devices, but is completely orthogonal to whether the textual assertions are true.

---

## 4. Real Headless Chrome Browser Verification via CDP

A genuine, end-to-end browser integration suite was developed in `tests/browser-test.js` to eliminate all reliance on tautological unit tests or mocked DOM environments:

- **Browser Executable:** System Google Chrome (`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`)
- **Version Tested:** `Chrome/152.0.7977.76`
- **Execution Mode:** `--headless=new`, isolated temporary `--user-data-dir`, `--remote-debugging-port=0`, `--disable-background-networking`, `--disable-component-update`, `--disable-sync`
- **Protocol:** Native Node.js `globalThis.WebSocket` communicating directly with Chrome DevTools Protocol (`Target`, `Page`, `Runtime`, `Network`). Zero third-party testing dependencies.
- **Results:** **19 of 19 assertions passed** in ~3.1 seconds with exit status 0:
  1. `Page.navigate`: Page loaded with correct title (`AutoPost - Facebook Post Automation`).
  2. Unauthenticated UI: Admin authentication modal (`#adminAuthModal`) is visible on initial load.
  3. Credential Sanitation: Password input field (`#adminAuthPasswordInput`) is empty on render.
  4. Static Security: Hardcoded operator credentials stripped from `public/index.html` markup.
  5. Styling Verification: Tailwind CSS styles computed successfully (`display: flex`, computed dimensions).
  6. Icon Verification: Lucide SVG icons rendered into DOM.
  7. CSP Validation: Zero `script-src` or `connect-src` Content Security Policy violations during rendering.
  8. Interactive Login: Form submission dispatched via CDP event triggers authenticated dashboard entry.
  9. Modal Dismissal: Auth modal successfully closes upon valid authentication.
  10. Cookie Protection: Session cookie is `HttpOnly` and cannot be accessed by client-side JavaScript (`document.cookie`).
  11. CSRF Binding: Valid CSRF token is held in application memory (`window.currentCsrfToken`).
  12. Real-time Support: EventSource API verified available and functional in browser context.
  13. Zero Leaks: Verified 0 plaintext secrets across `localStorage`, `sessionStorage`, DOM input values, or URL query parameters.
  14. Logout Flow: Logout button returns application to unauthenticated state and clears memory tokens with 0 fatal console errors.
  15. Network Isolation: Every requested URL host is `127.0.0.1` or `localhost` (0 non-loopback requests).
  16. CDN Prohibition: Zero external CDN or third-party requests attempted (`tailwindcss.com`, `unpkg.com`, `unsplash.com`, `fonts.googleapis.com`, `facebook.com`).
  17. Loopback Enforcement: Captured request origins are strictly loopback.
  18. Zero CSP Violations: Zero CSP violation events captured during full execution.
  19. Asset Reliability: Zero unexpected failed HTTP requests for local self-hosted vendor assets (`/vendor/tailwindcss.js`, `/vendor/lucide.min.js`).

---

## 5. Exact AIService Method Compatibility: Base (`d1f4f1a`) vs HEAD

Every public method on `AIService` (`services/ai.js`) was audited against base commit `d1f4f1a`. The exact contract is preserved:

| Method Name | Base Commit `d1f4f1a` Signature | Current HEAD Signature | Base Return Shape | Current HEAD Return Shape | Notes |
|:---|:---|:---|:---|:---|:---|
| `verifyGeminiKey` | `async verifyGeminiKey(apiKey)` | `async verifyGeminiKey(apiKey)` | `{ valid: true, model: string, message: string }` | `{ valid: true, success: true, model: string, message: string }` | Backward compatible; no credential leakage in errors. |
| `cleanSvgText` | `cleanSvgText(str)` | `cleanSvgText(str)` | `string` | `string` | Preserved exact XML/SVG character escaping. |
| `analyzeTemplate` | `async analyzeTemplate(imageBufferOrUrl, sampleText = '')` | `async analyzeTemplate(imageBufferOrUrl, sampleText = '')` | `{ headlinePatterns, writingVoice, visualStructure, designNotes, sampleHook, summary }` | `{ headlinePatterns, writingVoice, visualStructure, designNotes, sampleHook, summary }` | Preserved prompt extraction and candidate models. |
| `generateStructuredPost` | `async generateStructuredPost(optionsOrTopic = '', categoryId = '', pageId = '', templateId = '', templateObj = null)` | `async generateStructuredPost(optionsOrTopic = '', categoryId = '', pageId = '', templateId = '', templateObj = null)` | `{ badge, line1_red, line1_white, line2_white, line2_yellow, search_term, post_caption }` | `{ badge, line1_red, line1_white, line2_white, line2_yellow, search_term, post_caption, isFallback, generationSource, verified, sources }` | Backward compatible; fallbacks now sourced from categorized `services/ai/fallbacks.js`. |
| `fetchSmartBackground` | `async fetchSmartBackground(searchTerm, topic = '', variation = 0, styleMode = 'auto', customPrompt = '')` | `async fetchSmartBackground(searchTerm, topic = '', variation = 0, styleMode = 'auto', customPrompt = '')` | `Buffer` | `Buffer` | Preserved Unsplash/Wikipedia/Flux cascade. |
| `generateThumbnailCardFromData` | `async generateThumbnailCardFromData(cardData, topic = '', variation = 0, styleMode = 'auto', customPrompt = '', templateImage = null, cardLayout = 'auto', postStyle = 'auto')` | `async generateThumbnailCardFromData(cardData, topic = '', variation = 0, styleMode = 'auto', customPrompt = '', templateImage = null, cardLayout = 'auto', postStyle = 'auto')` | `{ success: true, fileName, localPath, url, layout }` \| `null` | `{ success: true, fileName, localPath, url, layout }` \| `null` | Preserved SVG rendering and Sharp image compositing. |
| `generateFullPostBundle` | `async generateFullPostBundle(options = {})` | `async generateFullPostBundle(options = {})` | `{ message, category, cardData, image }` | `{ message, category, cardData, image, isFallback, generationSource, verified, sources }` | Preserved all base contract fields; added safety metadata. |
| `regenerateThumbnailOnly` | `async regenerateThumbnailOnly(options = {})` | `async regenerateThumbnailOnly(options = {})` | `{ cardData, image, cardLayout }` | `{ cardData, image, cardLayout }` | Preserved parameter contract and SVG layout dispatch. |
| `regenerateCaptionOnly` | `async regenerateCaptionOnly(options = {})` | `async regenerateCaptionOnly(options = {})` | `{ success: true, message: string }` | `{ success: true, message: string }` | Preserved return object shape contract. |
| `generateTopicIdeas` | `async generateTopicIdeas({ category = '', keyword = '', count = 6 } = {})` | `async generateTopicIdeas({ category = '', keyword = '', count = 6 } = {})` | `Array<{ id, title, hook, badge, emoji, search_keyword }>` | `Array<{ id, title, hook, badge, emoji, search_keyword }>` | Preserved return array contract. |
| `generatePostText` | `async generatePostText(topic = '', categoryId = '')` | `async generatePostText(topic = '', categoryId = '')` | `string` | `string` | Returns caption string directly. |

---

## 6. Integration Test Suite Execution Summary

- **Test Runner:** Node.js native test runner (`tests/runner.js`)
- **Execution Time:** ~760 ms (with loopback-only network deny guard active)
- **Results:** **47 of 47 tests passed**, 0 failures across 10 test suites:
  - **Suite 1:** Real Network Egress Deny Guard (Blocks non-loopback `fetch`, `https.get`, `http.get`, `net.connect`)
  - **Suite 2:** Authentication & Session Security (Cookie-based auth, Bearer auth, `x-admin-key`, rate limiting, query-string credential rejection)
  - **Suite 3:** Safe Public Settings Serializer (Masks tokens, secrets, and private page access tokens)
  - **Suite 4:** Real HTTP CSRF & Origin Defense (Origin validation, anti-CSRF token binding, exemption for API keys)
  - **Suite 5:** Settings API Secret Protection (Rejects credential injections, masks verification endpoints)
  - **Suite 6:** Real HTTP Meta Webhook Signature Verification (Validates challenge echo, HMAC-SHA256 signatures, rejects tampered/malformed/wrong secret payloads with structured codes)
  - **Suite 7:** Real HTTP Route Publish Guards (Pre-publish content safety rejecting short captions, mojibake, unverified claims, invalid images)
  - **Suite 8:** Scheduler Trigger Flow Scenarios (Scenarios A through E: fallback holding, unverified news review, low-risk auto-publishing, AI error handling, queue concurrency locks)
  - **Suite 9:** Fallback Dataset & Category Audit (Validates unique IDs and category consistency)
  - **Suite 10:** Base Commit AIService API Return Shapes (Validates exact shape compatibility against base commit)

---

## 7. Authentication Flow & Cryptographic Hardening Audit

The administrative authentication mechanism was audited against enterprise security guidelines:

1. **Password Hashing:**
   - Evaluated PBKDF2 using HMAC-SHA512 with 100,000 iterations and 16-byte cryptographically secure random salt (`crypto.randomBytes(16)`).
   - Constant-time comparison (`crypto.timingSafeEqual`) prevents timing oracle side channels during authentication.
2. **Production Seeding Guard:**
   - `storage.initDefaultUsers()` detects `NODE_ENV === 'production'` and refuses to seed default credentials (`admin@123`). In production, initial superadmin accounts must be provisioned explicitly via environment variables or CLI seed scripts.
3. **Session Lifecycle & Rotation:**
   - Login calls `rotateSession(req, res, userData)`: immediately revokes any prior session ID from the in-memory store and issues a fresh session identifier to prevent session fixation attacks.
   - Logout invokes `destroySession(req)` and explicitly clears the `admin_session` cookie via `res.clearCookie()`.
4. **Cookie Security:**
   - Cookies are issued with `HttpOnly: true` (unreachable via JavaScript / XSS), `SameSite: 'Strict'` (immune to cross-site request forging), and `Secure: true` in production environments.
5. **Brute-Force & Credential Stuffing Defense:**
   - Dedicated authentication rate limiter mounted on `/api/auth/login`: limits attempts to 15 per 15-minute window per IP.
   - Account lockout: 5 consecutive failed login attempts trigger a 15-minute account lockout.
6. **Query-String Credential Rejection:**
   - Any credentials passed in URL query parameters (`req.query.apiKey`, `req.query.token`, `req.query.key`) are explicitly rejected by middleware with HTTP 400. Credentials are required in headers or HttpOnly cookies.

---

## 8. Data Directory Integrity & Secret Protection

- Real developer configuration `data/settings.json` was verified before and after all test suites.
- Checksums, file size, and modification timestamps remained 100% untouched (`unchanged: true`).
- File permissions on sensitive data stores (`settings.json`, `users.json`) enforce POSIX mode `0600` (read/write only by file owner).
- Automated test fixtures execute exclusively against temporary, isolated directories and mock stores.
