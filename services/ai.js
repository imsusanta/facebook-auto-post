const axios = require('axios');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const storage = require('./storage');

const media = require('../security/media');

function extractJson(text) {
  if (!text) return null;
  let clean = text.trim();
  if (clean.startsWith('```json')) {
    clean = clean.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
  } else if (clean.startsWith('```')) {
    clean = clean.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }
  try {
    return JSON.parse(clean.trim());
  } catch (e) {
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (err) {}
    }
  }
  return null;
}

function escapeXml(unsafe) {
  if (!unsafe) return '';
  return unsafe.toString().replace(/[<>&'"]/g, function (c) {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
  });
}

// Multi-Style Writing System Prompts
const STYLE_GUIDES = {
  story: `WRITING STYLE REQUIREMENT: "গল্পের ছলে (Storytelling)".
- Format: Write as a captivating real-life narrative or drama in natural, conversational Bengali.
- Structure: Start directly with the core moment or setting -> unfold the story across 2-3 organic paragraphs -> end with a thoughtful takeaway.
- NO BULLET POINTS: Absolutely DO NOT use bullet points (no 🔹, no •, no numbered lists). Write in smooth, natural, immersive paragraphs like a literary story or compelling personal post.
- Tone: Emotional, immersive, conversational, and authentic.`,

  news: `WRITING STYLE REQUIREMENT: "সংবাদ বুলেটিন (Breaking News)".
- Format: Urgent, high-impact journalistic news reporting in natural Bengali.
- Structure: Start with a crisp headline -> report core verified facts in the opening -> background context and direct implications.
- Tone: Objective, authoritative, fast-paced, and credible without artificial hype or clickbait.`,

  debate: `WRITING STYLE REQUIREMENT: "প্রশ্ন ও বিতর্ক (Question / Debate)".
- Format: Thought-provoking dilemma or open discussion in Bengali.
- Structure: Open directly with the controversial or intriguing premise -> present both contrasting perspectives fairly with real substance -> conclude with a natural, open-ended question.
- Tone: Engaging, challenging, open-ended, and discussion-driving.`,

  tips: `WRITING STYLE REQUIREMENT: "পরামর্শ ও জীবনবোধ (Tips, Wisdom & Quotes)".
- Format: Practical life wisdom, productivity, or mental clarity insights.
- Structure: Open with a memorable insight -> share 2-3 concrete, actionable takeaways in clean sentences -> end with an inspiring thought.
- Tone: Grounded, authentic, practical, and uplifting without preachy clichés.`,

  facts: `WRITING STYLE REQUIREMENT: "আকর্ষণীয় তথ্য (Curated Facts Breakdown)".
- Format: Clean, high-curiosity facts in natural Bengali.
- Structure: Direct hook -> 3 truly surprising, verified facts (concise, clear, and specific) -> short closing takeaway.
- Anti-Slop: Cut fluff words, do NOT use exaggerated praise ("অনন্য কৃতিত্ব", "রহস্যময় ইঞ্জিন"), and limit emojis to 1 per fact.`,

  auto: `WRITING STYLE: "ন্যাচারাল ও হিউম্যান পোস্ট (Natural Human Voice - Anti-AI Slop)".
- Format: High-engagement Facebook post written like a real human creator, NOT an AI bot.
- Tone: Natural conversational Bengali, direct, grounded, and engaging.
- Structure:
  * Hook: Jump straight into the action, surprising fact, or core statement.
  * Flow: Write in 2-3 engaging, well-crafted paragraphs. Prefer natural storytelling and conversational flow over mechanical bullet lists.
  * Grounded Voice: Speak directly and authentically to the reader.`
};

/**
 * Extract recent topics from history to prevent repetitive generation
 */
async function getRecentTopicsFromHistory() {
  try {
    const history = (await storage.getHistory()) || [];
    const recent = history.slice(0, 25);
    const words = [];
    for (const h of recent) {
      if (h.message) {
        const firstLine = h.message.split('\n')[0].replace(/[#*`_~💎🧠🌊🏛️🐙🚀💻🥇🔴🔹•]/gu, '').trim();
        if (firstLine && firstLine.length > 4) {
          words.push(firstLine.slice(0, 45));
        }
      }
    }
    return words;
  } catch (e) {
    return [];
  }
}

/**
 * Dynamically pick or generate a fresh non-repeating topic
 */
async function pickOrGenerateDynamicTopic(categoryTitle = '', excludeList = [], geminiApiKey = '') {
  // 1. If Gemini API is available, try generating a 100% fresh unique topic
  if (geminiApiKey) {
    try {
      const exclusionNotice = excludeList.length > 0
        ? `CRITICAL REQUIREMENT: Do NOT generate a post about any of these recent topics: ${excludeList.slice(0, 8).join(' | ')}.`
        : '';
      const prompt = `You are a viral social media strategist. Suggest ONE unique, fascinating, high-engagement post topic in Bengali for the category: "${categoryTitle || 'General Trending / Science / History / Mind / Tech'}".
${exclusionNotice}
The topic should be fascinating, accurate, and captivating for a Facebook audience.

Respond ONLY with a valid JSON object:
{
  "angle": "বাংলায় আকর্ষণীয় টপিক ও মূল দিক (e.g. জেমস ওয়েব টেলিস্কোপের চোখে প্রাচীনতম গ্যালাক্সি)",
  "badge": "ক্যাটাগরি ব্যাজ (২-৩ শব্দ, যেমন: মহাকাশ বিজ্ঞান)",
  "search_term": "Ultra-detailed English photo search prompt for Flux/Unsplash"
}`;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`;
      const res = await axios.post(url, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.95 }
      }, { timeout: 6000 });
      const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        const parsed = extractJson(text);
        if (parsed && parsed.angle) {
          console.log('[ai] operation event');
          return parsed;
        }
      }
    } catch (e) {
      console.log('[ai] operation event');
    }
  }

  throw Object.assign(new Error('Dynamic topic generation failed; no fallback topic was selected.'), {statusCode:502,expose:true});
}

// ================= 4 SVG CARD LAYOUT BUILDERS =================
/**
 * Layout A: Classic 2-line Infographic Card
 */
function buildInfographicSvgOverlay({ width, height, badgeText, line1Red, line1White, line2White, line2Yellow, watermarkText }) {
  const pillTextLen = watermarkText.length;
  const textWidth = Math.max(140, Math.min(300, pillTextLen * 11 + 24));
  const pillTotalWidth = textWidth + 52;
  const pillStartX = Math.round((width - pillTotalWidth) / 2);

  return `
  <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bottomFade" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
        <stop offset="35%" stop-color="#000000" stop-opacity="0.25"/>
        <stop offset="65%" stop-color="#000000" stop-opacity="0.85"/>
        <stop offset="85%" stop-color="#000000" stop-opacity="0.97"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="1"/>
      </linearGradient>
      <linearGradient id="topFade" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#000000" stop-opacity="0.65"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
      </linearGradient>
      <filter id="textShadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#000000" flood-opacity="0.95"/>
      </filter>
    </defs>
    <rect x="0" y="0" width="${width}" height="180" fill="url(#topFade)"/>
    <rect x="0" y="460" width="${width}" height="620" fill="url(#bottomFade)"/>

    <g transform="translate(50, 45)">
      <rect width="215" height="42" rx="7" fill="#000000" fill-opacity="0.80" stroke="#475569" stroke-width="1.2"/>
      <g transform="translate(10, 10)">
        <rect width="22" height="22" rx="4" fill="none" stroke="#FDE047" stroke-width="1.8"/>
        <line x1="4" y1="8" x2="18" y2="8" stroke="#FDE047" stroke-width="1.8"/>
        <line x1="7" y1="2" x2="7" y2="5" stroke="#FDE047" stroke-width="2" stroke-linecap="round"/>
        <line x1="15" y1="2" x2="15" y2="5" stroke="#FDE047" stroke-width="2" stroke-linecap="round"/>
        <circle cx="8" cy="14" r="1.4" fill="#FDE047"/>
        <circle cx="14" cy="14" r="1.4" fill="#FDE047"/>
      </g>
      <text x="44" y="27" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans Bengali', sans-serif" font-size="16" font-weight="bold" fill="#FDE047">
        ${escapeXml(badgeText)}
      </text>
    </g>

    <g transform="translate(${pillStartX}, 765)">
      <path d="M 8 0 L ${textWidth} 0 L ${textWidth} 38 L 8 38 A 8 8 0 0 1 0 30 L 0 8 A 8 8 0 0 1 8 0 Z" fill="#0284C7"/>
      <text x="${Math.round(textWidth / 2)}" y="24" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="900" fill="#FFFFFF" text-anchor="middle" letter-spacing="0.8">
        ${escapeXml(watermarkText)}
      </text>
      <path d="M ${textWidth} 0 L ${pillTotalWidth - 8} 0 A 8 8 0 0 1 ${pillTotalWidth} 8 L ${pillTotalWidth} 30 A 8 8 0 0 1 ${pillTotalWidth - 8} 38 L ${textWidth} 38 Z" fill="#F59E0B"/>
      <g transform="translate(${textWidth + 14}, 9)">
        <rect x="2" y="2" width="14" height="17" rx="2" fill="none" stroke="#FFFFFF" stroke-width="1.6"/>
        <line x1="5" y1="6" x2="13" y2="6" stroke="#FFFFFF" stroke-width="1.4"/>
        <line x1="5" y1="10" x2="11" y2="10" stroke="#FFFFFF" stroke-width="1.4"/>
        <line x1="5" y1="14" x2="9" y2="14" stroke="#FFFFFF" stroke-width="1.4"/>
        <line x1="16" y1="4" x2="20" y2="1" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round"/>
      </g>
    </g>

    <g transform="translate(540, 885)" text-anchor="middle" filter="url(#textShadow)">
      <text x="0" y="0" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans Bengali', sans-serif" font-size="44" font-weight="900">
        <tspan fill="#EF4444">${escapeXml(line1Red)}</tspan>
        <tspan fill="#FFFFFF"> ${escapeXml(line1White)}</tspan>
      </text>
      <text x="0" y="65" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans Bengali', sans-serif" font-size="44" font-weight="900">
        <tspan fill="#FFFFFF">${escapeXml(line2White)} </tspan>
        <tspan fill="#FBBF24">${escapeXml(line2Yellow)}</tspan>
      </text>
    </g>
  </svg>`;
}

/**
 * Layout B: Minimalist Clean Photo with Dark Glass Headline Card
 */
function buildMinimalPhotoSvgOverlay({ width, height, badgeText, line1Red, line1White, line2White, line2Yellow, watermarkText }) {
  return `
  <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="minimalBottomFade" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
        <stop offset="40%" stop-color="#000000" stop-opacity="0.4"/>
        <stop offset="70%" stop-color="#000000" stop-opacity="0.85"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0.98"/>
      </linearGradient>
      <filter id="minShadow" x="-10%" y="-10%" width="120%" height="120%">
        <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000000" flood-opacity="0.9"/>
      </filter>
    </defs>
    <rect x="0" y="550" width="${width}" height="530" fill="url(#minimalBottomFade)"/>

    <g transform="translate(${width - 240}, 45)">
      <rect width="190" height="36" rx="18" fill="#000000" fill-opacity="0.6" stroke="#FFFFFF" stroke-opacity="0.25" stroke-width="1"/>
      <circle cx="20" cy="18" r="4" fill="#38BDF8"/>
      <text x="34" y="23" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="700" fill="#FFFFFF" letter-spacing="0.5">
        @${escapeXml(watermarkText)}
      </text>
    </g>

    <g transform="translate(60, 830)">
      <rect width="${width - 120}" height="190" rx="20" fill="#0F172A" fill-opacity="0.88" stroke="#334155" stroke-width="1.5" filter="url(#minShadow)"/>
      <rect x="25" y="24" width="130" height="26" rx="6" fill="#38BDF8" fill-opacity="0.2"/>
      <text x="35" y="42" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans Bengali', sans-serif" font-size="13" font-weight="bold" fill="#38BDF8">
        # ${escapeXml(badgeText)}
      </text>

      <g transform="translate(25, 95)">
        <text x="0" y="0" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans Bengali', sans-serif" font-size="38" font-weight="900" fill="#FFFFFF">
          <tspan fill="#38BDF8">${escapeXml(line1Red)}</tspan> ${escapeXml(line1White)}
        </text>
        <text x="0" y="48" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans Bengali', sans-serif" font-size="34" font-weight="700" fill="#E2E8F0">
          ${escapeXml(line2White)} <tspan fill="#FDE047">${escapeXml(line2Yellow)}</tspan>
        </text>
      </g>
    </g>
  </svg>`;
}

/**
 * Layout C: Centered Bold Quote / Wisdom Card
 */
function buildQuoteSvgOverlay({ width, height, badgeText, line1Red, line1White, line2White, line2Yellow, watermarkText }) {
  return `
  <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="quoteVignette" cx="50%" cy="50%" r="65%">
        <stop offset="0%" stop-color="#000000" stop-opacity="0.55"/>
        <stop offset="70%" stop-color="#000000" stop-opacity="0.88"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0.96"/>
      </radialGradient>
      <filter id="quoteGlow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000000" flood-opacity="0.95"/>
      </filter>
    </defs>
    <rect x="0" y="0" width="${width}" height="${height}" fill="url(#quoteVignette)"/>

    <text x="540" y="320" font-family="Georgia, serif" font-size="130" font-weight="bold" fill="#F59E0B" text-anchor="middle" fill-opacity="0.9" filter="url(#quoteGlow)">“</text>

    <g transform="translate(540, 480)" text-anchor="middle" filter="url(#quoteGlow)">
      <text x="0" y="0" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans Bengali', sans-serif" font-size="46" font-weight="900" fill="#FFFFFF">
        <tspan fill="#FBBF24">${escapeXml(line1Red)}</tspan> ${escapeXml(line1White)}
      </text>
      <text x="0" y="75" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans Bengali', sans-serif" font-size="44" font-weight="700" fill="#FFFFFF">
        ${escapeXml(line2White)} <tspan fill="#38BDF8">${escapeXml(line2Yellow)}</tspan>
      </text>
    </g>

    <g transform="translate(540, 750)" text-anchor="middle">
      <line x1="-120" y1="0" x2="-20" y2="0" stroke="#64748B" stroke-width="1.5"/>
      <text x="0" y="6" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans Bengali', sans-serif" font-size="20" font-weight="bold" fill="#FDE047">
        ${escapeXml(badgeText)}
      </text>
      <line x1="20" y1="0" x2="120" y2="0" stroke="#64748B" stroke-width="1.5"/>
    </g>

    <g transform="translate(540, 950)" text-anchor="middle">
      <rect x="-130" y="-22" width="260" height="38" rx="19" fill="#000000" fill-opacity="0.7" stroke="#475569" stroke-width="1"/>
      <text x="0" y="2" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="800" fill="#E2E8F0" letter-spacing="1">
        ${escapeXml(watermarkText)}
      </text>
    </g>
  </svg>`;
}

/**
 * Layout D: TV Lower-Third News Strip
 */
function buildNewsStripSvgOverlay({ width, height, badgeText, line1Red, line1White, line2White, line2Yellow, watermarkText }) {
  return `
  <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="newsFade" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
        <stop offset="40%" stop-color="#000000" stop-opacity="0.3"/>
        <stop offset="80%" stop-color="#000000" stop-opacity="0.9"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="1"/>
      </linearGradient>
      <filter id="newsShadow" x="-10%" y="-10%" width="120%" height="120%">
        <feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="#000000" flood-opacity="0.95"/>
      </filter>
    </defs>
    <rect x="0" y="550" width="${width}" height="530" fill="url(#newsFade)"/>

    <g transform="translate(50, 45)">
      <rect width="160" height="38" rx="6" fill="#DC2626" filter="url(#newsShadow)"/>
      <circle cx="20" cy="19" r="5" fill="#FFFFFF"/>
      <text x="36" y="25" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans Bengali', sans-serif" font-size="15" font-weight="900" fill="#FFFFFF" letter-spacing="1">
        ব্রেকিং নিউজ
      </text>
    </g>

    <g transform="translate(${width - 240}, 45)">
      <rect width="190" height="38" rx="6" fill="#000000" fill-opacity="0.75" stroke="#334155" stroke-width="1.2"/>
      <text x="95" y="24" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="900" fill="#F8FAFC" text-anchor="middle" letter-spacing="0.8">
        ${escapeXml(watermarkText)}
      </text>
    </g>

    <g transform="translate(0, 800)">
      <g transform="translate(50, -22)">
        <rect width="180" height="34" rx="4" fill="#B91C1C"/>
        <text x="90" y="22" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans Bengali', sans-serif" font-size="14" font-weight="bold" fill="#FFFFFF" text-anchor="middle">
          ${escapeXml(badgeText)}
        </text>
      </g>

      <rect x="40" y="14" width="${width - 80}" height="135" rx="10" fill="#0B132B" fill-opacity="0.96" stroke="#1E293B" stroke-width="2" filter="url(#newsShadow)"/>
      <line x1="40" y1="14" x2="40" y2="149" stroke="#DC2626" stroke-width="12"/>

      <text x="75" y="65" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans Bengali', sans-serif" font-size="38" font-weight="900" fill="#FFFFFF">
        <tspan fill="#EF4444">${escapeXml(line1Red)}:</tspan> ${escapeXml(line1White)}
      </text>

      <text x="75" y="118" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans Bengali', sans-serif" font-size="32" font-weight="700" fill="#FBBF24">
        ${escapeXml(line2White)} ${escapeXml(line2Yellow)}
      </text>

      <rect x="40" y="152" width="${width - 80}" height="28" rx="4" fill="#F59E0B"/>
      <text x="55" y="171" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans Bengali', sans-serif" font-size="14" font-weight="900" fill="#0F172A">
        বিশেষ বুলেটিন • সবার আগে সব খবর • নিয়মিত আপডেটের জন্য পেজে সঙ্গে থাকুন
      </text>
    </g>
  </svg>`;
}

class AIService {
  /**
   * Verify Google Gemini API Key
   */
  async verifyGeminiKey(apiKey) {
    if (!apiKey) throw new Error('API Key is required');
    const cleanKey = apiKey.trim();

    const candidateModels = ['gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.5-flash'];
    let lastError = null;

    for (const model of candidateModels) {
      try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cleanKey}`;
        const response = await axios.post(geminiUrl, {
          contents: [{ parts: [{ text: 'Reply: OK' }] }]
        }, { timeout: 8000 });

        console.log('[ai] operation event');
        return { valid: true, model: model, message: `Connected with Google Gemini (${model})` };
      } catch (err) {
        lastError = err;
      }
    }

    const msg = lastError?.response?.data?.error?.message || lastError?.message || 'Verification failed';
    throw new Error(`Gemini API Error: ${msg}`);
  }

  /**
   * Clean text of emoji characters for SVG typography rendering
   */
  cleanSvgText(str) {
    if (!str) return '';
    return str.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F018}-\u{1F270}\u{2388}\u{200D}\u{FE0F}]/gu, '')
              .replace(/[*_#`~]/g, '')
              .trim();
  }

  /**
   * Multimodal AI Template Analyzer:
   * Extracts visual layout, color palette, headline structure, and writing voice from an uploaded reference template
   */
  async analyzeTemplate(imageBufferOrUrl, sampleText = '') {
    const settings = (await storage.getSettings());
    const geminiApiKey = settings.geminiApiKey ? settings.geminiApiKey.trim() : '';

    let extracted = {
      visualStructure: 'Classic Infographic with 2-line bold headline and high-contrast badge',
      primaryColor: '#EF4444',
      headlineFormat: '2 punchy lines with key subject highlighted in red/accent and punchline in bright yellow',
      writingVoice: 'Engaging, direct, informative Bengali social media voice with natural flow and 2-3 tasteful emojis',
      summary: 'Clean, high-converting Facebook post template'
    };

    if (!geminiApiKey) {
      if (sampleText) {
        extracted.writingVoice = `Voice modeled after sample text: ${sampleText.slice(0, 120)}...`;
      }
      return extracted;
    }

    const candidateModels = ['gemini-2.5-flash', 'gemini-3.1-flash-lite'];
    for (const model of candidateModels) {
      try {
        const parts = [];
        let base64Image = null;
        let mimeType = 'image/jpeg';

        if (imageBufferOrUrl) {
          base64Image = (await media.load(imageBufferOrUrl)).toString('base64');
        }

        if (base64Image) {
          parts.push({
            inlineData: {
              mimeType: mimeType || 'image/jpeg',
              data: base64Image
            }
          });
        }

        const promptText = `You are an expert social media design and copy analyst.
Analyze this reference Facebook post thumbnail image and/or sample caption text:
${sampleText ? `Reference Caption Text:\n"""${sampleText}"""\n` : ''}

Your goal is to extract the EXACT stylistic rules so our AI generator can faithfully recreate posts in this template style.
Respond ONLY with a valid JSON object matching this schema:
{
  "visualStructure": "Detailed description of the card layout (e.g. 2-line bottom banner, top category pill, minimal photo card, quote vignette, etc.)",
  "primaryColor": "Dominant accent color hex code (e.g. #EF4444, #FBBF24, #3B82F6)",
  "headlineFormat": "How the headline is styled, broken into lines, and highlighted",
  "writingVoice": "Tone of voice (e.g. dramatic storytelling, direct news bulletin, thoughtful debate, educational tips, promotional), sentence cadence, opening hook, and emoji style",
  "summary": "1 concise sentence summarizing what makes this template distinct"
}`;
        parts.push({ text: promptText });

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;
        const res = await axios.post(url, {
          contents: [{ parts }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2
          }
        }, { timeout: 15000 });

        const raw = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (raw) {
          const parsed = extractJson(raw);
          if (parsed && (parsed.visualStructure || parsed.writingVoice)) {
            extracted = { ...extracted, ...parsed };
            console.log('[ai] operation event');
            break;
          }
        }
      } catch (err) {
        console.log('[ai] operation event');
      }
    }

    return extracted;
  }

  /**
   * Generate Structured Infographic Post & Card Data
   * Driven by Selected Page's System Prompt & Reference Template Few-Shot Learning
   */
  async generateStructuredPost(optionsOrTopic = '', categoryId = '', pageId = '', templateId = '', templateObj = null) {
    let topic = '';
    let category = categoryId;
    let targetPageId = pageId;
    let targetTemplateId = templateId;
    let template = templateObj;

    if (typeof optionsOrTopic === 'object' && optionsOrTopic !== null) {
      topic = optionsOrTopic.topic || '';
      category = optionsOrTopic.categoryId || optionsOrTopic.category || '';
      targetPageId = optionsOrTopic.pageId || '';
      targetTemplateId = optionsOrTopic.templateId || '';
      template = optionsOrTopic.template || optionsOrTopic.templateObj || null;
    } else {
      topic = optionsOrTopic || '';
    }

    const settings = (await storage.getSettings());
    const geminiApiKey = settings.geminiApiKey ? settings.geminiApiKey.trim() : '';
    const categories = (await storage.getCategories());

    let activeCategory = null;
    if (category) {
      activeCategory = categories.find(c => c.id === category);
    }

    // Dynamic Non-Repeating Topic Selection if user did not provide a specific topic
    let effectiveTopic = topic ? topic.trim() : '';
    let defaultBadge = activeCategory?.badge || 'আলোচিত সংবাদ';
    const isAutoTopic = !effectiveTopic;

    if (isAutoTopic) {
      const recentTopics = (await getRecentTopicsFromHistory());
      const dynamicTopicObj = await pickOrGenerateDynamicTopic(activeCategory?.title || '', recentTopics, geminiApiKey);
      effectiveTopic = dynamicTopicObj.angle;
      defaultBadge = activeCategory?.badge || dynamicTopicObj.badge;
    }

    // 1. Identify Target Page & its dedicated System Prompt
    const targetPage = targetPageId ? ((await storage.getPageById(targetPageId)) || (await storage.getActivePage())) : (await storage.getActivePage());
    const pageName = targetPage?.name || settings.pageName || 'Facebook Page';
    const pageSystemPrompt = (await storage.getPageSystemPrompt(targetPage?.id));

    // 2. Identify Reference Template & its Learned Profile
    if (!template && targetTemplateId) {
      template = (await storage.getTemplateById(targetTemplateId));
    }

    let templateGuidelines = '';
    if (template) {
      const learned = template.learnedStyle;
      templateGuidelines = `\n\nREFERENCE TEMPLATE LEARNING ("${template.title || 'Selected Template'}"):
The user has attached this reference template. You MUST strictly follow its layout, format, and tone:
${learned?.writingVoice ? `- Learned Writing Voice: ${learned.writingVoice}` : ''}
${learned?.visualStructure ? `- Learned Card Layout: ${learned.visualStructure}` : ''}
${template.sample ? `- Reference Caption Structure Example:\n"""\n${template.sample}\n"""` : ''}
Make sure the post caption and card headline mimic this exact structure and formatting!`;
    }

    console.log('[ai] operation event');

    const isCustomRequest = !isAutoTopic;
    const customIntentRule = isCustomRequest
      ? `\nUSER TOPIC / INSTRUCTION:
The user provided a specific topic / instruction: "${effectiveTopic}".
HONOR THE USER'S EXACT INTENT, TOPIC, AND DESIRED TONE (whether it is an educational post, story, breaking news, product promotion, sale/discount, holiday greeting, or opinion). Do NOT distort the user's intent into an unrelated subject!`
      : '';

    const systemPrompt = `You are the lead content creator and social media manager for the Facebook page "${pageName}".
Your task is to write an engaging, high-converting, viral Facebook post in natural Bengali based on the user's topic and instruction, AND formulate the matching 2-line headline card for the image thumbnail.

PAGE-SPECIFIC INSTRUCTIONS & CONTENT GUIDELINES (MANDATORY):
"${pageSystemPrompt}"
Strictly adhere to this page's niche, brand tone, audience profile, and content requirements!
${templateGuidelines}
${customIntentRule}

CRITICAL RULES:
1. Follow the page's guidelines and the user's topic faithfully, accurately, and engagingly.
2. Tone: Natural, engaging, authentic, and suitable for Facebook audiences.
3. The thumbnail headline card MUST have EXACTLY 2 short, punchy lines with key subject words highlighted:
   - "line1_red": The main subject or keyword in Bengali (rendered in Bold Accent Color #EF4444).
   - "line1_white": The remaining words of Line 1 in Bengali (White text).
   - "line2_white": The opening words of Line 2 in Bengali (White text).
   - "line2_yellow": The punchline, climax, or main takeaway in Bengali (rendered in Bright Yellow #FBBF24).
4. "search_term": Precise English search query to find or generate the matching high-res photo.
5. "badge": 2-3 words category badge in Bengali (e.g. "${defaultBadge}").
6. "post_caption": The complete Facebook post text in natural Bengali matching the page guidelines and reference template, with emojis and suitable hashtags for "${pageName}" (do NOT use #ParikshaNotes).
7. ANTI-AI SLOP & NATURAL HUMAN VOICE RULES:
   - NO THROAT-CLEARING: NEVER use introductory filler like "চলুন জেনে নিই...", "আজকে আমরা কথা বলব...", "জানুন কিছু অজানা তথ্য:", "এখানে জরুরি কিছু তথ্য দেওয়া হলো: 👇". Start immediately with the core event, fact, or story.
   - NO FORMATTING SLOP: Do NOT spam emojis on every single line or bullet. Use only 2-3 tasteful emojis across the entire post. Never use bold bullet headers like "**ভারতের প্রথম সৌর মিশন:**" on every point.
   - NO IMPORTANCE PUFFERY: Avoid dramatic clichés like "মুকুটে জুড়ল আরও একটি পালক", "এক যুগান্তকারী মোড়", "ইতিহাসের এক অবিস্মরণীয় অধ্যায়", "অনন্য কৃতিত্ব", "প্রকৃতির এক রহস্যময় ইঞ্জিন". Let concrete facts carry the weight.
   - NO RHETORICAL SETUPS: Do NOT use fake drama like "🤔 হ্যাঁ, আমরা কথা বলছি ... নিয়ে!".
   - NO CANNED ENGAGEMENT BAIT: Do NOT end with generic bot questions like "আপনার কী মনে হয়? নিচে কমেন্টে জানান! 👇" or "কমেন্টে আপনার শুভকামনা জানান! 💬👇". End with an authentic personal thought, concrete takeaway, or stop cleanly.

Output MUST be a single valid JSON object with keys:
{
  "badge": "...",
  "line1_red": "...",
  "line1_white": "...",
  "line2_white": "...",
  "line2_yellow": "...",
  "search_term": "...",
  "post_caption": "..."
}`;

    const uniqueSeed = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const userPrompt = isCustomRequest
      ? `Generate an authentic, engaging Facebook post for: "${effectiveTopic}".
Category: ${activeCategory?.title || defaultBadge}.
Seed: ${uniqueSeed}.
Respond ONLY with the JSON object.`
      : `Generate a completely UNIQUE, FASCINATING, and BRAND NEW viral post for: "${effectiveTopic}".
Category: ${activeCategory?.title || defaultBadge}.
Random Seed: ${uniqueSeed}. Make sure this is completely different and fresh.
Respond ONLY with the JSON object.`;

    let result = null;

    // 1. Google Gemini API with fallback cascade
    if (geminiApiKey) {
      const candidateModels = ['gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.5-flash'];
      for (const model of candidateModels) {
        try {
          console.log('[ai] operation event');
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;
          const response = await axios.post(geminiUrl, {
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ parts: [{ text: userPrompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.95,
              maxOutputTokens: 1500
            }
          }, { timeout: 15000 });

          const rawText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawText) {
            const parsed = extractJson(rawText);
            if (parsed && ['line1_red','post_caption','search_term'].every(k=>typeof parsed[k]==='string'&&parsed[k].trim()) && ['badge','line1_white','line2_white','line2_yellow'].every(k=>parsed[k]===undefined||typeof parsed[k]==='string')) {
              result = parsed;
              console.log('[ai] operation event');
              break;
            }
          }
        } catch (err) {
          console.log('[ai] operation event');
        }
      }
    }

    if (!result) throw Object.assign(new Error('AI generation failed. Check your Gemini key and retry.'), { statusCode: 502, expose: true });

    return result;
  }

  /**
   * Fetch genuine, high-res photograph related to the topic/person
   */
  async fetchSmartBackground(searchTerm, topic = '', variation = 0, styleMode = 'auto', customPrompt = '') {
    const term = (customPrompt || searchTerm || topic || '').trim();
    if(!term)throw Object.assign(new Error('Topic-matched image prompt is required'),{statusCode:502,expose:true});
    console.log('[ai] operation event');

    const BROWSER_HEADERS = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
    };
    const WIKI_HEADERS = {
      'User-Agent': 'ParikshaNotesBot/1.0 (https://parikshanotes.com; info@parikshanotes.com)'
    };

    // Mode A: Flux AI Photorealistic Generation (Default for 'auto' or 'flux' - exactly matches topic)
    if (styleMode === 'flux' || styleMode === 'auto') {
      try {
        const seed = Math.floor(Math.random() * 1000000) + variation * 7919;
        const fluxPrompt = `professional hyperrealistic cinematic photograph of ${term}, 8k sharp focus, high detail, dramatic lighting, award-winning national geographic style`;
        const fluxUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(fluxPrompt)}?width=1080&height=1080&model=flux&nologo=true&seed=${seed}`;
        const fluxRes = await Promise.resolve({data: await media.remoteImage(fluxUrl)});
        if (fluxRes.data && fluxRes.data.length > 5000) {
          console.log('[ai] operation event');
          return Buffer.from(fluxRes.data);
        }
      } catch (err) {
        console.log('[ai] operation event');
      }
    }

    // Mode B: Wikipedia Press/Historical Photos (default for real persons & heritage)
    if (styleMode !== 'flux' && term.length > 2) {
      try {
        const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(term)}&gsrlimit=10&prop=pageimages&pithumbsize=1200&format=json`;
        const wikiRes = await axios.get(wikiUrl, { headers: WIKI_HEADERS, timeout: 7000 });
        const pages = wikiRes.data?.query?.pages;
        if (pages) {
          const validPages = Object.values(pages).filter(p => p?.thumbnail?.source);
          if (validPages.length > 0) {
            const chosenPage = validPages[variation % validPages.length];
            const imgUrl = chosenPage?.thumbnail?.source;
            if (imgUrl) {
              console.log('[ai] operation event');
              const imgRes = await Promise.resolve({data: await media.remoteImage(imgUrl)});
              if (imgRes.data && imgRes.data.length > 5000) {
                return Buffer.from(imgRes.data);
              }
            }
          }
        }
      } catch (wikiErr) {
        console.log('[ai] operation event');
      }
    }

    // Mode C: Try Unsplash targeted keyword fetch with variation seed
    try {
      const unsplashUrl = `https://images.unsplash.com/featured/?${encodeURIComponent(term)}&sig=${Date.now() + variation * 888}`;
      const unsplashRes = await Promise.resolve({data: await media.remoteImage(unsplashUrl)});
      if (unsplashRes.data && unsplashRes.data.length > 10000) {
        console.log('[ai] operation event');
        return Buffer.from(unsplashRes.data);
      }
    } catch (e) {
      // ignore
    }

    throw Object.assign(new Error('No topic-matched image could be prepared. Nothing was published.'), {statusCode:502,expose:true});
  }

  /**
   * Generate Infographic Thumbnail Card matching exact reference design
   */
  async generateThumbnailCardFromData(cardData, topic = '', variation = 0, styleMode = 'auto', customPrompt = '', templateImage = null, cardLayout = 'auto', postStyle = 'auto') {
    const width = 1080;
    const height = 1080;

    const badgeText = this.cleanSvgText(cardData.badge) || 'আলোচিত তথ্য';
    const line1Red = this.cleanSvgText(cardData.line1_red) || 'ব্রেকিং নিউজ';
    const line1White = this.cleanSvgText(cardData.line1_white) || '';
    const line2White = this.cleanSvgText(cardData.line2_white) || '';
    const line2Yellow = this.cleanSvgText(cardData.line2_yellow) || '';

    // Determine layout
    let effectiveLayout = cardLayout;
    if (!effectiveLayout || effectiveLayout === 'auto') {
      if (postStyle === 'quote' || postStyle === 'tips') {
        effectiveLayout = 'quote';
      } else if (postStyle === 'news') {
        effectiveLayout = 'news_strip';
      } else if (postStyle === 'story') {
        effectiveLayout = 'minimal';
      } else {
        const layoutPool = ['infographic', 'minimal', 'news_strip'];
        effectiveLayout = layoutPool[variation % layoutPool.length];
      }
    }

    let rawBg = templateImage ? await media.load(templateImage) : null;

    if (!rawBg) {
      rawBg = await this.fetchSmartBackground(cardData.search_term, topic, variation, styleMode, customPrompt);
    }

    const resizedBg = await sharp(rawBg, { limitInputPixels: 25000000 })
      .resize(width, height, { fit: 'cover' })
      .toBuffer();

    const activePage = (await storage.getActivePage());
    const settings = (await storage.getSettings());
    const watermarkText = (activePage?.name || settings.pageName || 'FACEBOOK').toUpperCase();

    const svgParams = {
      width,
      height,
      badgeText,
      line1Red,
      line1White,
      line2White,
      line2Yellow,
      watermarkText
    };

    let svgOverlay;
    switch (effectiveLayout) {
      case 'minimal':
        svgOverlay = buildMinimalPhotoSvgOverlay(svgParams);
        break;
      case 'quote':
        svgOverlay = buildQuoteSvgOverlay(svgParams);
        break;
      case 'news_strip':
        svgOverlay = buildNewsStripSvgOverlay(svgParams);
        break;
      case 'infographic':
      default:
        svgOverlay = buildInfographicSvgOverlay(svgParams);
        break;
    }

    try {
      const output = await sharp(resizedBg)
        .composite([{ input: Buffer.from(svgOverlay), top: 0, left: 0 }])
        .jpeg({ quality: 95 })
        .toBuffer();

      const asset = await media.store(output);
      return { success: true, ...asset, layout: effectiveLayout };
    } catch (err) {
      console.log('[ai] operation event');
      throw Object.assign(new Error('Image rendering failed. Nothing was published.'), {statusCode:502,expose:true});
    }
  }

  /**
   * Main Generator Entry: Generates Full Bundle (Viral Post + Reference-Style Thumbnail Card)
   */
  async generateFullPostBundle(options = {}) {
    const { topic = '', categoryId = '', pageId = '', templateId = '', templateImage = null, includeImage = true, templateObj = null } = options;
    const categories = (await storage.getCategories());
    const category = categoryId ? categories.find(c => c.id === categoryId) : null;

    let targetTemplate = templateObj;
    if (!targetTemplate && templateId) {
      targetTemplate = (await storage.getTemplateById(templateId));
    }
    const effectiveTemplateImage = templateImage || targetTemplate?.imageUrl || null;

    console.log('[ai] operation event');

    // Generate structured data using Page System Prompt and Template Learning
    const structuredData = await this.generateStructuredPost({
      topic,
      categoryId,
      pageId,
      templateId,
      templateObj: targetTemplate
    });

    let imageResult = null;
    if (includeImage) {
      imageResult = await this.generateThumbnailCardFromData(
        structuredData,
        topic,
        0,
        'auto',
        '',
        effectiveTemplateImage
      );
    }

    if (includeImage && !imageResult?.url) throw Object.assign(new Error('Requested image is unavailable'), {statusCode:502,expose:true});
    return {
      message: structuredData.post_caption,
      category: category ? { id: category.id, title: category.title } : null,
      cardData: {
        badge: structuredData.badge,
        line1_red: structuredData.line1_red,
        line1_white: structuredData.line1_white,
        line2_white: structuredData.line2_white,
        line2_yellow: structuredData.line2_yellow,
        search_term: structuredData.search_term
      },
      image: imageResult ? {
        url: imageResult.url,
        localPath: imageResult.localPath,
        fileName: imageResult.fileName,
        layout: imageResult.layout
      } : null
    };
  }

  /**
   * Regenerate Thumbnail ONLY matching the exact reference template
   * Does NOT touch or regenerate the post message / caption
   */
  async regenerateThumbnailOnly(options = {}) {
    const { topic = '', cardData = null, customPrompt = '', styleMode = 'auto', pageId = '', templateId = '', variation = 1, templateImage = null } = options;
    
    let targetTemplate = null;
    if (templateId) {
      targetTemplate = (await storage.getTemplateById(templateId));
    }
    const effectiveTemplateImage = templateImage || targetTemplate?.imageUrl || null;

    let activeCardData = cardData;
    if (!activeCardData || !activeCardData.line1_red) {
      const generated = await this.generateStructuredPost({ topic, pageId, templateId });
      activeCardData = {
        badge: generated.badge,
        line1_red: generated.line1_red,
        line1_white: generated.line1_white,
        line2_white: generated.line2_white,
        line2_yellow: generated.line2_yellow,
        search_term: customPrompt || generated.search_term
      };
    } else if (customPrompt) {
      activeCardData.search_term = customPrompt;
    }

    console.log('[ai] operation event');
    const imageResult = await this.generateThumbnailCardFromData(activeCardData, topic, variation, styleMode, customPrompt, effectiveTemplateImage);
    return {
      cardData: activeCardData,
      image: imageResult,
      cardLayout: imageResult?.layout || 'infographic'
    };
  }

  /**
   * Regenerate Caption ONLY based on topic or current text
   * Does NOT regenerate or change the image
   */
  async regenerateCaptionOnly(options = {}) {
    const { topic = '', currentMessage = '', pageId = '', templateId = '', variation = 1 } = options;
    const settings = (await storage.getSettings());
    const targetPage = pageId ? ((await storage.getPageById(pageId)) || (await storage.getActivePage())) : (await storage.getActivePage());
    const pageName = targetPage?.name || settings.pageName || 'Facebook Page';
    const pageSystemPrompt = (await storage.getPageSystemPrompt(targetPage?.id));
    const geminiApiKey = settings.geminiApiKey ? settings.geminiApiKey.trim() : '';

    let templateGuidelines = '';
    if (templateId) {
      const template = (await storage.getTemplateById(templateId));
      if (template) {
        templateGuidelines = `\n\nREFERENCE TEMPLATE: "${template.title}".
Adopt this template's writing voice: ${template.learnedStyle?.writingVoice || ''}
${template.sample ? `Reference sample:\n"""${template.sample}"""` : ''}`;
      }
    }

    const systemPrompt = `You are a social media copywriter and content manager for the Facebook page "${pageName}".
Your task is to write a fresh, creative, engaging Facebook post in natural Bengali.

PAGE-SPECIFIC STRATEGY & INSTRUCTIONS (MANDATORY):
"${pageSystemPrompt}"
Strictly adhere to this page's niche, tone, topics, and rules!
${templateGuidelines}

CRITICAL RULES:
1. Provide a completely new, engaging angle/hook different from the previous version.
2. Follow the page's guidelines and any reference template style faithfully.
3. ANTI-AI SLOP & NATURAL HUMAN VOICE: No throat-clearing openers ("চলুন জেনে নিই..."), no emoji spam on every line (2-3 max for entire post), no fake engagement bait questions ("নিচে কমেন্টে জানান 👇"), and no dramatic clichés ("মুকুটে জুড়ল নতুন পালক"). Write in grounded, authentic human Bengali.
4. Include clean formatting and suitable hashtags for "${pageName}" (do NOT use #ParikshaNotes).
5. Respond ONLY with the ready-to-post Bengali Facebook post text. Do not output markdown code blocks or JSON.`;

    const userPrompt = `Topic or context: "${topic || (currentMessage ? currentMessage.slice(0, 150) : 'আজকের আলোচিত খবর ও তথ্য')}".
Variation seed: ${Date.now()}_${variation * 101}.
Write a completely fresh, brand new engaging post in natural Bengali.`;

    let newCaption = null;

    if (geminiApiKey) {
      const models = ['gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-3.5-flash-lite'];
      for (const m of models) {
        try {
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${geminiApiKey}`;
          const res = await axios.post(geminiUrl, {
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ parts: [{ text: userPrompt }] }],
            generationConfig: { temperature: 0.95 + (variation % 3) * 0.05, maxOutputTokens: 1200 }
          }, { timeout: 12000 });
          const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text && text.length > 30) {
            newCaption = text.trim();
            break;
          }
        } catch (e) {
          console.log('[ai] operation event');
        }
      }
    }

    if (!newCaption) throw Object.assign(new Error('Caption generation failed. Check your Gemini key and retry.'), {statusCode:502,expose:true});
    return { success: true, message: newCaption };
  }

  /**
   * Generates a curated list of viral, high-CTR content topic ideas
   */
  async generateTopicIdeas({ category = '', keyword = '', count = 6 } = {}) {
    const settings = (await storage.getSettings());
    const geminiApiKey = settings.geminiApiKey ? settings.geminiApiKey.trim() : '';
    const categories = (await storage.getCategories());

    const activePage = (await storage.getActivePage());
    const pageName = activePage?.name || settings.pageName || "Facebook Page";
    let targetCategory = null;
    if (category) {
      targetCategory = categories.find(c => c.id === category || c.title.includes(category));
    }

    const categoryText = targetCategory ? targetCategory.title : (category || 'বিজ্ঞান, ইতিহাস, প্রযুক্তি ও প্রকৃতি');
    const keywordText = keyword ? keyword.trim() : '';

    const systemPrompt = `You are the chief content strategist for the Facebook page "${pageName}".
Your task is to generate ${count} completely unique, irresistible, and viral topic ideas for Facebook posts.
Bengali audience loves fascinating science, space mysteries, brain hacks, ancient history, deep ocean, and strange nature facts.

Output format MUST be a valid JSON array containing ${count} objects with these exact keys:
[
  {
    "id": "idea_1",
    "title": "à¦†à¦•à¦°à§�à¦·à¦£à§€à¦¯à¦¼ à¦“ à¦›à§‹à¦Ÿ à¦¶à¦¿à¦°à§‹à¦¨à¦¾à¦® (à¦¬à¦¾à¦‚à¦²à¦¾à§Ÿ, à§®-à§§à§ª à¦¶à¦¬à§�à¦¦)",
    "hook": "à§§ à¦²à¦¾à¦‡à¦¨à§‡ à¦�à¦‡ à¦¬à¦¿à¦·à§Ÿà§‡à¦° à¦°à§‹à¦®à¦¾à¦žà§�à¦šà¦•à¦° à¦ªà§Ÿà§‡à¦¨à§�à¦Ÿ à¦¯à¦¾ à¦œà¦¾à¦¨à¦²à§‡ à¦ªà¦¾à¦ à¦• à¦šà¦®à¦•à§‡ à¦¯à¦¾à¦¬à§‡ (à¦¬à¦¾à¦‚à¦²à¦¾à§Ÿ)",
    "badge": "à¦•à§�à¦¯à¦¾à¦Ÿà¦¾à¦—à¦°à¦¿ à¦¬à§�à¦¯à¦¾à¦œ (à§¨-à§© à¦¶à¦¬à§�à¦¦, à¦¯à§‡à¦®à¦¨: à¦®à¦¹à¦¾à¦•à¦¾à¦¶ à¦¬à¦¿à¦œà§�à¦žà¦¾à¦¨, à¦®à¦¨à¦¸à§�à¦¤à¦¤à§�à¦¤à§�à¦¬, à¦—à¦­à§€à¦° à¦¸à¦®à§�à¦¦à§�à¦°, à¦ªà§�à¦°à¦¾à¦šà§€à¦¨ à¦‡à¦¤à¦¿à¦¹à¦¾à¦¸, à¦ªà§�à¦°à¦¯à§�à¦•à§�à¦¤à¦¿)",
    "emoji": "ðŸŒŒ",
    "search_keyword": "English keyword for finding photos"
  }
]`;

    const userPrompt = `Generate ${count} fresh, viral topic ideas.
Category: ${categoryText}.
Keyword/Angle (if provided): ${keywordText || 'Trending & Fascinating wonders'}.
Seed: ${Date.now()}_${Math.floor(Math.random() * 10000)}.
Make sure each topic is completely distinct and engaging. Return ONLY the JSON array.`;

    let topics = null;

    if (geminiApiKey) {
      const models = ['gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-3.5-flash-lite'];
      for (const model of models) {
        try {
          console.log('[ai] operation event');
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;
          const response = await axios.post(geminiUrl, {
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ parts: [{ text: userPrompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.95,
              maxOutputTokens: 1200
            }
          }, { timeout: 12000 });

          const rawText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawText) {
            const parsed = extractJson(rawText);
            if (Array.isArray(parsed) && parsed.length > 0) {
              topics = parsed;
              console.log('[ai] operation event');
              break;
            }
          }
        } catch (err) {
          console.log('[ai] operation event');
        }
      }
    }

    if (!topics?.length) throw Object.assign(new Error('Topic generation failed. Check your Gemini key and retry.'), {statusCode:502,expose:true});
    return topics;
  }

  /**
   * Backward Compatibility helper
   */
  async generatePostText(topic = '', categoryId = '') {
    const data = await this.generateStructuredPost({topic, categoryId});
    return data.post_caption;
  }
}

function escapeXml(unsafe) {
  if (!unsafe) return '';
  return unsafe.toString().replace(/[<>&'"]/g, function (c) {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
  });
}

module.exports = new AIService();
