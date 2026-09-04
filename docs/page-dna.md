# Page DNA Architecture & REST API Specification

## 1. Overview

**Page DNA** is a structured, per-page configuration framework that defines each connected Facebook Page's distinct niche, brand identity, audience demographics, editorial tone, content pillar weights, content-mix distribution, safety constraints, and publishing approval policies.

Rather than treating all connected Facebook pages as identical broadcast targets, Page DNA enables each page to maintain:
- Unique audience targeting and localized geographical focus
- Tailored content pillars (e.g., job updates vs. exam tips vs. motivation)
- Dynamic content-mix balancing (e.g., 50% educational, 20% authority, 15% community, 10% timely, 5% promotional)
- Dedicated safety boundaries (prohibited topics, blocked claims, source citation requirements)
- Granular publishing governance (`manual`, `low_risk_auto`, or `trusted_categories_auto`)

---

## 2. Onboarding Lifecycle

Every connected page exists in one of three onboarding states:

```
                  ┌──────────────────────┐
                  │     not_started      │
                  └──────────┬───────────┘
                             │
            [Niche configured, but missing]
            [tone / 3+ pillars / audience ]
                             │
                             ▼
                  ┌──────────────────────┐
                  │      incomplete      │
                  └──────────┬───────────┘
                             │
            [Niche + Tone + 3+ Pillars +]
            [Audience demographics set  ]
                             │
                             ▼
                  ┌──────────────────────┐
                  │       complete       │
                  └──────────────────────┘
```

1. **`not_started`**: Default state for legacy or newly connected pages. Content profile exists with default parameters, but niche is empty or generic. AutoPilot defaults to manual review unless configured.
2. **`incomplete`**: Operator has initiated setup by specifying a primary niche or title, but has not completed tone selection, at least 3 content pillars, or target audience demographics.
3. **`complete`**: All essential identity attributes (niche, tone, at least 3 weighted pillars, audience demographics) are populated and validated. Page is fully eligible for niche-aware auto-generation.

---

## 3. Data Schema & Bounds

A Page DNA profile is defined as a JSON object adhering to the following schema:

```json
{
  "schemaVersion": 1,
  "niche": "West Bengal Govt Exam Prep",
  "nicheDescription": "Daily verified updates, previous year questions, and study notes for WBCS and WBPSC aspirants.",
  "primaryGoal": "education",
  "secondaryGoals": ["community", "authority"],
  "language": "bn",
  "languageStyle": "Standard Sadhu/Cholit blend, formal yet accessible Bengali",
  "tone": ["helpful", "authoritative", "encouraging"],
  "audience": {
    "locations": ["West Bengal", "Kolkata", "Howrah", "Siliguri"],
    "ageRange": "18-35",
    "professions": ["Aspirants", "College Students", "Graduates"],
    "interests": ["Government Jobs", "General Knowledge", "WBCS"],
    "knowledgeLevel": "intermediate"
  },
  "contentPillars": [
    {
      "id": "pillar_wbcs_gk",
      "title": "WBCS Prelims GK & Current Affairs",
      "weight": 40,
      "description": "Daily facts and questions aligned with recent PSC exam patterns.",
      "targetAudienceSegment": "Serious civil service aspirants"
    },
    {
      "id": "pillar_job_alerts",
      "title": "Official Notification Breakdown",
      "weight": 35,
      "description": "Verified breakdown of eligibility, dates, and syllabus from official gazettes.",
      "targetAudienceSegment": "All job seekers"
    },
    {
      "id": "pillar_strategy_tips",
      "title": "Exam Strategy & Time Management",
      "weight": 25,
      "description": "Practical revision timetables and subject-wise score boosters.",
      "targetAudienceSegment": "Beginners and repeat candidates"
    }
  ],
  "productsOrServices": [],
  "allowedTopics": ["wbcs", "psc", "clerkship", "general knowledge", "math tricks"],
  "blockedTopics": ["astrology", "betting", "casino", "party politics", "communal issues"],
  "blockedClaims": ["100% selection guaranteed", "১০০% চাকরি নিশ্চিত", "প্রশ্ন ফাঁস"],
  "preferredFormats": ["infographic_card", "detailed_caption", "bulleted_tips"],
  "ctaStyle": "save_share",
  "hashtagStyle": "focused",
  "hashtagLimit": 5,
  "emojiLimit": 3,
  "preferredCaptionLength": {
    "min": 400,
    "max": 1800
  },
  "timezone": "Asia/Kolkata",
  "maxPostsPerDay": 3,
  "minimumPostGapMinutes": 180,
  "promotionalPostLimitPercent": 10,
  "contentMix": {
    "educational": 50,
    "authority": 20,
    "community": 15,
    "timely": 10,
    "promotional": 5
  },
  "sourcePolicy": {
    "requireSourcesForNews": true,
    "requireOfficialSourceForAnnouncements": true,
    "minimumSourcesForHighRiskClaims": 2
  },
  "approvalMode": "manual",
  "learnedPreferences": [
    "Prefers bulleted fact format for exam syllabi",
    "Keep math formulas in LaTeX or plain ASCII notation"
  ]
}
```

### Field Constraints & Validation Rules

| Field | Type | Range / Options | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `schemaVersion` | Integer | `1` | `1` | Schema format version for forward compatibility. |
| `niche` | String | Max 100 chars | Page category or `""` | Primary subject vertical of the page. |
| `nicheDescription` | String | Max 500 chars | `""` | Qualitative narrative describing page purpose. |
| `primaryGoal` | Enum | `education`, `authority`, `community`, `entertainment`, `lead_generation`, `brand_awareness` | `education` | Strategic objective driving prompt weights. |
| `secondaryGoals` | Array<Enum> | Max 3 distinct goals | `[]` | Secondary goals complementing primary goal. |
| `language` | Enum | `bn`, `en`, `bn_en` | `bn` | Primary publishing language. |
| `tone` | Array<Enum> | 1 to 5 items: `helpful`, `authoritative`, `encouraging`, `conversational`, `witty`, `inspiring`, `analytical`, `empathetic`, `formal`, `urgent` | `["helpful"]` | Editorial persona attributes. |
| `audience.locations` | Array<String> | Max 10 items (max 60 chars each) | `["West Bengal"]` | Regional focus. |
| `audience.knowledgeLevel` | Enum | `beginner`, `intermediate`, `advanced`, `mixed` | `mixed` | Content complexity calibration. |
| `contentPillars` | Array<Object> | 1 to 8 pillars (each with unique title, unique ID, integer weight 1-100, **weights sum strictly to 100**) | 3 default pillars | Content pillars rotated during generation. Duplicate titles or IDs rejected. |
| `blockedTopics` | Array<String> | Max 50 items (max 80 chars each) | `[]` | Topics strictly banned by safety policy. |
| `blockedClaims` | Array<String> | Max 50 items (max 120 chars each) | `[]` | Exact claim phrases forbidden from being asserted. |
| `hashtagLimit` | Integer | 0 to 15 | `5` | Maximum number of hashtags generated. |
| `emojiLimit` | Integer | 0 to 10 | `3` | Maximum number of emojis allowed in caption. |
| `preferredCaptionLength` | Object | `min`: 100-3000, `max`: 150-6000 (`min <= max`) | `{ min: 300, max: 2000 }` | Character budget for post captions. |
| `maxPostsPerDay` | Integer | 1 to 20 | `3` | Daily post limit enforced by scheduler. |
| `minimumPostGapMinutes` | Integer | 15 to 1440 | `180` | Cooldown period between auto-published posts. |
| `contentMix` | Object | 5 categories, values 0-100, **sum strictly 100**, promotional <= `promotionalPostLimitPercent` | `{ educational: 50, community: 20, authority: 15, timely: 10, promotional: 5 }` | Target volume distribution across post types. |
| `approvalMode` | Enum | `manual`, `low_risk_auto`, `trusted_categories_auto` | `manual` | Governance policy for unattended AutoPilot. All built-in presets default to `manual`. |

---

## 4. REST API Specification

All Page DNA endpoints require session authentication (signed HttpOnly `auth_session` cookie), anti-CSRF verification (`X-CSRF-Token` header for mutation requests), and rate limiting.

### 4.1. Get Content Profile
- **Method:** `GET`
- **Path:** `/api/facebook/pages/:id/content-profile`
- **Headers:** `Cookie: auth_session=...`
- **Response `200 OK`:**
```json
{
  "success": true,
  "pageId": "10982348572394",
  "pageName": "WB Exam Prep",
  "onboardingStatus": "complete",
  "contentProfile": { ... }
}
```
- **Error Codes:**
  - `401 Unauthorized`: Session missing or expired.
  - `404 Not Found`: Page ID not connected to this account.

---

### 4.2. Update Content Profile (Complete Replacement)
- **Method:** `PUT`
- **Path:** `/api/facebook/pages/:id/content-profile`
- **Headers:**
  - `Cookie: auth_session=...`
  - `X-CSRF-Token: <csrf_token>`
  - `Content-Type: application/json`
- **Body:** Complete content profile object adhering to schemaVersion 1 (`requireFullProfile: true`). Partial profile updates are rejected.
- **Response `200 OK`:**
```json
{
  "success": true,
  "pageId": "10982348572394",
  "onboardingStatus": "complete",
  "contentProfile": { ... }
}
```
- **Response `400 Bad Request` (Validation Failure or Partial Profile):**
```json
{
  "success": false,
  "error": "Invalid content profile data.",
  "code": "INVALID_CONTENT_PROFILE",
  "errors": [
    {
      "field": "contentPillars",
      "code": "PILLAR_WEIGHTS_SUM_NOT_100",
      "message": "Content pillar weights must sum to exactly 100 (current sum: 110)."
    }
  ]
}
```
- **Error Codes:**
  - `400 Bad Request`: Validation failure or incomplete profile payload (`code: 'INVALID_CONTENT_PROFILE'`).
  - `401 Unauthorized`: Missing authentication.
  - `403 Forbidden`: Missing or mismatched CSRF token.
  - `404 Not Found`: Page does not exist.
  - `429 Too Many Requests`: Rate limit exceeded (`profileLimiter`: max 30 updates / 15 min).

---

### 4.3. Validate Content Profile (Dry-Run)
- **Method:** `POST`
- **Path:** `/api/facebook/pages/:id/content-profile/validate`
- **Headers:**
  - `Cookie: connect.sid=...`
  - `Content-Type: application/json`
- **Body:** Candidate content profile object.
- **Description:** Performs complete structural validation without saving to disk or altering page state.
- **Response `200 OK`:**
```json
{
  "success": true,
  "valid": true,
  "errors": [],
  "warnings": [],
  "onboardingStatus": "complete"
}
```

---

### 4.4. Reset Content Profile to Defaults
- **Method:** `POST`
- **Path:** `/api/facebook/pages/:id/content-profile/reset`
- **Headers:**
  - `Cookie: connect.sid=...`
  - `X-CSRF-Token: <csrf_token>`
  - `Content-Type: application/json`
- **Body:** `{ "confirm": true }`
- **Description:** Replaces custom configuration with default baseline, seeding the niche from the page's category, and resets onboarding status to `not_started`.
- **Response `200 OK`:**
```json
{
  "success": true,
  "pageId": "10982348572394",
  "onboardingStatus": "not_started",
  "contentProfile": { ... }
}
```
- **Error Codes:**
  - `400 Bad Request`: Missing `{ "confirm": true }` confirmation flag.
  - `401 Unauthorized`: Session missing or expired.
  - `403 Forbidden`: CSRF token invalid.

---

## 5. Security & Isolation Controls

1. **Strict Secret Scrubbing**: All serializers (`buildPublicContentProfile`, `serializePage`, `serializePages`) strip sensitive keys (`accessToken`, `pageAccessToken`, `encrypted_access_token`, `systemPrompt`, `passwordHash`, `salt`).
2. **Prototype Pollution Protection**: Fields like `__proto__`, `constructor`, and `prototype` are stripped and rejected with `PROHIBITED_KEY`.
3. **Strict Whitelist Normalization**: Any unapproved object fields are rejected during validation and dropped during normalization.
4. **Control Character Sanitization**: User-supplied text strings are sanitized to eliminate non-printable ASCII control characters (`\x00` - `\x1F` except standard newlines).
5. **Rate Limiting**: Mutations and reset requests are throttled via an isolated in-memory sliding window rate limiter (`profileLimiter`).
6. **Source Verification & Factual Truth Boundaries**: Source policy controls require verifiable links for official announcements. URL reachability does not prove factual truth or accuracy; content safety rules hold automated publishing to manual operator review whenever unverified or high-risk claims are detected.
