/**
 * Page DNA Data Model, Validation, Normalization & Migration Service
 *
 * Implements Phase 3 Page DNA: converts structured operator answers about niche,
 * audience, tone, content pillars, safety limits, and approval policies into a
 * normalized, validated contentProfile object.
 */

const ALLOWED_PRIMARY_GOALS = new Set([
  'education', 'authority', 'community', 'entertainment',
  'lead_generation', 'leads', 'brand_awareness', 'reach',
  'engagement', 'sales'
]);
const ALLOWED_LANGUAGES = new Set(['bn', 'en', 'bn_en']);
const ALLOWED_TONES = new Set([
  'helpful', 'credible', 'friendly', 'formal', 'inspiring',
  'humorous', 'analytical', 'conversational', 'empathetic', 'authoritative',
  'encouraging', 'witty', 'urgent'
]);
const ALLOWED_KNOWLEDGE_LEVELS = new Set(['beginner', 'intermediate', 'advanced', 'general', 'mixed']);
const ALLOWED_FORMATS = new Set(['infographic', 'minimal', 'news_strip', 'quote', 'story', 'tips', 'comparison']);
const ALLOWED_CTA_STYLES = new Set(['soft', 'strong', 'question', 'none']);
const ALLOWED_HASHTAG_STYLES = new Set(['minimal', 'moderate', 'none']);
const ALLOWED_APPROVAL_MODES = new Set(['manual', 'low_risk_auto', 'trusted_categories_auto']);

const PROHIBITED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Canonical Built-In Page DNA Presets
 * All presets default to approvalMode: 'manual' to prevent unintended autonomous publishing.
 */
const PAGE_DNA_PRESETS = Object.freeze({
  exam: Object.freeze({
    schemaVersion: 1,
    niche: 'সরকারি চাকরি প্রস্তুতি ও স্টাডি নোটস (Govt Exam Preparation)',
    nicheDescription: 'পশ্চিমবঙ্গ ও ভারতের সমস্ত প্রতিযোগিতামূলক পরীক্ষার (WBCS, SSC, Rail, Police) সাধারণ জ্ঞান, বিগত বছরের প্রশ্ন ও অধ্যায়ভিত্তিক আলোচনা।',
    primaryGoal: 'education',
    secondaryGoals: ['authority', 'community'],
    language: 'bn',
    languageStyle: 'সহজ ও প্রাঞ্জল চলিত বাংলা',
    tone: ['helpful', 'credible', 'inspiring'],
    audience: {
      locations: ['West Bengal', 'Kolkata', 'Tripura'],
      ageRange: '18-35',
      professions: ['Students', 'Job Seekers', 'WBCS Aspirants'],
      interests: ['WBCS', 'SSC', 'General Knowledge', 'Current Affairs'],
      knowledgeLevel: 'intermediate'
    },
    contentPillars: [
      { id: 'pillar_exam_pyq', title: 'বিগত বছরের প্রশ্ন ও সমাধান (Previous Year Q&A)', description: 'বিভিন্ন পরীক্ষার গুরুত্বপূর্ণ প্রশ্ন ও সমাধান', targetAudienceSegment: 'Job Seekers', weight: 35 },
      { id: 'pillar_exam_notes', title: 'বিষয়ভিত্তিক স্টাডি নোটস (Subject Notes)', description: 'ইতিহাস, ভূগোল, সংবিধান ও বিজ্ঞানের সংক্ষিপ্ত নোটস', targetAudienceSegment: 'Students', weight: 30 },
      { id: 'pillar_exam_quiz', title: 'দৈনিক কুইজ ও সেলফ টেস্ট (Daily Quiz)', description: 'প্রতিদিনের অনুশীলন কুইজ ও সেলফ অ্যাসেসমেন্ট', targetAudienceSegment: 'Aspirants', weight: 25 },
      { id: 'pillar_exam_updates', title: 'পরীক্ষার বিজ্ঞপ্তি ও কৌশল (Exam Updates & Strategy)', description: 'সিলেবাস গাইড ও প্রস্তুতি কৌশল', targetAudienceSegment: 'All', weight: 10 }
    ],
    contentMix: { educational: 50, community: 20, authority: 15, promotional: 5, timely: 10 },
    promotionalPostLimitPercent: 10,
    sourcePolicy: {
      requireSourcesForNews: true,
      requireOfficialSourceForAnnouncements: true,
      minimumSourcesForHighRiskClaims: 2
    },
    preferredFormats: ['infographic', 'tips', 'story'],
    ctaStyle: 'question',
    hashtagStyle: 'minimal',
    hashtagLimit: 5,
    emojiLimit: 3,
    preferredCaptionLength: { min: 300, max: 1500 },
    timezone: 'Asia/Kolkata',
    maxPostsPerDay: 3,
    minimumPostGapMinutes: 180,
    approvalMode: 'manual',
    allowedTopics: ['WBCS', 'SSC', 'General Knowledge', 'Current Affairs', 'Math'],
    blockedTopics: ['gambling', 'betting', 'rumors', 'party politics'],
    blockedClaims: ['100% selection guaranteed', '১০০% চাকরি নিশ্চিত', 'প্রশ্ন ফাঁস'],
    productsOrServices: [],
    learnedPreferences: []
  }),
  food: Object.freeze({
    schemaVersion: 1,
    niche: 'বাঙালি খাবার ও রেসিপি (Bengali Cuisine & Recipes)',
    nicheDescription: 'ঐতিহ্যবাহী বাঙালি রান্না, রেস্তোরাঁর জনপ্রিয় পদ এবং সহজ ঘরোয়া রান্নার টিপস।',
    primaryGoal: 'community',
    secondaryGoals: ['entertainment', 'education'],
    language: 'bn',
    languageStyle: 'ঘরোয়া ও উষ্ণ বাংলা',
    tone: ['friendly', 'helpful', 'conversational'],
    audience: {
      locations: ['Kolkata', 'West Bengal', 'Dhaka'],
      ageRange: '20-60',
      professions: ['Home Cooks', 'Foodies'],
      interests: ['Traditional Recipes', 'Sweets', 'Kitchen Hacks'],
      knowledgeLevel: 'beginner'
    },
    contentPillars: [
      { id: 'pillar_food_trad', title: 'ঐতিহ্যবাহী বাংলা রান্না (Traditional Dishes)', description: 'মাছের পদ, মিষ্টি ও খাঁটি বাঙালি খাবারের রেসিপি', targetAudienceSegment: 'Home Cooks', weight: 35 },
      { id: 'pillar_food_quick', title: 'চটজলদি সহজ রেসিপি (Quick 15-min Recipes)', description: '১০-১৫ মিনিটে তৈরি সহজ খাবার', targetAudienceSegment: 'Working People', weight: 25 },
      { id: 'pillar_food_tips', title: 'রান্নার দরকারি টিপস (Kitchen Tips)', description: 'মসলা সংরক্ষণ ও রান্নার কৌশল', targetAudienceSegment: 'All', weight: 25 },
      { id: 'pillar_food_street', title: 'স্ট্রিট ফুড ও সুইটস এক্সপ্লোর (Street Food & Sweets)', description: 'কলকাতার স্ট্রিট ফুড ও মিষ্টির গল্প', targetAudienceSegment: 'Foodies', weight: 15 }
    ],
    contentMix: { educational: 40, community: 30, authority: 15, promotional: 5, timely: 10 },
    promotionalPostLimitPercent: 10,
    sourcePolicy: {
      requireSourcesForNews: true,
      requireOfficialSourceForAnnouncements: false,
      minimumSourcesForHighRiskClaims: 2
    },
    preferredFormats: ['infographic', 'story', 'tips'],
    ctaStyle: 'soft',
    hashtagStyle: 'moderate',
    hashtagLimit: 5,
    emojiLimit: 4,
    preferredCaptionLength: { min: 250, max: 1200 },
    timezone: 'Asia/Kolkata',
    maxPostsPerDay: 3,
    minimumPostGapMinutes: 180,
    approvalMode: 'manual',
    allowedTopics: ['Bengali Cooking', 'Recipes', 'Sweets', 'Fish Dishes', 'Kitchen Tips'],
    blockedTopics: ['diet pills', 'starvation diets', 'chemical food coloring'],
    blockedClaims: ['miracle weight loss', 'instant cure'],
    productsOrServices: [],
    learnedPreferences: []
  }),
  shop: Object.freeze({
    schemaVersion: 1,
    niche: 'পোশাক ও ফ্যাশন ট্রেন্ডস (Clothing & Fashion Trends)',
    nicheDescription: 'আধুনিক শাড়ি, এথনিক ওয়্যার এবং ট্রেন্ডি ফ্যাশন কালেকশন ও স্টাইলিং গাইড।',
    primaryGoal: 'sales',
    secondaryGoals: ['brand_awareness', 'community'],
    language: 'bn_en',
    languageStyle: 'স্মার্ট ও ট্রেন্ডি বাংলা-ইংরেজি মিশ্রণ',
    tone: ['friendly', 'inspiring', 'conversational'],
    audience: {
      locations: ['Kolkata', 'West Bengal', 'Bangalore'],
      ageRange: '20-50',
      professions: ['Women', 'Professionals', 'Students'],
      interests: ['Sarees', 'Ethnic Wear', 'Fashion Styling'],
      knowledgeLevel: 'general'
    },
    contentPillars: [
      { id: 'pillar_shop_new', title: 'নতুন ফ্যাশন কালেকশন (New Arrivals)', description: 'সাপ্তাহিক নতুন শাড়ি ও পোশাক শোকেস', targetAudienceSegment: 'Shoppers', weight: 35 },
      { id: 'pillar_shop_styling', title: 'স্টাইলিং টিপস ও ম্যাচিং (Styling Guides)', description: 'কোন পোশাকের সাথে কোন গয়না মানাবে', targetAudienceSegment: 'Fashion Lovers', weight: 25 },
      { id: 'pillar_shop_reviews', title: 'গ্রাহক সন্তুষ্টি ও রিভিউ (Customer Stories)', description: 'গ্রাহকদের ছবি ও রিভিউ', targetAudienceSegment: 'Potential Buyers', weight: 20 },
      { id: 'pillar_shop_offers', title: 'উৎসবের অফার ও সেল (Special Offers)', description: 'ডিসকাউন্ট ও লিমিটেড এডিশন সেল', targetAudienceSegment: 'All', weight: 20 }
    ],
    contentMix: { educational: 30, community: 25, authority: 15, promotional: 20, timely: 10 },
    promotionalPostLimitPercent: 25,
    sourcePolicy: {
      requireSourcesForNews: true,
      requireOfficialSourceForAnnouncements: false,
      minimumSourcesForHighRiskClaims: 2
    },
    preferredFormats: ['infographic', 'story', 'comparison'],
    ctaStyle: 'strong',
    hashtagStyle: 'moderate',
    hashtagLimit: 6,
    emojiLimit: 3,
    preferredCaptionLength: { min: 200, max: 1000 },
    timezone: 'Asia/Kolkata',
    maxPostsPerDay: 3,
    minimumPostGapMinutes: 180,
    approvalMode: 'manual',
    allowedTopics: ['Sarees', 'Handloom', 'Fashion Tips', 'Festive Wear'],
    blockedTopics: ['replica brands', 'counterfeit products'],
    blockedClaims: ['100% free gift', 'unlimited free delivery'],
    productsOrServices: [],
    learnedPreferences: []
  }),
  news: Object.freeze({
    schemaVersion: 1,
    niche: 'চলতি ঘটনা ও তথ্য বিশ্লেষণ (Current Affairs & Fact Analysis)',
    nicheDescription: 'জাতীয় ও আন্তর্জাতিক গুরুত্বপূর্ণ খবরের নির্ভরযোগ্য তথ্য ও সহজ ব্যাখ্যা।',
    primaryGoal: 'authority',
    secondaryGoals: ['education', 'reach'],
    language: 'bn',
    languageStyle: 'নিরপেক্ষ, প্রাঞ্জল ও বস্তুনিষ্ঠ বাংলা',
    tone: ['analytical', 'credible', 'authoritative'],
    audience: {
      locations: ['India', 'West Bengal', 'Global'],
      ageRange: '18-65',
      professions: ['Informed Citizens', 'Educators', 'Students'],
      interests: ['Current Affairs', 'Technology', 'Geopolitics'],
      knowledgeLevel: 'intermediate'
    },
    contentPillars: [
      { id: 'pillar_news_brief', title: 'দৈনিক সংবাদ সারসংক্ষেপ (Daily Brief)', description: 'দিনের প্রধান খবরগুলোর সংক্ষিপ্তসার', targetAudienceSegment: 'General Readers', weight: 35 },
      { id: 'pillar_news_analysis', title: 'ঘটনার প্রেক্ষাপট ও বিশ্লেষণ (Context & Analysis)', description: 'গুরুত্বপূর্ণ ঘটনার পেছনের কারণ ও প্রভাব', targetAudienceSegment: 'Curious Readers', weight: 30 },
      { id: 'pillar_news_factcheck', title: 'ফ্যাক্ট-চেক ও তথ্য যাচাই (Fact Check)', description: 'গুজব নিরসন ও সঠিক তথ্যের উৎস', targetAudienceSegment: 'All', weight: 20 },
      { id: 'pillar_news_history', title: 'আজকের দিনে ইতিহাস (This Day in History)', description: 'ঐতিহাসিক ঘটনার স্মরণ ও গুরুত্ব', targetAudienceSegment: 'History Buffs', weight: 15 }
    ],
    contentMix: { educational: 35, community: 15, authority: 30, promotional: 0, timely: 20 },
    promotionalPostLimitPercent: 5,
    sourcePolicy: {
      requireSourcesForNews: true,
      requireOfficialSourceForAnnouncements: true,
      minimumSourcesForHighRiskClaims: 2
    },
    preferredFormats: ['news_strip', 'infographic', 'quote'],
    ctaStyle: 'question',
    hashtagStyle: 'minimal',
    hashtagLimit: 4,
    emojiLimit: 1,
    preferredCaptionLength: { min: 400, max: 2000 },
    timezone: 'Asia/Kolkata',
    maxPostsPerDay: 4,
    minimumPostGapMinutes: 120,
    approvalMode: 'manual',
    allowedTopics: ['Current Events', 'Science News', 'Policy Analysis', 'History'],
    blockedTopics: ['gossip', 'unverified rumors', 'hate speech', 'scandals'],
    blockedClaims: ['breaking exclusive secret', 'confirmed leak'],
    productsOrServices: [],
    learnedPreferences: []
  })
});

/**
 * Validate IANA timezone string
 */
function isValidTimezone(tz) {
  if (typeof tz !== 'string' || !tz.trim()) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz.trim() });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create Default Content Profile Factory
 */
function createDefaultContentProfile(seed = {}) {
  const defaults = {
    schemaVersion: 1,
    niche: typeof seed.niche === 'string' ? seed.niche.slice(0, 100) : '',
    nicheDescription: typeof seed.nicheDescription === 'string' ? seed.nicheDescription.slice(0, 500) : '',
    primaryGoal: 'engagement',
    secondaryGoals: [],
    language: 'bn',
    languageStyle: 'Natural Bengali',
    tone: ['helpful', 'credible'],
    audience: {
      locations: [],
      ageRange: 'all',
      professions: [],
      interests: [],
      knowledgeLevel: 'general'
    },
    contentPillars: [],
    productsOrServices: [],
    allowedTopics: [],
    blockedTopics: [],
    blockedClaims: [],
    preferredFormats: ['infographic', 'story', 'tips'],
    ctaStyle: 'soft',
    hashtagStyle: 'minimal',
    hashtagLimit: 5,
    emojiLimit: 3,
    preferredCaptionLength: {
      min: 250,
      max: 800
    },
    timezone: 'Asia/Kolkata',
    maxPostsPerDay: 3,
    minimumPostGapMinutes: 180,
    promotionalPostLimitPercent: 20,
    contentMix: {
      educational: 40,
      community: 20,
      authority: 15,
      promotional: 15,
      timely: 10
    },
    sourcePolicy: {
      requireSourcesForNews: true,
      requireOfficialSourceForAnnouncements: true,
      minimumSourcesForHighRiskClaims: 2
    },
    approvalMode: 'manual',
    learnedPreferences: []
  };

  return defaults;
}

/**
 * Clean and bound a string
 */
function cleanString(val, maxLength = 255) {
  if (typeof val !== 'string') return '';
  // Sanitize non-printable control characters except standard whitespace
  const sanitized = val.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  return sanitized.trim().slice(0, maxLength);
}

/**
 * Clean and bound array of unique strings
 */
function cleanStringArray(arr, maxItems = 50, maxItemLength = 100) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const result = [];
  for (const item of arr) {
    if (result.length >= maxItems) break;
    const cleaned = cleanString(item, maxItemLength);
    if (cleaned && !seen.has(cleaned.toLowerCase())) {
      seen.add(cleaned.toLowerCase());
      result.push(cleaned);
    }
  }
  return result;
}

/**
 * Normalize Content Profile
 * Cleans, sanitizes, and applies safe defaults to raw input
 */
function normalizeContentProfile(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return createDefaultContentProfile();
  }

  // Reject prototype pollution keys
  for (const k of Object.keys(input)) {
    if (PROHIBITED_KEYS.has(k)) {
      delete input[k];
    }
  }

  const defaults = createDefaultContentProfile();
  const normalized = {
    schemaVersion: 1,
    niche: cleanString(input.niche || defaults.niche, 100),
    nicheDescription: cleanString(input.nicheDescription || defaults.nicheDescription, 500),
    primaryGoal: ALLOWED_PRIMARY_GOALS.has(input.primaryGoal) ? input.primaryGoal : defaults.primaryGoal,
    secondaryGoals: Array.isArray(input.secondaryGoals)
      ? input.secondaryGoals.filter(g => ALLOWED_PRIMARY_GOALS.has(g) && g !== input.primaryGoal).slice(0, 3)
      : [],
    language: ALLOWED_LANGUAGES.has(input.language) ? input.language : defaults.language,
    languageStyle: cleanString(input.languageStyle || defaults.languageStyle, 100),
    tone: Array.isArray(input.tone)
      ? input.tone.filter(t => ALLOWED_TONES.has(t)).slice(0, 5)
      : defaults.tone,
    audience: {
      locations: cleanStringArray(input.audience?.locations, 10, 60),
      ageRange: cleanString(input.audience?.ageRange || defaults.audience.ageRange, 30),
      professions: cleanStringArray(input.audience?.professions, 10, 60),
      interests: cleanStringArray(input.audience?.interests, 15, 60),
      knowledgeLevel: ALLOWED_KNOWLEDGE_LEVELS.has(input.audience?.knowledgeLevel)
        ? input.audience.knowledgeLevel
        : defaults.audience.knowledgeLevel
    },
    contentPillars: normalizeContentPillars(input.contentPillars),
    productsOrServices: normalizeProductsOrServices(input.productsOrServices),
    allowedTopics: cleanStringArray(input.allowedTopics, 50, 80),
    blockedTopics: cleanStringArray(input.blockedTopics, 50, 80),
    blockedClaims: cleanStringArray(input.blockedClaims, 50, 120),
    preferredFormats: Array.isArray(input.preferredFormats)
      ? input.preferredFormats.filter(f => ALLOWED_FORMATS.has(f)).slice(0, 7)
      : defaults.preferredFormats,
    ctaStyle: ALLOWED_CTA_STYLES.has(input.ctaStyle) ? input.ctaStyle : defaults.ctaStyle,
    hashtagStyle: ALLOWED_HASHTAG_STYLES.has(input.hashtagStyle) ? input.hashtagStyle : defaults.hashtagStyle,
    hashtagLimit: normalizeInteger(input.hashtagLimit, 0, 15, defaults.hashtagLimit),
    emojiLimit: normalizeInteger(input.emojiLimit, 0, 10, defaults.emojiLimit),
    preferredCaptionLength: normalizeCaptionLength(input.preferredCaptionLength, defaults.preferredCaptionLength),
    timezone: isValidTimezone(input.timezone) ? input.timezone.trim() : defaults.timezone,
    maxPostsPerDay: normalizeInteger(input.maxPostsPerDay, 1, 20, defaults.maxPostsPerDay),
    minimumPostGapMinutes: normalizeInteger(input.minimumPostGapMinutes, 15, 1440, defaults.minimumPostGapMinutes),
    promotionalPostLimitPercent: normalizeInteger(input.promotionalPostLimitPercent, 0, 100, defaults.promotionalPostLimitPercent),
    contentMix: normalizeContentMix(input.contentMix, defaults.contentMix),
    sourcePolicy: {
      requireSourcesForNews: input.sourcePolicy?.requireSourcesForNews !== false,
      requireOfficialSourceForAnnouncements: input.sourcePolicy?.requireOfficialSourceForAnnouncements !== false,
      minimumSourcesForHighRiskClaims: normalizeInteger(input.sourcePolicy?.minimumSourcesForHighRiskClaims, 1, 5, 2)
    },
    approvalMode: ALLOWED_APPROVAL_MODES.has(input.approvalMode) ? input.approvalMode : defaults.approvalMode,
    learnedPreferences: cleanStringArray(input.learnedPreferences, 20, 200)
  };

  // If tone array became empty, restore defaults
  if (normalized.tone.length === 0) {
    normalized.tone = ['helpful', 'credible'];
  }
  if (normalized.preferredFormats.length === 0) {
    normalized.preferredFormats = ['infographic', 'story', 'tips'];
  }

  return normalized;
}

/**
 * Normalize integer within [min, max]
 */
function normalizeInteger(val, min, max, defaultVal) {
  const num = parseInt(val, 10);
  if (isNaN(num)) return defaultVal;
  if (num < min) return min;
  if (num > max) return max;
  return num;
}

/**
 * Normalize preferredCaptionLength
 */
function normalizeCaptionLength(raw, defaultVal) {
  if (!raw || typeof raw !== 'object') return defaultVal;
  let min = normalizeInteger(raw.min, 100, 3000, defaultVal.min);
  let max = normalizeInteger(raw.max, 150, 6000, defaultVal.max);
  if (min > max) {
    min = defaultVal.min;
    max = defaultVal.max;
  }
  return { min, max };
}

/**
 * Normalize content mix and ensure total equals 100
 */
function normalizeContentMix(raw, defaultVal) {
  if (!raw || typeof raw !== 'object') return { ...defaultVal };
  const educational = normalizeInteger(raw.educational, 0, 100, defaultVal.educational);
  const community = normalizeInteger(raw.community, 0, 100, defaultVal.community);
  const authority = normalizeInteger(raw.authority, 0, 100, defaultVal.authority);
  const promotional = normalizeInteger(raw.promotional, 0, 100, defaultVal.promotional);
  const timely = normalizeInteger(raw.timely, 0, 100, defaultVal.timely);

  const total = educational + community + authority + promotional + timely;
  if (total === 100) {
    return { educational, community, authority, promotional, timely };
  }
  // Return standard default if sum is invalid
  return { ...defaultVal };
}

/**
 * Normalize content pillars
 */
function normalizeContentPillars(pillars) {
  if (!Array.isArray(pillars)) return [];
  const seen = new Set();
  const seenIds = new Set();
  const result = [];

  for (const p of pillars) {
    if (result.length >= 8) break;
    if (!p || typeof p !== 'object') continue;
    const title = cleanString(p.title, 60);
    if (!title) continue;
    const normKey = title.toLowerCase();
    if (seen.has(normKey)) continue;
    seen.add(normKey);

    let pid = cleanString(p.id, 40) || `pillar_${result.length + 1}`;
    if (seenIds.has(pid.toLowerCase())) {
      pid = `pillar_${result.length + 1}_${result.length}`;
    }
    seenIds.add(pid.toLowerCase());

    result.push({
      id: pid,
      title,
      description: cleanString(p.description, 200),
      targetAudienceSegment: cleanString(p.targetAudienceSegment, 100),
      weight: normalizeInteger(p.weight, 1, 100, 20)
    });
  }

  // If weights don't sum to 100, rebalance them to equal exactly 100
  if (result.length > 0) {
    const sum = result.reduce((acc, p) => acc + p.weight, 0);
    if (sum !== 100) {
      let currentSum = 0;
      for (let i = 0; i < result.length; i++) {
        if (i === result.length - 1) {
          result[i].weight = Math.max(1, 100 - currentSum);
        } else {
          const scaled = Math.max(1, Math.round((result[i].weight / sum) * 100));
          result[i].weight = scaled;
          currentSum += scaled;
        }
      }
    }
  }

  return result;
}

/**
 * Normalize products or services
 */
function normalizeProductsOrServices(products) {
  if (!Array.isArray(products)) return [];
  const result = [];
  for (const p of products) {
    if (result.length >= 10) break;
    if (!p || typeof p !== 'object') continue;
    const name = cleanString(p.name, 80);
    if (!name) continue;
    result.push({
      name,
      description: cleanString(p.description, 200),
      ctaLink: cleanString(p.ctaLink, 200)
    });
  }
  return result;
}

/**
 * Known top-level allowed fields for validation
 */
const ALLOWED_PROFILE_KEYS = new Set([
  'schemaVersion', 'niche', 'nicheDescription', 'primaryGoal', 'secondaryGoals',
  'language', 'languageStyle', 'tone', 'audience', 'contentPillars',
  'productsOrServices', 'allowedTopics', 'blockedTopics', 'blockedClaims',
  'preferredFormats', 'ctaStyle', 'hashtagStyle', 'hashtagLimit', 'emojiLimit',
  'preferredCaptionLength', 'timezone', 'maxPostsPerDay', 'minimumPostGapMinutes',
  'promotionalPostLimitPercent', 'contentMix', 'sourcePolicy', 'approvalMode',
  'learnedPreferences'
]);

const REQUIRED_FULL_FIELDS = [
  'schemaVersion', 'niche', 'primaryGoal', 'language', 'tone',
  'audience', 'contentPillars', 'contentMix', 'promotionalPostLimitPercent',
  'sourcePolicy', 'approvalMode'
];

/**
 * Validate Content Profile
 * Returns { valid: boolean, errors: Array<{ field, code, message }> }
 */
function validateContentProfile(input, options = {}) {
  const errors = [];

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      valid: false,
      errors: [{ field: 'root', code: 'INVALID_OBJECT', message: 'Profile must be a valid JSON object.' }]
    };
  }

  // 0. Full profile requirement check (e.g. for PUT replacement)
  if (options && options.requireFullProfile) {
    for (const field of REQUIRED_FULL_FIELDS) {
      if (typeof input[field] === 'undefined' || input[field] === null) {
        errors.push({
          field,
          code: 'REQUIRED_FIELD',
          message: `Field "${field}" is required for complete content profile replacement.`
        });
      }
    }
  }

  // 1. Prototype pollution check & allowed keys check
  for (const key of Object.keys(input)) {
    if (PROHIBITED_KEYS.has(key)) {
      errors.push({ field: key, code: 'PROHIBITED_KEY', message: `Key "${key}" is prohibited for security reasons.` });
    } else if (!ALLOWED_PROFILE_KEYS.has(key)) {
      errors.push({ field: key, code: 'UNKNOWN_FIELD', message: `Unknown property "${key}" is not permitted.` });
    }
  }

  // 2. Niche
  if (typeof input.niche !== 'undefined') {
    if (typeof input.niche !== 'string') {
      errors.push({ field: 'niche', code: 'INVALID_TYPE', message: 'Niche must be a string.' });
    } else if (input.niche.length > 100) {
      errors.push({ field: 'niche', code: 'MAX_LENGTH_EXCEEDED', message: 'Niche must not exceed 100 characters.' });
    } else if (options && options.requireFullProfile && input.niche.trim().length === 0) {
      errors.push({ field: 'niche', code: 'REQUIRED', message: 'Niche cannot be empty.' });
    }
  }

  // 3. Primary Goal
  if (typeof input.primaryGoal !== 'undefined' && !ALLOWED_PRIMARY_GOALS.has(input.primaryGoal)) {
    errors.push({
      field: 'primaryGoal',
      code: 'INVALID_ENUM',
      message: `Primary goal must be one of: ${Array.from(ALLOWED_PRIMARY_GOALS).join(', ')}.`
    });
  }

  // 4. Secondary Goals
  if (typeof input.secondaryGoals !== 'undefined') {
    if (!Array.isArray(input.secondaryGoals)) {
      errors.push({ field: 'secondaryGoals', code: 'INVALID_TYPE', message: 'Secondary goals must be an array.' });
    } else {
      for (const g of input.secondaryGoals) {
        if (!ALLOWED_PRIMARY_GOALS.has(g)) {
          errors.push({ field: 'secondaryGoals', code: 'INVALID_ENUM', message: `Invalid secondary goal: "${g}".` });
        }
      }
      if (input.secondaryGoals.length > 3) {
        errors.push({ field: 'secondaryGoals', code: 'ARRAY_TOO_LARGE', message: 'Maximum 3 secondary goals allowed.' });
      }
    }
  }

  // 5. Language
  if (typeof input.language !== 'undefined' && !ALLOWED_LANGUAGES.has(input.language)) {
    errors.push({ field: 'language', code: 'INVALID_ENUM', message: 'Language must be one of: bn, en, bn_en.' });
  }

  // 6. Tone
  if (typeof input.tone !== 'undefined') {
    if (!Array.isArray(input.tone)) {
      errors.push({ field: 'tone', code: 'INVALID_TYPE', message: 'Tone must be an array of strings.' });
    } else {
      if (input.tone.length === 0) {
        errors.push({ field: 'tone', code: 'MIN_ITEMS_REQUIRED', message: 'At least one tone is required.' });
      }
      if (input.tone.length > 5) {
        errors.push({ field: 'tone', code: 'ARRAY_TOO_LARGE', message: 'Maximum 5 tone attributes allowed.' });
      }
      for (const t of input.tone) {
        if (!ALLOWED_TONES.has(t)) {
          errors.push({ field: 'tone', code: 'INVALID_ENUM', message: `Unsupported tone: "${t}".` });
        }
      }
    }
  }

  // 7. Audience
  if (typeof input.audience !== 'undefined') {
    if (!input.audience || typeof input.audience !== 'object' || Array.isArray(input.audience)) {
      errors.push({ field: 'audience', code: 'INVALID_TYPE', message: 'Audience must be an object.' });
    } else if (typeof input.audience.knowledgeLevel !== 'undefined' && !ALLOWED_KNOWLEDGE_LEVELS.has(input.audience.knowledgeLevel)) {
      errors.push({
        field: 'audience.knowledgeLevel',
        code: 'INVALID_ENUM',
        message: `Audience knowledge level must be one of: ${Array.from(ALLOWED_KNOWLEDGE_LEVELS).join(', ')}.`
      });
    }
  }

  // 8. Preferred Caption Length
  if (typeof input.preferredCaptionLength !== 'undefined') {
    const len = input.preferredCaptionLength;
    if (!len || typeof len !== 'object') {
      errors.push({ field: 'preferredCaptionLength', code: 'INVALID_TYPE', message: 'Caption length must be an object with min and max.' });
    } else {
      if (typeof len.min !== 'number' || len.min < 100 || len.min > 3000) {
        errors.push({ field: 'preferredCaptionLength.min', code: 'OUT_OF_RANGE', message: 'Minimum caption length must be between 100 and 3000.' });
      }
      if (typeof len.max !== 'number' || len.max < 150 || len.max > 6000) {
        errors.push({ field: 'preferredCaptionLength.max', code: 'OUT_OF_RANGE', message: 'Maximum caption length must be between 150 and 6000.' });
      }
      if (typeof len.min === 'number' && typeof len.max === 'number' && len.min > len.max) {
        errors.push({ field: 'preferredCaptionLength', code: 'INVALID_RANGE', message: 'Minimum caption length cannot exceed maximum caption length.' });
      }
    }
  }

  // 9. Timezone
  if (typeof input.timezone !== 'undefined' && !isValidTimezone(input.timezone)) {
    errors.push({ field: 'timezone', code: 'INVALID_TIMEZONE', message: `Invalid IANA timezone: "${input.timezone}".` });
  }

  // 10. Limits & Gaps
  if (typeof input.maxPostsPerDay !== 'undefined') {
    if (typeof input.maxPostsPerDay !== 'number' || input.maxPostsPerDay < 1 || input.maxPostsPerDay > 20) {
      errors.push({ field: 'maxPostsPerDay', code: 'OUT_OF_RANGE', message: 'Maximum posts per day must be between 1 and 20.' });
    }
  }
  if (typeof input.minimumPostGapMinutes !== 'undefined') {
    if (typeof input.minimumPostGapMinutes !== 'number' || input.minimumPostGapMinutes < 15 || input.minimumPostGapMinutes > 1440) {
      errors.push({ field: 'minimumPostGapMinutes', code: 'OUT_OF_RANGE', message: 'Minimum post gap must be between 15 and 1440 minutes.' });
    }
  }
  if (typeof input.promotionalPostLimitPercent !== 'undefined') {
    if (typeof input.promotionalPostLimitPercent !== 'number' || input.promotionalPostLimitPercent < 0 || input.promotionalPostLimitPercent > 100) {
      errors.push({ field: 'promotionalPostLimitPercent', code: 'OUT_OF_RANGE', message: 'Promotional post limit percent must be between 0 and 100.' });
    }
  }
  if (typeof input.hashtagLimit !== 'undefined') {
    if (typeof input.hashtagLimit !== 'number' || input.hashtagLimit < 0 || input.hashtagLimit > 15) {
      errors.push({ field: 'hashtagLimit', code: 'OUT_OF_RANGE', message: 'Hashtag limit must be between 0 and 15.' });
    }
  }
  if (typeof input.emojiLimit !== 'undefined') {
    if (typeof input.emojiLimit !== 'number' || input.emojiLimit < 0 || input.emojiLimit > 10) {
      errors.push({ field: 'emojiLimit', code: 'OUT_OF_RANGE', message: 'Emoji limit must be between 0 and 10.' });
    }
  }

  // 11. Content Mix & Promotional Limit
  if (typeof input.contentMix !== 'undefined') {
    const mix = input.contentMix;
    if (!mix || typeof mix !== 'object') {
      errors.push({ field: 'contentMix', code: 'INVALID_TYPE', message: 'Content mix must be an object.' });
    } else {
      const keys = ['educational', 'community', 'authority', 'promotional', 'timely'];
      let total = 0;
      for (const k of keys) {
        const val = mix[k];
        if (typeof val !== 'number' || val < 0 || val > 100) {
          errors.push({ field: `contentMix.${k}`, code: 'OUT_OF_RANGE', message: `${k} mix percentage must be between 0 and 100.` });
        } else {
          total += val;
        }
      }
      if (total !== 100) {
        errors.push({ field: 'contentMix', code: 'SUM_NOT_100', message: `Content mix percentages must sum to 100 (current sum: ${total}).` });
      }

      const promoLimit = typeof input.promotionalPostLimitPercent === 'number'
        ? input.promotionalPostLimitPercent
        : 100;
      if (typeof mix.promotional === 'number' && mix.promotional > promoLimit) {
        errors.push({
          field: 'contentMix.promotional',
          code: 'EXCEEDS_PROMOTIONAL_LIMIT',
          message: `Promotional mix percentage (${mix.promotional}%) cannot exceed promotional post limit (${promoLimit}%).`
        });
      }
    }
  }

  // 12. Source Policy
  if (typeof input.sourcePolicy !== 'undefined') {
    if (!input.sourcePolicy || typeof input.sourcePolicy !== 'object' || Array.isArray(input.sourcePolicy)) {
      errors.push({ field: 'sourcePolicy', code: 'INVALID_TYPE', message: 'Source policy must be an object.' });
    } else if (typeof input.sourcePolicy.minimumSourcesForHighRiskClaims !== 'undefined') {
      const minS = input.sourcePolicy.minimumSourcesForHighRiskClaims;
      if (typeof minS !== 'number' || minS < 1 || minS > 5) {
        errors.push({ field: 'sourcePolicy.minimumSourcesForHighRiskClaims', code: 'OUT_OF_RANGE', message: 'Minimum sources for high risk claims must be between 1 and 5.' });
      }
    }
  }

  // 13. Approval Mode
  if (typeof input.approvalMode !== 'undefined' && !ALLOWED_APPROVAL_MODES.has(input.approvalMode)) {
    errors.push({ field: 'approvalMode', code: 'INVALID_ENUM', message: `Approval mode must be one of: ${Array.from(ALLOWED_APPROVAL_MODES).join(', ')}.` });
  }

  // 14. Content Pillars
  if (typeof input.contentPillars !== 'undefined') {
    if (!Array.isArray(input.contentPillars)) {
      errors.push({ field: 'contentPillars', code: 'INVALID_TYPE', message: 'Content pillars must be an array.' });
    } else {
      if (options && options.requireFullProfile && input.contentPillars.length === 0) {
        errors.push({ field: 'contentPillars', code: 'EMPTY_PILLARS', message: 'At least one content pillar is required.' });
      } else if (input.contentPillars.length > 8) {
        errors.push({ field: 'contentPillars', code: 'ARRAY_TOO_LARGE', message: 'Maximum 8 content pillars allowed.' });
      }

      const seenTitles = new Set();
      const seenIds = new Set();
      let pillarWeightSum = 0;
      let hasInvalidWeights = false;

      input.contentPillars.forEach((p, idx) => {
        if (!p || typeof p !== 'object') {
          errors.push({ field: `contentPillars[${idx}]`, code: 'INVALID_OBJECT', message: 'Pillar must be an object.' });
          hasInvalidWeights = true;
          return;
        }

        // Title check
        if (!p.title || typeof p.title !== 'string' || p.title.trim().length === 0) {
          errors.push({ field: `contentPillars[${idx}].title`, code: 'REQUIRED', message: 'Pillar title is required.' });
        } else {
          const normTitle = p.title.trim().toLowerCase();
          if (seenTitles.has(normTitle)) {
            errors.push({ field: `contentPillars[${idx}].title`, code: 'DUPLICATE_PILLAR', message: `Duplicate pillar title: "${p.title.trim()}".` });
          }
          seenTitles.add(normTitle);
        }

        // ID check
        if (p.id) {
          if (typeof p.id !== 'string') {
            errors.push({ field: `contentPillars[${idx}].id`, code: 'INVALID_TYPE', message: 'Pillar ID must be a string.' });
          } else {
            const normId = p.id.trim().toLowerCase();
            if (seenIds.has(normId)) {
              errors.push({ field: `contentPillars[${idx}].id`, code: 'DUPLICATE_ID', message: `Duplicate pillar ID: "${p.id.trim()}".` });
            }
            seenIds.add(normId);
          }
        }

        // Weight check
        if (typeof p.weight !== 'number' || !Number.isInteger(p.weight) || p.weight < 1 || p.weight > 100) {
          errors.push({ field: `contentPillars[${idx}].weight`, code: 'OUT_OF_RANGE', message: 'Pillar weight must be an integer between 1 and 100.' });
          hasInvalidWeights = true;
        } else {
          pillarWeightSum += p.weight;
        }
      });

      if (input.contentPillars.length > 0 && !hasInvalidWeights && pillarWeightSum !== 100) {
        errors.push({
          field: 'contentPillars',
          code: 'PILLAR_WEIGHTS_SUM_NOT_100',
          message: `Content pillar weights must sum to exactly 100 (current sum: ${pillarWeightSum}).`
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Determine Onboarding Status: not_started | incomplete | complete
 */
function calculateOnboardingStatus(profile) {
  if (!profile || typeof profile !== 'object') return 'not_started';
  const hasNiche = typeof profile.niche === 'string' && profile.niche.trim().length > 0;
  const hasTone = Array.isArray(profile.tone) && profile.tone.length > 0;
  const hasPillars = Array.isArray(profile.contentPillars) && profile.contentPillars.length >= 3;
  const hasAudience = profile.audience && (
    (Array.isArray(profile.audience.locations) && profile.audience.locations.length > 0) ||
    (Array.isArray(profile.audience.professions) && profile.audience.professions.length > 0) ||
    (Array.isArray(profile.audience.interests) && profile.audience.interests.length > 0)
  );

  if (hasNiche && hasTone && hasPillars && hasAudience) {
    return 'complete';
  }
  if (hasNiche) {
    return 'incomplete';
  }
  return 'not_started';
}

/**
 * Build Public Content Profile (strips internal non-profile fields)
 */
function buildPublicContentProfile(profile) {
  if (!profile || typeof profile !== 'object') return null;
  const normalized = normalizeContentProfile(profile);
  return {
    ...normalized,
    onboardingStatus: calculateOnboardingStatus(normalized)
  };
}

/**
 * Migrate single page object backward-compatibly
 * - Preserves accessToken, id, name, category, systemPrompt
 * - Adds contentProfile only if missing
 * - Does NOT pretend inferred goals are confirmed
 */
function migrateContentProfile(page) {
  if (!page || typeof page !== 'object') return page;

  // Preserve page core
  const migrated = { ...page };

  if (!migrated.contentProfile) {
    const seedNiche = typeof page.category === 'string' && page.category !== 'General'
      ? page.category.trim()
      : '';
    const newProfile = createDefaultContentProfile({ niche: seedNiche });
    migrated.contentProfile = newProfile;
    migrated.onboardingStatus = calculateOnboardingStatus(newProfile);
  } else {
    // If present, re-normalize safely
    migrated.contentProfile = normalizeContentProfile(migrated.contentProfile);
    migrated.onboardingStatus = calculateOnboardingStatus(migrated.contentProfile);
  }

  return migrated;
}

module.exports = {
  ALLOWED_PRIMARY_GOALS,
  ALLOWED_LANGUAGES,
  ALLOWED_TONES,
  ALLOWED_KNOWLEDGE_LEVELS,
  ALLOWED_FORMATS,
  ALLOWED_CTA_STYLES,
  ALLOWED_HASHTAG_STYLES,
  ALLOWED_APPROVAL_MODES,
  PAGE_DNA_PRESETS,
  createDefaultContentProfile,
  normalizeContentProfile,
  validateContentProfile,
  calculateOnboardingStatus,
  buildPublicContentProfile,
  migrateContentProfile
};
