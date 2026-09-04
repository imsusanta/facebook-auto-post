# Page DNA Prompt Hierarchy & Niche-Aware Generation Guide

## 1. Strict Prompt Hierarchy

To prevent prompt injection, untrusted override of safety constraints, or tone degradation, Page DNA enforces a **strict 7-tier prompt hierarchy** during content synthesis in `services/ai/page-context.js`:

```
┌─────────────────────────────────────────────────────────────┐
│ Level 1: System Safety & Content Policy (Priority 1)        │
├─────────────────────────────────────────────────────────────┤
│ Level 2: Verified Ground Truth Fact Pack (Priority 2)       │
├─────────────────────────────────────────────────────────────┤
│ Level 3: Output Contract & JSON Schema (Priority 3)         │
├─────────────────────────────────────────────────────────────┤
│ Level 4: Page DNA & Brand Persona (Priority 4)              │
├─────────────────────────────────────────────────────────────┤
│ Level 5: Selected Strategy & Content Mix (Priority 5)       │
├─────────────────────────────────────────────────────────────┤
│ Level 6: Anti-AI Slop & Human Bengali Style (Priority 6)    │
├─────────────────────────────────────────────────────────────┤
│ Level 7: Operator Guidance (Untrusted Input) (Priority 7)   │
└─────────────────────────────────────────────────────────────┘
```

### Hierarchy Rules & Character Budgets

1. **Hierarchy Level 1: System Safety (Priority 1)**
   - Hard-coded non-negotiable safety rules: zero tolerance for hate speech, harassment, violence, defamation, or unsubstantiated outcome claims.
   - Injects page-specific `blockedTopics` and `blockedClaims`.
   - **Precedence Rule:** Cannot be relaxed or overridden by any subsequent section or operator prompt.

2. **Hierarchy Level 2: Ground Truth Fact Pack (Priority 2)**
   - Pre-verified facts, dates, and official source links provided by operators or verified RSS/news feeds.
   - Enforces grounding: the LLM must construct factual statements strictly from these verified data points.

3. **Hierarchy Level 3: Output Contract & Schema (Priority 3)**
   - Enforces strict JSON schema output: `badge`, `line1_red`, `line1_white`, `line2_white`, `line2_yellow`, `search_term`, and `post_caption`.
   - Explicitly instructs: no markdown code blocks, no backticks, no external conversational chatter.

4. **Hierarchy Level 4: Page DNA & Brand Persona (Priority 4)**
   - Niche definition, page objective, target audience demographic, tone attributes, language style, and formatting caps (`emojiLimit`, `hashtagLimit`, `preferredCaptionLength`).

5. **Hierarchy Level 5: Content Strategy & Content Mix (Priority 5)**
   - Selected content pillar for this post (rotated based on historical volume) and content mix classification (`educational`, `community`, `authority`, `timely`, `promotional`).

6. **Hierarchy Level 6: Anti-AI Slop & Natural Human Voice (Priority 6)**
   - Concrete linguistic constraints enforcing natural, human-written Bengali and banning common machine-generated clichés.

7. **Hierarchy Level 7: Untrusted Operator Guidance (Priority 7)**
   - Custom prompts entered by page managers in the dashboard.
   - **Enforced Budget:** Capped strictly at **800 characters**.
   - **Sanitization:** Strips control characters and tags. Wrapped in `<operator-preferences>` tags with explicit directives that safety and schema take precedence.
   - **Total System Context Budget:** Capped strictly at **8,000 characters** to prevent context exhaustion.

---

## 2. Anti-AI Slop Bengali Guidelines

AI-generated Bengali text often suffers from repetitive structural habits, excessive exclamation marks, dramatic filler words, and canned engagement bait. Level 6 explicitly prohibits these patterns:

| Prohibited AI Pattern | Example Slop | Required Human Style |
| :--- | :--- | :--- |
| **Throat-Clearing Openers** | *"চলুন জেনে নিই...", "আজকে আমরা কথা বলব...", "জানুন কিছু অজানা তথ্য:"* | Open immediately with the core event, fact, or compelling hook. |
| **Puffery Clichés** | *"মুকুটে জুড়ল আরও একটি পালক", "এক যুগান্তকারী মোড়", "ইতিহাসের এক অবিস্মরণীয় অধ্যায়"* | Let concrete details carry the importance without exaggerated adverbs. |
| **Formatting Overload** | Bold headers on every line, emojis on every bullet point. | Clean prose paragraphs with minimal, tasteful bullet points. |
| **Rhetorical Drama** | *"🤔 হ্যাঁ, ঠিকই শুনেছেন! আমরা কথা বলছি ... নিয়ে!"* | Direct, informative, and natural conversational cadence. |
| **Canned Engagement Bait** | *"আপনার কী মনে হয়? নিচে কমেন্টে জানান! 👇", "কমেন্টে আপনার শুভকামনা জানান!"* | End with an insightful conclusion, thoughtful question, or clean call to action. |

---

## 3. Four Complete Example Page DNA Profiles

### 3.1. Government Exam Preparation (`West Bengal Govt Exam Prep`)
- **Niche**: `West Bengal Govt Job Prep & Exam Syllabus`
- **Objective**: `education` (authority)
- **Tone**: `helpful`, `authoritative`, `encouraging`
- **Audience**: 18-32 year old job seekers in West Bengal, preparing for WBCS, PSC Clerkship, and Police SI.
- **Pillars**:
  1. *WBCS & PSC Previous Years Questions Analysis* (Weight: 40%)
  2. *Official Recruitment Notification & Eligibility Breakdown* (Weight: 35%)
  3. *Subject Revision Strategies & Study Routines* (Weight: 25%)
- **Blocked Claims**: `["100% selection guaranteed", "১০০% চাকরি নিশ্চিত", "প্রশ্ন ফাঁস", "গোপন শর্টকাট"]`
- **Blocked Topics**: `["political protests", "party controversies", "unofficial exam rumors"]`
- **Limits**: Emojis: 2 | Hashtags: 4 | Caption Length: 400 - 1500 chars

```json
{
  "niche": "West Bengal Govt Job Prep & Exam Syllabus",
  "primaryGoal": "education",
  "language": "bn",
  "languageStyle": "Standard informative Bengali with official English terminology",
  "tone": ["helpful", "authoritative", "encouraging"],
  "audience": {
    "locations": ["West Bengal", "Kolkata", "Howrah", "North 24 Parganas"],
    "professions": ["Aspirants", "College Students", "Graduates"],
    "knowledgeLevel": "intermediate"
  },
  "contentPillars": [
    { "title": "WBCS & PSC PYQ Analysis", "weight": 40 },
    { "title": "Official Notification Breakdown", "weight": 35 },
    { "title": "Subject Revision Strategies", "weight": 25 }
  ],
  "contentMix": { "educational": 55, "authority": 20, "timely": 15, "community": 10, "promotional": 0 },
  "blockedClaims": ["100% selection guaranteed", "১০০% চাকরি নিশ্চিত", "প্রশ্ন ফাঁস"],
  "emojiLimit": 2,
  "hashtagLimit": 4,
  "approvalMode": "manual"
}
```

---

### 3.2. Traditional Bengali Recipes & Culinary Arts (`Sholoana Bangaliana`)
- **Niche**: `Authentic Bengali Culinary Arts & Heritage Recipes`
- **Objective**: `community` (entertainment)
- **Tone**: `conversational`, `empathetic`, `witty`
- **Audience**: Bengali food lovers, homemakers, and diaspora in West Bengal, Tripura, and Bangladesh.
- **Pillars**:
  1. *Lost Heritage Recipes of Rarh & East Bengal* (Weight: 45%)
  2. *Kitchen Hacks & Spice Blending Techniques* (Weight: 30%)
  3. *Weekend Festive Menus & Sweet Making* (Weight: 25%)
- **Blocked Topics**: `["diet pills", "artificial chemical flavoring", "fad starvation diets"]`
- **Limits**: Emojis: 4 | Hashtags: 5 | Caption Length: 300 - 1200 chars

```json
{
  "niche": "Authentic Bengali Culinary Arts & Heritage Recipes",
  "primaryGoal": "community",
  "language": "bn",
  "languageStyle": "Warm, homely Cholit Bengali with colloquial culinary terms",
  "tone": ["conversational", "empathetic", "witty"],
  "audience": {
    "locations": ["Kolkata", "West Bengal", "Dhaka", "Global Bengali Diaspora"],
    "interests": ["Bengali Cuisine", "Traditional Cooking", "Sweets & Desserts"],
    "knowledgeLevel": "mixed"
  },
  "contentPillars": [
    { "title": "Lost Heritage Recipes", "weight": 45 },
    { "title": "Kitchen Hacks & Spices", "weight": 30 },
    { "title": "Festive Menus & Sweets", "weight": 25 }
  ],
  "contentMix": { "educational": 40, "community": 35, "authority": 15, "timely": 5, "promotional": 5 },
  "emojiLimit": 4,
  "hashtagLimit": 5,
  "approvalMode": "low_risk_auto"
}
```

---

### 3.3. Handloom Sarees & Kolkata Boutique (`Tant & Jamdani Boutique`)
- **Niche**: `Bengal Handloom Sarees & Sustainable Ethnic Fashion`
- **Objective**: `lead_generation` (brand awareness)
- **Tone**: `inspiring`, `formal`, `conversational`
- **Audience**: Women aged 22-55 interested in authentic Dhaniakhali, Bishnupuri Silk, Jamdani, and handloom styling.
- **Pillars**:
  1. *Weaving Heritage & Artisan Stories* (Weight: 40%)
  2. *Occasion Styling & Drape Ideas* (Weight: 35%)
  3. *New Collection Showcase & Direct Inquiries* (Weight: 25%)
- **Blocked Claims**: `["100% discount", "ফ্রি গিফট অফার", "আনলিমিটেড স্টক"]`
- **Limits**: Emojis: 3 | Hashtags: 6 | Caption Length: 250 - 1000 chars

```json
{
  "niche": "Bengal Handloom Sarees & Sustainable Ethnic Fashion",
  "primaryGoal": "lead_generation",
  "language": "bn",
  "languageStyle": "Elegant, respectful, and aesthetically pleasing Bengali",
  "tone": ["inspiring", "formal", "conversational"],
  "audience": {
    "locations": ["Kolkata", "Howrah", "Siliguri", "Bengaluru", "Mumbai"],
    "interests": ["Handloom Sarees", "Silk Mark", "Sustainable Weaving"],
    "knowledgeLevel": "intermediate"
  },
  "contentPillars": [
    { "title": "Weaving Heritage & Artisans", "weight": 40 },
    { "title": "Occasion Saree Styling", "weight": 35 },
    { "title": "New Collection Showcase", "weight": 25 }
  ],
  "contentMix": { "educational": 35, "authority": 25, "community": 20, "promotional": 15, "timely": 5 },
  "promotionalPostLimitPercent": 20,
  "emojiLimit": 3,
  "hashtagLimit": 6,
  "approvalMode": "manual"
}
```

---

### 3.4. Verified Current Affairs & Science GK (`Bijnan O Sampratik`)
- **Niche**: `Fact-Checked Regional & National Current Affairs`
- **Objective**: `authority` (education)
- **Tone**: `analytical`, `credible`, `authoritative`
- **Audience**: Academics, students, and citizens looking for unbiased, sourced news analysis.
- **Pillars**:
  1. *Space, Astronomy & Scientific Discoveries* (Weight: 40%)
  2. *National & State Policy Analysis* (Weight: 35%)
  3. *Global Geography & Environmental Developments* (Weight: 25%)
- **Source Policy**: Strictly requires verified public sources before auto-publishing.
- **Blocked Topics**: `["sensational rumors", "celebrity gossip", "unverified leaks"]`
- **Limits**: Emojis: 1 | Hashtags: 3 | Caption Length: 500 - 2000 chars

```json
{
  "niche": "Fact-Checked Regional & National Current Affairs",
  "primaryGoal": "authority",
  "language": "bn",
  "languageStyle": "Formal, objective, journalistic Bengali",
  "tone": ["analytical", "authoritative", "credible"],
  "audience": {
    "locations": ["West Bengal", "India", "Bangladesh"],
    "professions": ["Teachers", "Students", "Researchers", "Professionals"],
    "knowledgeLevel": "advanced"
  },
  "contentPillars": [
    { "title": "Science & Space Discoveries", "weight": 40 },
    { "title": "State & National Policy Analysis", "weight": 35 },
    { "title": "Geography & Climate Facts", "weight": 25 }
  ],
  "contentMix": { "educational": 50, "authority": 30, "timely": 15, "community": 5, "promotional": 0 },
  "sourcePolicy": {
    "requireSourcesForNews": true,
    "requireOfficialSourceForAnnouncements": true,
    "minimumSourcesForHighRiskClaims": 2
  },
  "emojiLimit": 1,
  "hashtagLimit": 3,
  "approvalMode": "trusted_categories_auto"
}
```
