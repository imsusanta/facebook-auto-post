/**
 * Page DNA Data Model, Validation, Normalization & Migration Service
 *
 * Implements Phase 3 Page DNA: converts structured operator answers about niche,
 * audience, tone, content pillars, safety limits, and approval policies into a
 * normalized, validated contentProfile object.
 */

const ALLOWED_PRIMARY_GOALS = new Set(['engagement', 'reach', 'leads', 'sales', 'authority', 'community']);
const ALLOWED_LANGUAGES = new Set(['bn', 'en', 'bn_en']);
const ALLOWED_TONES = new Set([
  'helpful', 'credible', 'friendly', 'formal', 'inspiring',
  'humorous', 'analytical', 'conversational', 'empathetic', 'authoritative'
]);
const ALLOWED_KNOWLEDGE_LEVELS = new Set(['beginner', 'intermediate', 'advanced', 'general']);
const ALLOWED_FORMATS = new Set(['infographic', 'minimal', 'news_strip', 'quote', 'story', 'tips', 'comparison']);
const ALLOWED_CTA_STYLES = new Set(['soft', 'strong', 'question', 'none']);
const ALLOWED_HASHTAG_STYLES = new Set(['minimal', 'moderate', 'none']);
const ALLOWED_APPROVAL_MODES = new Set(['manual', 'low_risk_auto', 'trusted_categories_auto']);

const PROHIBITED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

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
  const result = [];

  for (const p of pillars) {
    if (result.length >= 8) break;
    if (!p || typeof p !== 'object') continue;
    const title = cleanString(p.title, 60);
    if (!title) continue;
    const normKey = title.toLowerCase();
    if (seen.has(normKey)) continue;
    seen.add(normKey);

    result.push({
      id: cleanString(p.id, 40) || `pillar_${result.length + 1}`,
      title,
      description: cleanString(p.description, 200),
      targetAudienceSegment: cleanString(p.targetAudienceSegment, 100),
      weight: normalizeInteger(p.weight, 1, 100, 20)
    });
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

/**
 * Validate Content Profile
 * Returns { valid: boolean, errors: Array<{ field, code, message }> }
 */
function validateContentProfile(input) {
  const errors = [];

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      valid: false,
      errors: [{ field: 'root', code: 'INVALID_OBJECT', message: 'Profile must be a valid JSON object.' }]
    };
  }

  // 1. Prototype pollution check
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

  // 7. Preferred Caption Length
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

  // 8. Timezone
  if (typeof input.timezone !== 'undefined' && !isValidTimezone(input.timezone)) {
    errors.push({ field: 'timezone', code: 'INVALID_TIMEZONE', message: `Invalid IANA timezone: "${input.timezone}".` });
  }

  // 9. Limits & Gaps
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

  // 10. Content Mix
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
    }
  }

  // 11. Approval Mode
  if (typeof input.approvalMode !== 'undefined' && !ALLOWED_APPROVAL_MODES.has(input.approvalMode)) {
    errors.push({ field: 'approvalMode', code: 'INVALID_ENUM', message: `Approval mode must be one of: ${Array.from(ALLOWED_APPROVAL_MODES).join(', ')}.` });
  }

  // 12. Content Pillars
  if (typeof input.contentPillars !== 'undefined') {
    if (!Array.isArray(input.contentPillars)) {
      errors.push({ field: 'contentPillars', code: 'INVALID_TYPE', message: 'Content pillars must be an array.' });
    } else {
      if (input.contentPillars.length > 8) {
        errors.push({ field: 'contentPillars', code: 'ARRAY_TOO_LARGE', message: 'Maximum 8 content pillars allowed.' });
      }
      const seenTitles = new Set();
      input.contentPillars.forEach((p, idx) => {
        if (!p || typeof p !== 'object') {
          errors.push({ field: `contentPillars[${idx}]`, code: 'INVALID_OBJECT', message: 'Pillar must be an object.' });
          return;
        }
        if (!p.title || typeof p.title !== 'string' || p.title.trim().length === 0) {
          errors.push({ field: `contentPillars[${idx}].title`, code: 'REQUIRED', message: 'Pillar title is required.' });
        } else {
          const normTitle = p.title.trim().toLowerCase();
          if (seenTitles.has(normTitle)) {
            errors.push({ field: `contentPillars[${idx}].title`, code: 'DUPLICATE_PILLAR', message: `Duplicate pillar title: "${p.title.trim()}".` });
          }
          seenTitles.add(normTitle);
        }
      });
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
  createDefaultContentProfile,
  normalizeContentProfile,
  validateContentProfile,
  calculateOnboardingStatus,
  buildPublicContentProfile,
  migrateContentProfile
};
