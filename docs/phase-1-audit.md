# Phase 1: Technical and Security Audit Report

**Date:** 2026-09-04  
**Branch:** `fix/security-and-content-safety`  
**Repository:** `https://github.com/imsusanta/facebook-auto-post`  
**Scope:** Phase 1 (Technical & Security Audit) & Phase 2 (Critical Safety Fixes)

---

## Executive Summary

An architectural and security audit of the Facebook Content Automation System was conducted to evaluate credentials handling, access control, HTTP hardening, content generation safety, and publisher reliability. 

Twenty critical and high-priority findings were identified across the codebase. These issues expose API keys and Facebook Page access tokens via REST APIs and Server-Sent Events (SSE), allow unrestricted configuration modification, risk prototype pollution, permit unauthenticated control, cause text corruption (mojibake) in published Bengali posts, and risk publishing unverified or repetitive AI-generated content automatically without human review.

This document details all 20 findings, their severity, code evidence, associated risks, and the remediation plan executed in Phase 2.

---

## Detailed Audit Findings

| ID | Finding | Severity | Evidence | Risk | Proposed Fix |
|:---|:---|:---|:---|:---|:---|
| **SEC-01** | Secret Leakage in Settings API | Critical | `routes/settings.routes.js:10-12`<br>`res.json({ success: true, settings })` | Leaks raw `geminiApiKey`, `accessToken`, and `pages[].accessToken` directly to client browsers and network inspectors. | Introduce `utils/public-serializer.js` to strip raw keys and expose only presence booleans (e.g. `geminiConfigured: true`). |
| **SEC-02** | Facebook Page Token Exposure | Critical | `routes/facebook.routes.js:15, 62`<br>`res.json({ success: true, pages: ... })` | Exposes raw page access tokens in response payloads for all connected Facebook pages. | Filter and mask `accessToken` in all page list and single page retrieval endpoints. |
| **SEC-03** | Unrestricted Settings Modification & Prototype Pollution | High | `routes/settings.routes.js:15-28`<br>`settingsService.update(req.body)` | Malicious or malformed payloads can overwrite critical config, inject arbitrary keys, or poison object prototypes via `__proto__` or `constructor`. | Validate payload against a strict allowlist of editable settings fields and block prototype pollution keys. |
| **SEC-04** | Missing API Route Authentication | High | `server.js:29-37`<br>`app.use('/api/...', ...)` | Any client with network access to localhost/LAN can read settings, change credentials, trigger posts, or manage pages. | Implement `middleware/auth.js` requiring admin token / API key header (`x-admin-key` or `Authorization`), failing closed in production. |
| **SEC-05** | Wildcard CORS Permissiveness | High | `server.js:20`<br>`app.use(cors())` | Any malicious website visited in the operator's browser can perform cross-origin requests to local API endpoints (drive-by exploit). | Restrict CORS to explicit allowed origins via environment variable (`ALLOWED_ORIGINS`), with strict default fallback. |
| **SEC-06** | Lack of API Rate Limiting | Medium | `server.js:20-25`<br>No rate limiter mounted | Vulnerable to request flooding, rapid token quota exhaustion (Gemini API), and denial of service. | Add `express-rate-limit` to generation and sensitive mutating endpoints. |
| **SEC-07** | Unbounded Request Body Size | Medium | `server.js:23-24`<br>`express.json()`, `express.urlencoded({ extended: true })` | Vulnerable to memory exhaustion and payload bombs through unbounded request sizes. | Set explicit body limits (`express.json({ limit: '1mb' })`). |
| **SEC-08** | Plaintext Secret Storage on Disk | High | `services/settings.js`<br>Writes raw JSON to `data/settings.json` | Local file access or repository misconfiguration can expose persistent secrets in plaintext. | Document file permission requirements (`chmod 600`), add `.env.example` guidance, and prevent secrets committing via `.gitignore`. |
| **SEC-09** | Unredacted Secrets in Error Logging | Medium | `services/facebook.js:140`, `services/ai.js`<br>`console.error(err)` | Raw network error objects or responses containing headers/tokens may leak into server logs. | Implement `utils/logger.js` with regex-based credential redactor for tokens, authorization headers, and API keys. |
| **SEC-10** | SSE Secret Leakage on Settings Broadcast | Critical | `routes/settings.routes.js:23`<br>`sseService.broadcast('settings_updated', { settings })` | Emits unredacted settings payload containing API keys to all open SSE connections. | Serialize and redact settings objects before emitting SSE event payloads. |
| **SEC-11** | Error Handler Stack Trace Leakage | Low | `middleware/errorHandler.js:10-18`<br>Returns internal error message and stack | Leaks internal directory paths and implementation details to clients. | Sanitize error handler responses, suppress internal stack traces from client responses, and log safely server-side. |
| **CONT-12** | Bengali Encoding Corruption (Mojibake) | High | `services/ai.js:49-140`<br>`à¦®à¦¹à¦¾à¦•à¦¾à¦¶`, `ðŸ’Ž`, `DÃ©jÃ vu` | Hardcoded Bengali fallback posts contain corrupted multi-byte characters that post garbage text to Facebook pages. | Repair corrupted Latin1/Windows-1252 strings back to clean UTF-8 Bengali text; add `scripts/check-encoding.js`. |
| **CONT-13** | Duplicate Object Keys in Fallback Config | Medium | `services/ai.js:152-163`<br>Repeated `line2_white`, `line2_yellow`, `search_term` | Causes silent property overwrites, unexpected runtime behavior, and linter errors. | Clean up fallback object definitions and enforce ESLint `no-dupe-keys`. |
| **CONT-14** | Duplicate Function Declarations | Medium | `services/ai.js:222` and `services/ai.js:1442`<br>`function escapeXml(...)` | Re-declares `escapeXml` twice in the same module scope. | Remove redundant declaration and export a single shared utility function. |
| **CONT-15** | Category-Agnostic Fallback Selection | Medium | `services/scheduler.js:80-92`<br>Picks science/history post randomly | Causes irrelevant posts (e.g. quantum physics on a food/cooking page), damaging brand reputation. | Align fallback selection with the target page's configured niche/category; halt publish if category mismatch occurs. |
| **CONT-16** | Unverified News Autopilot Publishing | High | `services/scheduler.js`, `services/ai.js`<br>Auto-picks `trending_news` without sources | Risk of generating and publishing hallucinated news, defamation, or fake rumours automatically. | Require verified sources (`sources: [{ url, title, publisher }]`) for news/announcement categories; flag unverified items as `review_required`. |
| **CONT-17** | Silent Generic Fallback Autopublishing | High | `services/scheduler.js:90-110`<br>Auto-falls back to static posts on AI error | If Gemini is down or invalid, autopilot blindly publishes static fallbacks without alert or human approval. | Prevent automatic publication of emergency fallbacks when in AutoPilot mode; queue for manual review instead. |
| **CONT-18** | Weak Duplicate Post Detection | Medium | `services/ai.js:284`<br>Compares only `post.text.slice(0, 45)` | Rephrased posts, minor edits, or identical topics with different opening lines bypass duplicate detection. | Upgrade duplicate check to normalize whitespace, punctuation, lower-case tokens, and compare similarity or key topic tokens. |
| **CONT-19** | Missing Pre-Publish Safety Guard | High | Direct flow from AI generation to `facebookService.publishPost` | No verification of text length limits, forbidden content, banned terms, or missing metadata prior to publishing. | Introduce `services/content-safety.js` pre-publish guard checking 15 content rules before queueing or publishing. |
| **CONT-20** | AI Imagery for Real-Person News | Medium | `services/ai.js:1120-1150`<br>Generates AI art for breaking news | Generates synthetic imagery of real people or sensitive breaking events, violating Meta policies on misleading media. | Content safety guard blocks AI image generation for breaking news / real persons, requiring official photo URLs or text-only posts. |

---

## Remediation Roadmap

The remediation for these 20 findings is structured across 8 atomic phases:
1. **Redaction & Serializer:** `utils/public-serializer.js` protecting REST endpoints and SSE broadcasts.
2. **Settings Validation & Route Authentication:** `middleware/auth.js` and `middleware/settings-validator.js`.
3. **HTTP Hardening & Safe Logging:** `helmet`, rate limiting, CORS configuration, explicit body limits, and `utils/logger.js`.
4. **Encoding & Code Quality:** Fix mojibake in `services/ai.js`, deduplicate keys/functions, add `scripts/check-encoding.js` and ESLint configuration.
5. **Content Safety Guard:** `services/content-safety.js` implementing all 15 validation rules and source schema validation.
6. **Scheduler Fallback Hardening:** Safe fallback routing, halting unsafe autopilot posts, and preventing race conditions.
7. **Automated Verification:** Comprehensive test suite in `tests/` validating all security and content safety requirements.
8. **Documentation & Operational Runbook:** Configuration guides, security principles, and environment examples.
