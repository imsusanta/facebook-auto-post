# Security Foundation & Content-Safety Publishing Guards (PR Review)

## 1. Scope
This PR delivers a security hardening pass, authentication fail-close posture, and automated publishing guardrails across the Facebook Auto-Poster platform. It addresses identified risks in secret handling, authentication bypasses, cross-site attack surfaces, webhook payload tampering, multi-byte Latin-1 character corruption, and automated publishing hazards.

Total affected surface: 38 files changed across core server infrastructure, middleware, routes, public dashboard UI, automation schedulers, and integration test suites.

---

## 2. Architecture Changes
1. **Server & Middleware Factory (`createApp.js`):**
   - Decoupled Express app configuration into a testable factory (`createApp()`), leaving `server.js` purely responsible for port binding and process lifecycle.
   - Dedicated raw webhook body parser mounted strictly prior to standard JSON parsers to ensure byte-accurate HMAC-SHA256 signature calculation.
   - Restrictive Content Security Policy (CSP) via Helmet, permitting self-hosted resources while forbidding unverified remote scripts and CDNs.
2. **Data Directory Permission Hardening (`services/storage.js`):**
   - File creation and writes to sensitive data stores enforce POSIX permission mode `0600` (read/write by owner only).
   - Dynamic data directory configuration (`process.env.DATA_DIR`) ensures integration tests execute in ephemeral directories without touching host data.
3. **Public Data Sanitization Pipeline (`utils/public-serializer.js`):**
   - Centralized redaction serializers filter settings, connected page objects, and user models before payloads reach HTTP route handlers, API responses, or Server-Sent Events (SSE) streams.

---

## 3. Authentication Flow
1. **PBKDF2 Cryptographic Verification:**
   - Password hashes are derived using PBKDF2 with HMAC-SHA512 over 100,000 iterations and a 16-byte cryptographically secure random salt.
   - Timing attacks are defended against using `crypto.timingSafeEqual` for all hash comparisons.
2. **Fail-Closed Posture:**
   - Absence or misconfiguration of `NODE_ENV` fails closed: no hardcoded default accounts or passwords are seeded unless `NODE_ENV` is explicitly set to `development` or `test`.
   - Production instances require explicit operator credentials via environment variables (`ADMIN_PASSWORD` / `ADMIN_INITIAL_PASSWORD`).
   - Query-string authentication (`req.query.apiKey`, `req.query.token`, `req.query.key`) is strictly prohibited and rejected with HTTP 400.
3. **Session Rotation & Cookie Hardening:**
   - Login calls `rotateSession()`, invalidating prior session identifiers to eliminate session fixation.
   - Cookies are issued with `HttpOnly: true`, `SameSite: Strict`, and `Secure: true` in production.
   - Brute-force throttling enforces a 15-minute lockout upon 5 consecutive failed attempts per IP.
   - Logout invokes `destroySession()` and clears client cookies with `Max-Age=0`.

---

## 4. CSRF Flow
1. **Memory-Bound Token Lifecycle:**
   - Anti-CSRF tokens (32-byte cryptographic random hex) are generated upon authentication and tied to the active server session.
   - State-mutating HTTP methods (`POST`, `PUT`, `PATCH`, `DELETE`) require the `X-CSRF-Token` header.
2. **Origin & Referer Validation:**
   - Cross-origin requests from untrusted origins are blocked with HTTP 403 (`FORBIDDEN_ORIGIN`).
3. **Service & Machine Exemption:**
   - Requests authenticated via machine headers (`x-admin-key` or Bearer tokens) are exempt from browser CSRF token requirements.

---

## 5. Webhook Signature Flow
1. **Mount Order & Raw Buffer Preservation:**
   - Route `/api/webhook` mounts `express.raw({ type: '*/*', limit: '2mb' })` prior to `express.json()`.
   - Meta webhooks require bit-exact byte streams to compute valid signatures; JSON body re-serialization is avoided.
2. **HMAC-SHA256 Verification:**
   - Verifies incoming `X-Hub-Signature-256` header against `FB_APP_SECRET`.
   - Compares HMAC digests using constant-time evaluation (`crypto.timingSafeEqual`).
   - Rejects missing, malformed, or tampered requests with structured error codes (`SIGNATURE_MISSING`, `INVALID_SIGNATURE_FORMAT`, `INVALID_SIGNATURE`).

---

## 6. Secret Redaction Boundaries
1. **API Response Masking:**
   - Route handlers invoke `serializeSettings()` to mask `accessToken`, `geminiApiKey`, and `pages[].accessToken`.
   - Clients receive boolean indicators (`facebookConnected`, `geminiConfigured`) instead of raw tokens.
2. **SSE Broadcast Isolation:**
   - Real-time updates emitted over Server-Sent Events pass through `serializePublic()`, preventing credential leakage to connected UI browsers.
3. **In-Flight Logging Redaction:**
   - `utils/logger.js` applies regex filters against common token formats (`AIza...`, `EAA...`, Bearer tokens) before writing to standard streams.

---

## 7. Scheduler Publishing Guard
1. **Pre-Publish Safety Pipeline (`services/content-safety.js`):**
   - 15 deterministic checks execute prior to any Facebook publishing attempt:
     - Minimum length validation (>= 30 characters).
     - Multi-byte Latin-1 mojibake detection.
     - Source URL validation for news and factual claims.
     - Jaccard token overlap similarity check (0.65 threshold) against recent post history.
     - Real-person synthetic imagery block for breaking news.
     - Local file existence and MIME type validation for image attachments.
2. **Concurrency Locking:**
   - Queue worker uses atomic concurrency guards to prevent duplicate post dispatch under concurrent scheduler ticks.

---

## 8. Fallback Review Behavior
1. **Fail-Safe Holding Queue:**
   - When external AI generation fails, the system sources curated static templates from `services/ai/fallbacks.js`.
   - Curated fallbacks are flagged with `isFallback: true` and routed to the manual review queue (`review_required`).
   - Autopublishing never publishes unreviewed static fallbacks automatically.
2. **Trending News Guard:**
   - Trending news lacking verified citation URLs is diverted to the review queue with code `MISSING_SOURCE`.

---

## 9. Browser & CSP Changes
1. **Self-Hosted Vendor Assets:**
   - Client scripts (`tailwindcss.js` v3.4.17, `lucide.min.js` v1.41.0) are bundled locally under `public/vendor/`.
   - All third-party CDN tags (`cdn.tailwindcss.com`, `unpkg.com`, external fonts) have been removed.
   - Upstream licenses documented in `public/vendor/NOTICE.md`.
2. **Content Security Policy:**
   - Restricts `script-src` and `style-src` to `'self'` and `'unsafe-inline'`.
   - Restricts `img-src` to `'self'`, `data:`, and `blob:`.
   - Restricts `connect-src` to `'self'`.

---

## 10. Test Architecture
1. **Clean-Room Verification:**
   - Reproducible installation verified from `package-lock.json` (`npm ci`) in isolated temporary worktrees.
2. **Loopback Network Deny Guard (`tests/network-guard.js`):**
   - Intercepts Node.js `globalThis.fetch`, `http.get`, `https.get`, and `net.connect` to block non-loopback egress during testing.
3. **End-to-End Headless Chrome CDP Suite (`tests/browser-test.js`):**
   - 19 automated assertions verify real DOM loading, styling computation, icon rendering, login/logout transitions, HttpOnly cookies, CSRF tokens, loopback-only network traffic, zero CDN requests, and clean process termination.
4. **Integration Test Runner (`tests/runner.js`):**
   - 49 tests across 10 suites validating network guards, authentication, serialization, CSRF defenses, secret protection, webhook signatures, publish rules, scheduler flows, fallback pools, and base API contracts.

---

## 11. Breaking-Change Risks
1. **Strict Query Parameter Removal:**
   - Any external integration passing `?apiKey=...` or `?token=...` in request URLs will receive HTTP 400. Clients must transition to `x-admin-key`, `Authorization: Bearer`, or cookie sessions.
2. **Fail-Closed Defaults:**
   - Running without setting `ADMIN_PASSWORD` in production will not permit default account login (`admin@123`).
3. **CSP Restrictions:**
   - Custom templates referencing external hotlinked images or remote script widgets will be blocked by browser CSP.

---

## 12. Manual Review Checklist
- [ ] Verify `ADMIN_PASSWORD` is configured in production environment secrets.
- [ ] Confirm no production database contains default passwords.
- [ ] Audit CORS allowed origins (`ALLOWED_ORIGINS`) to match authorized dashboard domains.
- [ ] Review `FB_APP_SECRET` and `FB_VERIFY_TOKEN` configurations for webhook ingress.
- [ ] Confirm file ownership and directory permissions on production volume (`data/` chmod 700, files chmod 600).

---

## 13. Staging Checklist
- [ ] Deploy candidate commit to isolated staging server.
- [ ] Verify clean `npm ci` without `--force` flags.
- [ ] Verify dashboard loads over HTTPS with valid `HttpOnly; Secure; SameSite=Strict` cookies.
- [ ] Perform manual login with staging administrator credentials.
- [ ] Test Meta webhook verification handshake using Meta Developer App Test tool.
- [ ] Validate manual post creation and confirm pre-publish safety checks trigger appropriately.
- [ ] Confirm review queue captures unverified news and static fallbacks.

---

## 14. Rollback Plan
- **Git Reversion:** Base commit is `main` (`d1f4f1a`). In event of deployment failure:
  ```bash
  git checkout main
  npm ci
  pm2 restart server || systemctl restart autopost
  ```
- **Data Compatibility:** File formats for `settings.json`, `queue.json`, and `history.json` maintain backwards compatibility with base commit data structures.
- **Session Reset:** Any active in-memory sessions will be reset upon restart.

---

## 15. Known Limitations
1. **SEC-08: Secret Storage at Rest (Mitigated, Not Fixed):**
   - Settings remain stored in JSON files protected by POSIX permissions (`0600`) and `.gitignore`. Envelope encryption (AES-256-GCM) or external KMS integration is deferred to Phase 3.
2. **In-Memory Session Storage:**
   - Active sessions are maintained in process memory. Clustering across multiple processes or containers requires an external session store (e.g. Redis).
3. **Heuristic Safety Boundaries:**
   - Content safety heuristics detect format violations, spam patterns, and missing URLs, but cannot verify real-world factual claims.
