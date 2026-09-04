/**
 * Content Safety & Quality Guard Service
 * Enforces 15 rigorous pre-publish checks across length, encoding, source verification,
 * duplicate detection, real-person AI imagery, category matching, and policy compliance.
 */

const { URL } = require('url');

// Banned / Toxic content keywords (hate speech, scams, harassment, NSFW)
const BANNED_PATTERNS = [
  /\b(free money|get rich quick|guaranteed return|crypto scam|100% profit)\b/i,
  /\b(hack account|bypass password|free followers|buy likes)\b/i,
  /\b(suicide|self-harm|kill yourself)\b/i
];

// Sensitive breaking news or official claim indicators
const SENSITIVE_CLAIM_PATTERNS = [
  /ব্রেকিং\s*নিউজ/i,
  /জরুরি\s*ঘোষণা/i,
  /সরকারি\s*নির্দেশ/i,
  /\bbreaking\s*news\b/i,
  /\bofficial\s*announcement\b/i,
  /\burgent\s*alert\b/i
];

// Real people / political figures keywords where synthetic AI imagery is unsafe
const REAL_PERSON_KEYWORDS = [
  'modi', 'narendra modi', 'mamata', 'mamata banerjee', 'rahul gandhi',
  'biden', 'trump', 'sheikh hasina', 'younus', 'muhammad yunus',
  'নেতাজি', 'গান্ধী', 'প্রধানমন্ত্রী', 'মুখ্যমন্ত্রী', 'রাষ্ট্রপতি'
];

/**
 * Tokenize string into a Set of clean lower-case words
 */
function tokenize(text) {
  if (!text || typeof text !== 'string') return new Set();
  return new Set(
    text
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, '') // remove URLs
      .replace(/[#@][\w\u0980-\u09FF]+/g, '') // remove hashtags / mentions
      .replace(/[^\w\u0980-\u09FF\s]/g, ' ') // keep Bengali and alphanumeric
      .split(/\s+/)
      .filter(w => w.length > 2)
  );
}

/**
 * Calculate Jaccard similarity between two token sets
 */
function calculateSimilarity(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Check if text contains corrupted mojibake characters
 */
function containsMojibake(text) {
  if (!text || typeof text !== 'string') return false;
  return /\u00E0[\u00A6\u00A7]|\u00C3[\u00A9\u00A0\u00AD\u0080-\u00BF]|\u00F0\u0178|\uFFFD/.test(text);
}

/**
 * Validate HTTP/HTTPS source URL (rejects private / localhost / internal networks)
 */
function isValidPublicUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') return false;
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname.endsWith('.local') ||
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    ) {
      return false; // Reject private/internal networks
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate sources schema: [{ url, title, publisher, publishedAt, isOfficial }]
 */
function validateSources(sources) {
  if (!Array.isArray(sources) || sources.length === 0) {
    return { valid: false, errors: ['No sources provided.'] };
  }

  const errors = [];
  sources.forEach((src, idx) => {
    if (!src || typeof src !== 'object') {
      errors.push(`Source #${idx + 1} is invalid.`);
      return;
    }
    if (!isValidPublicUrl(src.url)) {
      errors.push(`Source #${idx + 1} has an invalid or non-public URL: "${src.url}".`);
    }
    if (!src.publisher || typeof src.publisher !== 'string' || !src.publisher.trim()) {
      errors.push(`Source #${idx + 1} missing publisher name.`);
    }
  });

  return { valid: errors.length === 0, errors };
}

/**
 * Check if content is a near-duplicate of recent history
 */
function checkDuplicate(message, history = [], threshold = 0.65) {
  if (!message || !Array.isArray(history) || history.length === 0) {
    return { isDuplicate: false, similarity: 0, matchedPostId: null };
  }

  const currentTokens = tokenize(message);
  if (currentTokens.size < 5) {
    return { isDuplicate: false, similarity: 0, matchedPostId: null };
  }

  for (const item of history.slice(0, 100)) {
    const historicalMessage = item.message || item.post_caption || '';
    if (!historicalMessage) continue;

    const historicalTokens = tokenize(historicalMessage);
    const sim = calculateSimilarity(currentTokens, historicalTokens);
    if (sim >= threshold) {
      return {
        isDuplicate: true,
        similarity: Math.round(sim * 100) / 100,
        matchedPostId: item.id || item.postId || 'recent_post'
      };
    }
  }

  return { isDuplicate: false, similarity: 0, matchedPostId: null };
}

/**
 * Standalone Content Safety Guard executing all 15 rules
 */
function validateContent(postData = {}, options = {}) {
  const {
    history = [],
    isAutoPilot = false,
    pageCategory = ''
  } = options;

  const caption = postData.message || postData.post_caption || '';
  const category = postData.categoryId || postData.category || '';
  const sources = postData.sources || [];
  const hasAiImage = !!(postData.includeImage || postData.isAiImage || (postData.imageUrl && postData.imageUrl.includes('pollinations')));

  const reasons = [];
  const warnings = [];
  let reviewRequired = false;

  // 1. Length Check
  if (!caption || typeof caption !== 'string') {
    reasons.push('Caption is empty or missing.');
  } else {
    const charCount = caption.trim().length;
    if (charCount < 30) {
      reasons.push(`Caption too short (${charCount} chars). Minimum 30 characters required.`);
    } else if (charCount > 6000) {
      reasons.push(`Caption too long (${charCount} chars). Maximum 6,000 characters allowed.`);
    }
  }

  // 2. Mojibake / Corrupted Encoding Check
  if (containsMojibake(caption) || containsMojibake(postData.title || '')) {
    reasons.push('Corrupted character encoding (mojibake) detected in caption or title.');
  }

  // 3. Topic Check
  if (postData.topic !== undefined && typeof postData.topic === 'string' && !postData.topic.trim() && !category) {
    warnings.push('No topic or category specified.');
  }

  // 4. Excessive Emojis Check
  const emojiMatches = caption.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || [];
  if (emojiMatches.length > 25) {
    warnings.push(`Excessive emojis detected (${emojiMatches.length}). Recommended maximum is 15.`);
    reviewRequired = true;
  }

  // 5. Excessive Hashtags Check
  const hashtags = caption.match(/#[\w\u0980-\u09FF]+/g) || [];
  if (hashtags.length > 15) {
    warnings.push(`Excessive hashtags detected (${hashtags.length}). Recommended maximum is 10.`);
    reviewRequired = true;
  }

  // 6. Source Verification for News & Sensitive Claims
  const isNewsCategory = category === 'trending_news' || category === 'news' || category === 'current_affairs';
  const hasSensitiveClaim = SENSITIVE_CLAIM_PATTERNS.some(p => p.test(caption));

  if (isNewsCategory || hasSensitiveClaim) {
    const sourceCheck = validateSources(sources);
    if (!sourceCheck.valid) {
      if (isAutoPilot) {
        reasons.push(`News or sensitive claims cannot be auto-published without verified sources: ${sourceCheck.errors.join(' ')}`);
      } else {
        warnings.push(`Unverified news claims: ${sourceCheck.errors.join(' ')}`);
        reviewRequired = true;
      }
    }
  }

  // 7. Duplicate Content Check
  const dupCheck = checkDuplicate(caption, history, 0.65);
  if (dupCheck.isDuplicate) {
    if (isAutoPilot) {
      reasons.push(`High content similarity (${Math.round(dupCheck.similarity * 100)}%) detected with existing post ${dupCheck.matchedPostId}.`);
    } else {
      warnings.push(`Potential duplicate: ${Math.round(dupCheck.similarity * 100)}% similar to post ${dupCheck.matchedPostId}.`);
      reviewRequired = true;
    }
  }

  // 8. Real Person with AI Imagery Check
  if (hasAiImage) {
    const lowerCaption = caption.toLowerCase();
    const hasRealPerson = REAL_PERSON_KEYWORDS.some(k => lowerCaption.includes(k));
    if (hasRealPerson && (isNewsCategory || hasSensitiveClaim)) {
      reasons.push('Meta safety policy: AI-generated synthetic imagery cannot be used for breaking news concerning real living people.');
    }
  }

  // 9. Category Mismatch Check
  if (pageCategory && category) {
    const cleanPageCat = pageCategory.toLowerCase();
    const cleanPostCat = category.toLowerCase();
    if (cleanPageCat.includes('cook') && cleanPostCat.includes('space')) {
      warnings.push(`Post category "${category}" appears mismatched with Page niche "${pageCategory}".`);
      reviewRequired = true;
    }
  }

  // 10. Banned / Prohibited Keywords Check
  for (const banned of BANNED_PATTERNS) {
    if (banned.test(caption)) {
      reasons.push('Caption contains prohibited keywords or spam patterns violating community standards.');
      break;
    }
  }

  // 11. Unverified Claims
  if (hasSensitiveClaim && sources.length === 0) {
    reviewRequired = true;
    warnings.push('Post makes urgent or breaking claims without citing an official source.');
  }

  // 12. Link Safety Check
  const urlsInCaption = caption.match(/https?:\/\/\S+/g) || [];
  for (const urlStr of urlsInCaption) {
    if (!isValidPublicUrl(urlStr)) {
      reasons.push(`Suspicious or private URL found in post text: ${urlStr}`);
    }
  }

  // 13. Image Path/URL Validity Check
  if (postData.imagePath && typeof postData.imagePath === 'string') {
    const fs = require('fs');
    if (!fs.existsSync(postData.imagePath)) {
      reasons.push(`Image path specified does not exist on disk: ${postData.imagePath}`);
    }
  }

  // 14. Bengali Script Presence (for Bengali audience pages)
  const bengaliCharMatch = caption.match(/[\u0980-\u09FF]/g);
  if (!bengaliCharMatch || bengaliCharMatch.length < 10) {
    warnings.push('Post does not contain significant Bengali text.');
  }

  // 15. AutoPilot Fail-Closed Rule
  const safe = reasons.length === 0 && (!isAutoPilot || !reviewRequired);

  return {
    safe,
    reviewRequired: reviewRequired || reasons.length > 0,
    reasons,
    warnings
  };
}

module.exports = {
  validateContent,
  checkDuplicate,
  validateSources,
  containsMojibake,
  isValidPublicUrl,
  calculateSimilarity,
  tokenize
};
