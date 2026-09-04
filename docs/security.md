# Security Architecture & Operations Runbook

**Document Version:** 1.0.0  
**Phase Completed:** Phase 2 (Critical Safety Fixes)  
**Branch:** `fix/security-and-content-safety`

---

## 1. Threat Model & Overview

The Facebook Automation Platform manages sensitive credentials (Facebook Page Access Tokens, Google Gemini API Keys, and Meta Webhook verification tokens). The application has been hardened to prevent:
1. **Secret Exfiltration:** Leakage of API keys or access tokens to web clients, SSE streams, or server logs.
2. **Unauthorized Access:** Execution of publishing actions or modification of settings without authentication.
3. **Configuration Tampering & Prototype Pollution:** Arbitrary object injection or prototype poisoning via API payloads.
4. **Denial of Service & Abuse:** Unbounded body payloads, origin abuse (CORS), or request flooding.
5. **Accidental Credential Exposure:** Committing secrets to version control or leaving files world-readable.

---

## 2. Core Security Controls

### A. Public Data Sanitization & Zero Token Exposure
- **Module:** `utils/public-serializer.js`
- **Behavior:** All responses returned via `GET /api/settings`, `GET /api/facebook/pages`, `POST /api/facebook/pages`, and Server-Sent Events broadcasts (`settings_updated`, `page_switched`) are filtered through a non-mutating recursive sanitizer.
- **Redaction Rules:**
  - Removes keys matching `accessToken`, `access_token`, `pageAccessToken`, `geminiApiKey`, `apiKey`, `password`, `secret`, `jwtSecret`, `refreshToken`, etc.
  - Replaces raw credentials with safe boolean indicators:
    - `geminiConfigured: boolean`
    - `facebookConnected: boolean`
    - `hasToken: boolean`
- **Defense in Depth:** `middleware/sse.js` automatically passes all outbound event data through `serializePublic` before writing to network sockets.

### B. Route Authentication & Access Control
- **Module:** `middleware/auth.js`
- **Enforcement:**
  - Requires `x-admin-key: <token>` or `Authorization: Bearer <token>`.
  - In production (`NODE_ENV=production`), **fails closed** (HTTP 500 error) if `ADMIN_API_KEY` is not set.
  - Development bypass is permitted only in local development when no key is configured or when `DEV_AUTH_BYPASS=true`.
  - Supports `?apiKey=<token>` query parameter specifically for browser `EventSource` SSE streams.
  - Preserves Meta Webhook verification: paths starting with `/webhook` bypass API key auth and are verified via Meta challenge / signature.
  - Employs `crypto.timingSafeEqual` for constant-time string comparison to prevent timing side-channel attacks.

### C. Settings Allowlist & Prototype Pollution Prevention
- **Module:** `middleware/settings-validator.js`
- **Rules:**
  - Restricts `POST /api/settings` to an explicit allowlist of keys (`pageName`, `pageId`, `accessToken`, `geminiApiKey`, `autoPostEnabled`, `autoPilotEnabled`, `cronSchedule`, `cronLabel`, `selectedCategories`, `includeAiImage`, `intervalMinutes`, `customSystemPrompt`, `isDemoMode`, `pictureUrl`, `activePageId`, `webhookVerifyToken`).
  - Scans recursively for prototype pollution vectors (`__proto__`, `constructor`, `prototype`).
  - Validates numeric boundaries (e.g. `intervalMinutes` must be integer between 1 and 1440).
  - Validates 5-part cron syntax via regex (`CRON_REGEX`).
  - Limits string lengths (e.g. `customSystemPrompt` max 10,000 characters).

### D. HTTP Hardening & Network Controls
- **Security Headers:** `helmet` applies essential security headers (X-Frame-Options, X-Content-Type-Options, Strict-Transport-Security, X-DNS-Prefetch-Control).
- **CORS Restriction:** Wildcard `cors()` removed. Replaced by origin whitelist controlled via `ALLOWED_ORIGINS` environment variable (defaults to `http://localhost:3000`, `http://127.0.0.1:3000`).
- **Body Size Limits:** `express.json({ limit: '1mb' })` and `express.urlencoded({ extended: true, limit: '1mb' })` block memory exhaustion attacks.
- **Rate Limiting:** `express-rate-limit` enforces rate bounds:
  - Standard API endpoints: 500 requests per 15 minutes.
  - Generation endpoints (`/api/ai/generate`): 30 requests per minute.

### E. Safe Logging & Error Sanitization
- **Module:** `utils/logger.js` and `middleware/errorHandler.js`
- **Automatic Redaction:**
  - Meta Page Access Tokens: `EAA[0-9A-Za-z_-]{15,}` -> `[REDACTED_FB_TOKEN]`
  - Gemini API Keys: `AIza[0-9A-Za-z_-]{25,}` -> `[REDACTED_GEMINI_KEY]`
  - Authorization headers: `Bearer ...` -> `Bearer [REDACTED]`
  - Query parameter secrets: `(?key=...|token=...)` -> `[REDACTED]`
- **Client Error Masking:** Stack traces are stripped in production; client messages have credentials sanitized.

---

## 3. Configuration & Secrets Best Practices

### Local Environment Setup
1. Copy template:
   ```bash
   cp .env.example .env
   ```
2. Generate a cryptographically secure admin key:
   ```bash
   openssl rand -hex 32
   ```
3. Set in `.env`:
   ```ini
   ADMIN_API_KEY=your_generated_64_character_hex_key
   ALLOWED_ORIGINS=http://localhost:3000
   ```
4. Secure file permissions:
   ```bash
   chmod 600 .env data/settings.json
   ```

### Version Control Guidelines
- Never commit `.env` or `data/*.json`.
- Both are explicitly included in `.gitignore`.
- Run automated verification before committing:
  ```bash
  npm test
  npm run check:encoding
  npm run lint
  ```
