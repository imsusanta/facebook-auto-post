# Content Safety Architecture & Publishing Guardrails

**Document Version:** 1.0.0  
**Phase Completed:** Phase 2 (Critical Safety Fixes)  
**Branch:** `fix/security-and-content-safety`

---

## 1. Overview & Objective

The Facebook Automation Platform publishes automated and semi-automated content to public Facebook Pages. In Phase 2, a comprehensive pre-publish safety engine was introduced to eliminate:
1. **Corrupted Content:** Mojibake, encoding damage, or broken Unicode strings appearing on public feeds.
2. **Unsafe Fallback Autopublishing:** Emergency or static fallback posts silently going live when AI generation fails.
3. **Repetitive & Low-Quality Content:** Spammy emoji density, hashtag flooding, and semantic duplicate posts.
4. **Misinformation & Unverified Claims:** Trending news published without verified, reliable source citations.
5. **AI Image Risks:** Real-person photorealistic generation violating Meta policies or personal privacy.

All publishing routes (`routes/facebook.routes.js`) and queue execution loops (`routes/queue.routes.js`, `services/scheduler.js`) mandate validation through `services/content-safety.js` prior to any Facebook Graph API post call.

---

## 2. The 15 Pre-Publish Safety Checks

`validateContent(postData, options)` executes a pipeline of 15 hermetic checks:

| # | Check Name | Rule & Threshold | Failure Action |
|---|------------|------------------|----------------|
| **1** | **Fail-Closed Payload** | Verifies `postData` is an object and `message` is non-empty string. | Rejects with `INVALID_PAYLOAD` |
| **2** | **Length Bounds** | Message length must be between 10 and 50,000 characters. | Rejects with `LENGTH_OUT_OF_BOUNDS` |
| **3** | **Mojibake Detection** | Scans for UTF-8 bytes misinterpreted as Latin-1 (`\u00E0[\u00A6\u00A7]`, `\u00C3...`, `Ã`, etc.). | Rejects with `ENCODING_CORRUPTED` |
| **4** | **Topic Verification** | Topic must be non-empty and not a generic placeholder (`"test"`, `"undefined"`). | Flags warning / blocks autopilot |
| **5** | **Emoji Density** | Flags messages with >30 emojis or where emoji count exceeds 15% of character length. | Rejects / requires review |
| **6** | **Hashtag Density** | Flags messages with >15 hashtags to prevent Facebook spam classification. | Rejects / requires review |
| **7** | **Bengali Script Integrity** | When target language is Bengali (`bn`), ensures Bengali characters (`\u0980-\u09FF`) exceed minimum threshold (>=10 chars). | Flags `SCRIPT_MISMATCH` |
| **8** | **Source URL Validation** | All provided source URLs must use `http:` or `https:`, cannot be local IP/localhost, and must parse correctly. | Flags `INVALID_SOURCE_URL` |
| **9** | **Duplicate Detection** | Computes Jaccard token similarity against recent posts in history; similarity score >= 0.65 is flagged. | Flags `DUPLICATE_CONTENT` |
| **10** | **Real-Person AI Image Guard** | Checks image prompts against known political figures, living celebrities, and explicit names to prevent AI impersonation. | Rejects image / holds post |
| **11** | **Category Alignment** | Ensures post tags align with configured page niche categories. | Flags `CATEGORY_MISMATCH` |
| **12** | **Banned Keywords & Safety** | Checks content against harmful content rules (violence, explicit scams, hate speech). | Rejects with `SAFETY_POLICY_VIOLATION` |
| **13** | **Unverified Claims (News)** | For `trending_news` category, enforces presence of at least one verified source object. | Flags `UNVERIFIED_NEWS_CLAIM` |
| **14** | **Link Safety** | Rejects bare IP addresses, known suspicious TLDs, or unsafe URL shorteners in post body. | Flags `SUSPICIOUS_LINK` |
| **15** | **Image File Integrity** | When `imagePath` is provided, verifies local file exists and is a readable, non-empty image file. | Rejects with `IMAGE_FILE_NOT_FOUND` |

---

## 3. Source Verification Schema

For factual, historical, or news posts, the content safety engine expects a structured source definition:

```json
{
  "sources": [
    {
      "url": "https://www.prothomalo.com/bangladesh/example-news",
      "title": "Verified Headline",
      "publisher": "Prothom Alo",
      "publishedAt": "2026-09-04T08:00:00Z",
      "isOfficial": true
    }
  ]
}
```

### Verification Rules
- **Autopilot Exclusion:** If category is `trending_news` and `sources` is empty or unverified, AutoPilot will **never** publish directly. It changes the status to `review_required`.
- **Public Domain Fallback:** Non-news educational categories (e.g. historical facts, science trivia) may pass with standard attribution if no real-time claims are made.

---

## 4. AutoPilot Fail-Closed Policy

In `services/scheduler.js`, automated unattended posting follows a strict safety-first state machine:

```
[Scheduler Trigger]
        │
        ▼
[Generate Post via AI]
        │
        ├── AI API Fails ───────────────► [Tag isFallback: true]
        │                                         │
        ▼                                         ▼
[Content Safety Validation]               [Hold in Queue]
        │                                 (Status: review_required)
        ├── Safety Checks Failed ───────► (DO NOT PUBLISH)
        │
        ├── Safety Checks Pass
        │
        ▼
[Publish to Facebook API]
```

### Safety Rules in AutoPilot:
1. **Emergency Fallbacks:** Static fallback templates tagged with `isFallback: true` are prohibited from automatic publishing. They are placed in the queue with status `review_required`.
2. **Double-Processing Guard:** Queued items undergo atomic status updates (`status = 'processing'`) with timestamp locks to prevent duplicate concurrent publishing.
3. **Human In The Loop:** Any post with warnings or errors requires manual admin review in the dashboard before publishing.

---

## 5. Duplicate Detection Algorithm

The duplicate detection engine in `services/content-safety.js`:
1. **Tokenization:** Normalizes text (lowercases, removes punctuation, strips URLs, and filters common Bengali/English stopwords).
2. **N-Gram / Token Set:** Generates unique word tokens for the candidate post and each post in the 30-day history.
3. **Jaccard Similarity:**
   $$\text{Similarity}(A, B) = \frac{|A \cap B|}{|A \cup B|}$$
4. **Threshold:** If $\text{Similarity}(A, B) \ge 0.65$, the candidate post is flagged as a duplicate.

---

## 6. Real-Person AI Image Restrictions

Under Meta platform policies and ethical standards:
- Generating photorealistic synthetic media depicting real, living persons (politicians, journalists, public figures) without disclosure or consent is strictly blocked.
- When an image prompt matches flagged person entities, the system:
  1. Aborts AI image generation.
  2. Falls back to text-only post or verified generic background card templates.
  3. Records a safety notice in the queue log.

---

## 7. Testing & Verification

The content safety system is covered by automated unit tests in `tests/runner.js`:
- Tests 9-19: Mojibake detection, script integrity, length bounds, emoji/hashtag limits, Jaccard duplicate detection, source validation, image existence checks, and fail-closed fallback holds.
- Run tests at any time with:
  ```bash
  npm test
  ```
