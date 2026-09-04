const axios = require('axios');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const storage = require('./storage');
const { FALLBACK_VIRAL_POSTS, getFallbackForCategory, getFallbacks } = require('./ai/fallbacks');
const { buildPageContext } = require('./ai/page-context');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Curated Ultra-HD Thematic Background Pools
const THEMATIC_BG_POOLS = {
  sports: [
    'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?auto=format&fit=crop&w=1080&h=1080&q=85',
    'https://images.unsplash.com/photo-1517649763962-0c623266ddc0?auto=format&fit=crop&w=1080&h=1080&q=85',
    'https://images.unsplash.com/photo-1541534741688-6078c6bfb5c5?auto=format&fit=crop&w=1080&h=1080&q=85'
  ],
  news: [
    'https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=1080&h=1080&q=85',
    'https://images.unsplash.com/photo-1495020689067-958852a7765e?auto=format&fit=crop&w=1080&h=1080&q=85',
    'https://images.unsplash.com/photo-1585829365295-ab7cd400c167?auto=format&fit=crop&w=1080&h=1080&q=85',
    'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1080&h=1080&q=85'
  ],
  space: [
    'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1080&h=1080&q=85',
    'https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?auto=format&fit=crop&w=1080&h=1080&q=85',
    'https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?auto=format&fit=crop&w=1080&h=1080&q=85'
  ],
  brain: [
    'https://images.unsplash.com/photo-1507499739999-097706ad8914?auto=format&fit=crop&w=1080&h=1080&q=85',
    'https://images.unsplash.com/photo-1501504905252-473c47e087f8?auto=format&fit=crop&w=1080&h=1080&q=85'
  ],
  nature: [
    'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?auto=format&fit=crop&w=1080&h=1080&q=85',
    'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1080&h=1080&q=85'
  ],
  history: [
    'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?auto=format&fit=crop&w=1080&h=1080&q=85',
    'https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?auto=format&fit=crop&w=1080&h=1080&q=85'
  ],
  tech: [
    'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1080&h=1080&q=85',
    'https://images.unsplash.com/photo-1532094349884-543bc11b234d?auto=format&fit=crop&w=1080&h=1080&q=85'
  ]
};

const DYNAMIC_TOPIC_ANGLES = [
  // 1. মহাকাশ ও বিজ্ঞান (Space & Cosmos)
  { angle: 'জেমস ওয়েব স্পেস টেলিস্কোপের চোখে মহাবিশ্বের প্রাচীনতম গ্যালাক্সির জন্ম (James Webb Space Telescope oldest galaxy discovery)', badge: 'মহাকাশ বিজ্ঞান' },
  { angle: 'ব্ল্যাক হোলের ভেতর কী ঘটে এবং ইভেন্ট হরাইজনের মহাকর্ষীয় রহস্য (Black Hole singularity event horizon astrophysics)', badge: 'মহাকাশ বিজ্ঞান' },
  { angle: 'বৃহস্পতির উপগ্রহ ইউরোপা ও তার বরফের স্তরের নিচের রহস্যময় মহাসাগর (Jupiter moon Europa subsurface alien ocean)', badge: 'মহাকাশ বিজ্ঞান' },
  { angle: 'অ্যান্ড্রোমিডা গ্যালাক্সি ও আকাশগঙ্গার সম্ভাব্য মহা-সংঘর্ষের ভবিষ্যৎ (Andromeda Milky Way galaxy collision)', badge: 'মহাকাশ বিজ্ঞান' },
  { angle: 'সৌরজগতের বাইরে বাসযোগ্য অদ্ভুত এক্সোপ্ল্যানেট ও প্রাণের সম্ভাবনা (Habitable goldilocks zone exoplanet discovery)', badge: 'মহাকাশ বিজ্ঞান' },
  { angle: 'নিউট্রন স্টার ও ম্যাগনেটার: মহাবিশ্বের সবচেয়ে শক্তিশালী চৌম্বক ক্ষেত্র (Neutron star magnetar cosmic explosion)', badge: 'মহাকাশ বিজ্ঞান' },

  // 2. মনস্তত্ত্ব ও মস্তিষ্ক (Psychology & Brain)
  { angle: 'মানব মস্তিষ্কের সাবকনশাস মাইন্ডের অবিশ্বাস্য ক্ষমতা ও সাইকোলজি ট্রিকস (Subconscious mind power psychology tricks)', badge: 'মনস্তত্ত্ব ও মস্তিষ্ক' },
  { angle: 'ডেজা ভ্যু (Déjà vu) কেন ঘটে? বিজ্ঞানীদের চোখ ধাঁধানো ব্যাখ্যা (Deja vu psychology brain memory illusion)', badge: 'মনস্তত্ত্ব ও মস্তিষ্ক' },
  { angle: 'স্লিপ প্যারালাইসিস ও স্বপ্নের অদ্ভুত স্নায়বিক জগৎ (Sleep paralysis neuroscience and REM dream state)', badge: 'মনস্তত্ত্ব ও মস্তিষ্ক' },
  { angle: 'মানুষের বডি ল্যাঙ্গুয়েজ ও চোখের ভাষা বোঝার পরীক্ষিত মনস্তাত্ত্বিক নিয়ম (Body language micro-expressions psychology)', badge: 'মনস্তত্ত্ব ও মস্তিষ্ক' },
  { angle: 'মিউজিক কীভাবে মস্তিষ্কের নিউরন ও অনুভূতি নিয়ন্ত্রণ করে (Music impact on brain emotion neuroscience)', badge: 'মনস্তত্ত্ব ও মস্তিষ্ক' },
  { angle: 'অভ্যাসের বিজ্ঞান ও সাইকোলজিক্যাল ২১ দিনের হ্যাবিট লুপ (Science of habit formation dopamine loop)', badge: 'মনস্তত্ত্ব ও মস্তিষ্ক' },

  // 3. প্রকৃতির বিস্ময় ও ভূবিজ্ঞান (Nature & Earth)
  { angle: 'মারিয়ানা ট্রেঞ্চের অতল অন্ধকারে সূর্যের আলো ছাড়া বেঁচে থাকা অদ্ভুত প্রাণী (Mariana trench deep sea bioluminescence creatures)', badge: 'প্রকৃতির বিস্ময়' },
  { angle: 'বারমুডা ট্রায়াঙ্গেলের রহস্য ও আধুনিক বিজ্ঞানীদের ব্যাখ্যা (Bermuda Triangle ocean navigation mystery science)', badge: 'প্রকৃতির বিস্ময়' },
  { angle: 'সাহারা মরুভূমির বালুর নিচে লুকিয়ে থাকা প্রাচীন ভূগর্ভস্থ নদী ও লেক (Sahara desert ancient hidden underground rivers)', badge: 'প্রকৃতির বিস্ময়' },
  { angle: 'ভেনেজুয়েলার ক্যাটাতুম্বো লাইটনিং: বছরের ৩০০ দিন অবিরাম বজ্রপাতের স্থান (Catatumbo perpetual lightning storm Venezuela)', badge: 'প্রকৃতির বিস্ময়' },
  { angle: 'মাউন্ট এভারেস্টের উচ্চতা কেন প্রতি বছর একটু একটু করে বৃদ্ধি পাচ্ছে (Mount Everest tectonic plate movement elevation rise)', badge: 'প্রকৃতির বিস্ময়' },
  { angle: 'অ্যামাজন রেইনফরেস্টের গহীন জঙ্গলের অজানা রহস্য ও জীববৈচিত্র্য (Amazon rainforest biodiversity indigenous mysteries)', badge: 'প্রকৃতির বিস্ময়' },

  // 4. প্রাচীন ইতিহাস ও প্রত্নতত্ত্ব (History & Archaeology)
  { angle: 'প্রাচীন নালন্দা বিশ্ববিদ্যালয় ও পৃথিবীর শ্রেষ্ঠ জ্ঞানকেন্দ্রের ইতিহাস (Ancient Nalanda University historical grandeur)', badge: 'ইতিহাসের রহস্য' },
  { angle: 'মিশরের গিজা পিরামিডের প্রকৌশল বিস্ময় ও অমীমাংসিত রহস্য (Great Pyramid of Giza engineering mystery ancient Egypt)', badge: 'ইতিহাসের রহস্য' },
  { angle: 'সিন্ধু সভ্যতা ও মহেঞ্জোদারোর পরিকল্পিত ড্রেনেজ ও আধুনিক নগর ব্যবস্থা (Indus Valley Civilization Harappa Mohenjo-daro)', badge: 'ইতিহাসের রহস্য' },
  { angle: 'সম্রাট অশোকের কলিঙ্গ যুদ্ধ ও অস্ত্র ত্যাগ করে শান্তির ধর্ম গ্রহণের ইতিহাস (Emperor Ashoka Kalinga war transformation Buddhism)', badge: 'ইতিহাসের রহস্য' },
  { angle: 'টাইটানিক জাহাজের ধ্বংসাবশেষ ও সেই ঐতিহাসিক রাতের অজানা বাস্তবতা (Titanic shipwreck ocean deep historic expedition)', badge: 'ইতিহাসের রহস্য' },
  { angle: 'মায়া সভ্যতার ক্যালেন্ডার ও হঠাৎ বিলুপ্তির পেছনের ঐতিহাসিক কারণ (Ancient Maya civilization pyramids ruins calendar)', badge: 'ইতিহাসের রহস্য' },

  // 5. ভারতীয় বিজ্ঞান ও গৌরব (Indian Science & Innovation)
  { angle: 'ইসরোর চন্দ্রযান ও মঙ্গলযানের অবিশ্বাস্য স্বল্প খরচে বিশ্বজয়ের কাহিনী (ISRO Chandrayaan Mangalyaan space mission achievement)', badge: 'ভারতীয় বিজ্ঞান' },
  { angle: 'আচার্য জগদীশ চন্দ্র বসুর উদ্ভিদের প্রাণ ও রেডিও তরঙ্গ আবিষ্কারের ইতিহাস (Acharya Jagadish Chandra Bose plant response radio waves)', badge: 'ভারতীয় বিজ্ঞান' },
  { angle: 'গণিতবিদ শ্রীনিবাস রামানুজনের ঐশ্বরিক ম্যাথমেটিক্যাল ফর্মুলার রহস্য (Srinivasa Ramanujan mathematical genius infinity)', badge: 'ভারতীয় বিজ্ঞান' },
  { angle: 'ভারতের দেশীয় সুপারকম্পিউটার ও তথ্যপ্রযুক্তি বিপ্লবের গৌরবগাথা (Indian indigenous supercomputer PARAM technology revolution)', badge: 'ভারতীয় বিজ্ঞান' },
  { angle: 'ড. এ পি জে আবদুল কালাম ও ভারতের মহাকাশ ও মিসাইল বিপ্লবের রূপকথা (Dr APJ Abdul Kalam missile technology inspiration)', badge: 'ভারতীয় বিজ্ঞান' },
  { angle: 'প্রাচীন ভারতে শল্যচিকিৎসার জনক সুশ্রুত ও আয়ুর্বেদের বৈজ্ঞানিক ভিত্তি (Ancient Indian medicine Sushruta Ayurveda historic heritage)', badge: 'ভারতীয় বিজ্ঞান' },

  // 6. বন্যপ্রাণী ও জীবজগৎ (Wildlife & Biology)
  { angle: 'অক্টোপাসের ৩টি হৃৎপিণ্ড, ৯টি মস্তিষ্ক ও নীল রক্তের অবিশ্বাস্য শারীরবৃত্ত (Intelligent octopus underwater camouflage blue blood)', badge: 'বন্যপ্রাণী তথ্য' },
  { angle: 'টারডিগ্রেড বা জলভালুক: মহাকাশের শূন্যতাতেও বেঁচে থাকা অমর প্রাণী (Tardigrade water bear microscopic extreme survival resilience)', badge: 'বন্যপ্রাণী তথ্য' },
  { angle: 'ডলফিনের অবিশ্বাস্য বুদ্ধিমত্তা ও সাগরে একে অপরের নাম ধরে ডাকার কৌশল (Dolphin intelligence underwater communication vocal signature)', badge: 'বন্যপ্রাণী তথ্য' },
  { angle: 'সুন্দরবনের রয়েল বেঙ্গল টাইগারের নোনাজলে সাঁতার ও শিকারের কৌশল (Royal Bengal Tiger Sundarbans mangrove swamp swimming)', badge: 'বন্যপ্রাণী তথ্য' },
  { angle: 'পরিযায়ী পাখিদের হাজার হাজার মাইল পথ চিনে ওড়ার গোপন ম্যাগনেটিক কম্পাস (Migratory birds navigation earth magnetic field)', badge: 'বন্যপ্রাণী তথ্য' },
  { angle: 'পিঁপড়ের সুশৃঙ্খল কলোনি ও নিজেদের ওজনের ৫০ গুণ বহনের অবিশ্বাস্য শক্তি (Ant colony super-organism strength cooperative behavior)', badge: 'বন্যপ্রাণী তথ্য' },

  // 7. আধুনিক প্রযুক্তি ও AI (Technology & AI)
  { angle: 'কৃত্রিম বুদ্ধিমত্তা (AI) ও রোবোটিক্স কীভাবে আগামী দশকে পেশাজগৎ বদলে দেবে (Artificial Intelligence humanoid robots automation future)', badge: 'প্রযুক্তি সংবাদ' },
  { angle: 'কোয়ান্টাম কম্পিউটার: সুপারকম্পিউটারের লাখ বছরের কাজ করে মাত্র কয়েক মিনিটে (Quantum computer processor glowing cryogenic lab)', badge: 'প্রযুক্তি সংবাদ' },
  { angle: 'ইলন মাস্কের নিউরালিংক ও মানব মস্তিষ্কের সাথে কম্পিউটারের সরাসরি সংযোগ (Neuralink brain-computer interface futuristic cybernetics)', badge: 'প্রযুক্তি সংবাদ' },
  { angle: 'ডিপফেক প্রযুক্তি, সাইবার ক্রাইম ও ডিজিটাল যুগে নিজের নিরাপত্তা রক্ষা (Deepfake AI cybersecurity digital identity defense)', badge: 'সচেতনতা বার্তা' },
  { angle: 'ড্রাইভারলেস অটোনোমাস গাড়ি ও স্মার্ট ট্রান্সপোর্টেশনের ভবিষ্যৎ বিপ্লব (Driverless autonomous self driving car future city)', badge: 'প্রযুক্তি সংবাদ' },
  { angle: 'গ্রিন হাইড্রোজেন ও নবায়নযোগ্য সৌরশক্তির হাত ধরে পরিবেশবান্ধব জ্বালানি বিপ্লব (Green hydrogen clean renewable energy solar future)', badge: 'প্রযুক্তি সংবাদ' },

  // 8. খেলার দুনিয়া ও রেকর্ড (Sports & Human Limits)
  { angle: 'নীরজ চোপড়ার জ্যাভলিন থ্রো ও অলিম্পিক মঞ্চে ভারতের ঐতিহাসিক স্বর্ণজয় (Neeraj Chopra javelin throw Olympic national athlete)', badge: 'খেলার খবর' },
  { angle: 'শচীন তেন্ডুলকরের ১০০ শতকের অবিস্মরণীয় আন্তর্জাতিক রেকর্ড ও শৃঙ্খলা (Sachin Tendulkar historic cricket century master blaster)', badge: 'খেলার খবর' },
  { angle: 'উসাইন বোল্টের ৯.৫৮ সেকেন্ডের বিশ্বরেকর্ড ও মানুষের গতির চরম সীমানা (Usain Bolt sprint 100m world record stadium speed)', badge: 'খেলার খবর' },
  { angle: 'লিওনেল মেসির বিশ্বকাপ ট্রফি জয়ের অবিস্মরণীয় লড়াই ও হার না মানা রূপকথা (Lionel Messi World Cup champion victory celebration)', badge: 'খেলার খবর' },
  { angle: 'মেজর ধ্যানচাঁদের হকির জাদুকরী ড্রিবলিং ও অলিম্পিক স্বর্ণগাথা (Major Dhyan Chand hockey wizard Olympic historic legend)', badge: 'খেলার খবর' },
  { angle: 'প্যারালিম্পিক অ্যাথলিটদের শারীরিক বাধা জয় করে বিশ্বমঞ্চে ইতিহাস গড়ার কাহিনী (Paralympic athletes determination courage victory podium)', badge: 'খেলার খবর' },

  // 9. মানবদেহ ও চিকিৎসা বিজ্ঞান (Human Body & Health)
  { angle: 'আমাদের হৃৎপিণ্ডের দিনে ১ লাখ বার স্পন্দনের অবিশ্বাস্য পেশিশক্তি (Human heart cardiovascular pulse vital life force)', badge: 'চিকিৎসা বিজ্ঞান' },
  { angle: 'ডিএনএ কোডিং: মাত্র ১ চামচ ডিএনএ-তে পৃথিবীর সমস্ত ডেটা সংরক্ষণের বিজ্ঞান (DNA double helix biological genetic data storage)', badge: 'চিকিৎসা বিজ্ঞান' },
  { angle: 'মানবদেহের ইমিউন সিস্টেম কীভাবে প্রতিদিন লাখ লাখ ক্ষতিকর জীবাণু ধ্বংস করে (Human immune system T-cells attacking virus microscopy)', badge: 'চিকিৎসা বিজ্ঞান' },
  { angle: 'দীর্ঘায়ুর গোপন রহস্য: ব্লু জোন অঞ্চলের মানুষদের শতায়ু হওয়ার নিয়ম (Blue zones longevity healthy nutrition lifestyle elderly joy)', badge: 'চিকিৎসা বিজ্ঞান' },
  { angle: 'মানব চোখের প্রায় ৫৭৬ মেগাপিক্সেল ক্ষমতা ও লক্ষ লক্ষ রঙের অনুভূতি (Human eye iris pupil micro-detail vision perspective)', badge: 'চিকিৎসা বিজ্ঞান' },
  { angle: 'পর্যাপ্ত গভীর ঘুমের সময় মস্তিষ্কের বিষাক্ত প্রোটিন পরিষ্কারের গ্লাইমফ্যাটিক মেকানিজম (Deep sleep brain glymphatic cleansing rejuvenation)', badge: 'চিকিৎসা বিজ্ঞান' },

  // 10. অনুপ্রেরণা ও জীবনদর্শন (Motivation & Philosophy)
  { angle: 'জাপানি জীবনদর্শন ইকিগাই (Ikigai): দীর্ঘ ও অর্থপূর্ণ জীবনের ৪টি সোনালী সূত্র (Japanese Ikigai purposeful living harmony Zen garden)', badge: 'অনুপ্রেরণা' },
  { angle: 'স্টোইসিজম দর্শন: জীবনের কঠিন ঝড়েও শান্ত ও অবিচল থাকার পরীক্ষিত উপায় (Stoicism Marcus Aurelius statue calm inner resilience)', badge: 'অনুপ্রেরণা' },
  { angle: 'ব্যর্থতা থেকেই ঘুরে দাঁড়ানোর অদম্য শক্তি: বিশ্ববিখ্যাতদের হার না মানা গল্প (Resilience overcoming failure stepping stones to success)', badge: 'অনুপ্রেরণা' },
  { angle: 'সময়ের সঠিক ব্যবস্থাপনা ও প্রোডাক্টিভিটি বৃদ্ধির ৫টি পরীক্ষিত সাইকোলজি নিয়ম (Time management productivity clock focus deep work)', badge: 'অনুপ্রেরণা' },
  { angle: 'কম্পাউন্ডিংয়ের জাদু: প্রতিদিনের মাত্র ১% উন্নতি কীভাবে ১ বছরে জীবন বদলে দেয় (Power of compounding growth habit exponential curve)', badge: 'অনুপ্রেরণা' },
  { angle: 'ইতিবাচক দৃষ্টিভঙ্গি ও মানসিক শক্তির মাধ্যমে যেকোনো বাধা অতিক্রমের নিয়ম (Positive mindset optimism growth overcoming hurdles)', badge: 'অনুপ্রেরণা' }
];

// Curated fallback posts are loaded from ./ai/fallbacks

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
function getRecentTopicsFromHistory() {
  try {
    const history = storage.getHistory() || [];
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
          console.log(`[AI Service] Fresh dynamic topic via Gemini: "${parsed.angle}"`);
          return parsed;
        }
      }
    } catch (e) {
      console.log('[AI Service] Gemini dynamic topic generation notice:', e.message);
    }
  }

  // 2. Filter expanded dynamic topic angles against recent exclusions
  const lowerExcluded = excludeList.map(t => t.toLowerCase());
  const available = DYNAMIC_TOPIC_ANGLES.filter(item => {
    const angleLower = item.angle.toLowerCase();
    return !lowerExcluded.some(exc => angleLower.includes(exc.toLowerCase()) || exc.toLowerCase().includes(item.badge.toLowerCase()));
  });

  const poolToUse = available.length > 0 ? available : DYNAMIC_TOPIC_ANGLES;
  const picked = poolToUse[Math.floor(Math.random() * poolToUse.length)];
  return {
    angle: picked.angle,
    badge: picked.badge,
    search_term: picked.angle.split('(')[1]?.replace(')', '') || picked.angle
  };
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

        console.log(`[Gemini Verify] Verified using model: ${model}`);
        return { valid: true, success: true, model: model, message: `Connected with Google Gemini (${model})` };
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
              .replace(/\s+/g, ' ')
              .trim();
  }

  /**
   * Multimodal AI Template Analyzer:
   * Extracts visual layout, color palette, headline structure, and writing voice from an uploaded reference template
   */
  async analyzeTemplate(imageBufferOrUrl, sampleText = '') {
    const settings = storage.getSettings();
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
          if (Buffer.isBuffer(imageBufferOrUrl)) {
            base64Image = imageBufferOrUrl.toString('base64');
          } else if (typeof imageBufferOrUrl === 'string') {
            if (imageBufferOrUrl.startsWith('data:image')) {
              const matches = imageBufferOrUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
              if (matches) {
                mimeType = matches[1];
                base64Image = matches[2];
              }
            } else if (imageBufferOrUrl.startsWith('http://') || imageBufferOrUrl.startsWith('https://')) {
              const imgRes = await axios.get(imageBufferOrUrl, { responseType: 'arraybuffer', timeout: 10000 });
              base64Image = Buffer.from(imgRes.data).toString('base64');
            } else {
              let localPath = imageBufferOrUrl;
              if (imageBufferOrUrl.startsWith('/uploads/')) {
                localPath = path.join(__dirname, '..', imageBufferOrUrl);
              }
              if (fs.existsSync(localPath)) {
                base64Image = fs.readFileSync(localPath).toString('base64');
              }
            }
          }
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
            console.log(`[AI Service] Successfully analyzed template via ${model}:`, extracted.summary);
            break;
          }
        }
      } catch (err) {
        console.log(`[AI Service] analyzeTemplate error with ${model}:`, err.message);
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

    const settings = storage.getSettings();
    const geminiApiKey = settings.geminiApiKey ? settings.geminiApiKey.trim() : '';
    const categories = storage.getCategories();

    let activeCategory = null;
    if (category) {
      activeCategory = categories.find(c => c.id === category);
    }

    // Dynamic Non-Repeating Topic Selection if user did not provide a specific topic
    let effectiveTopic = topic ? topic.trim() : '';
    let defaultBadge = activeCategory?.badge || 'আলোচিত সংবাদ';
    const isAutoTopic = !effectiveTopic;

    if (isAutoTopic) {
      const recentTopics = getRecentTopicsFromHistory();
      const dynamicTopicObj = await pickOrGenerateDynamicTopic(activeCategory?.title || '', recentTopics, geminiApiKey);
      effectiveTopic = dynamicTopicObj.angle;
      defaultBadge = activeCategory?.badge || dynamicTopicObj.badge;
    }

    // 1. Identify Target Page & its dedicated System Prompt and Content Profile
    const targetPage = targetPageId ? (storage.getPageById(targetPageId) || storage.getActivePage()) : storage.getActivePage();
    const pageName = targetPage?.name || settings.pageName || 'Facebook Page';
    const pageSystemPrompt = storage.getPageSystemPrompt(targetPage?.id);
    const contentProfile = (typeof optionsOrTopic === 'object' && optionsOrTopic?.contentProfile)
      ? optionsOrTopic.contentProfile
      : (targetPage?.contentProfile || storage.getPageProfile(targetPage?.id));

    const recentHistory = storage.getHistory() || [];
    const verifiedFactPack = (typeof optionsOrTopic === 'object' && optionsOrTopic?.verifiedFactPack) || null;

    // 2. Identify Reference Template & its Learned Profile
    if (!template && targetTemplateId) {
      template = storage.getTemplateById(targetTemplateId);
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

    // 3. Build Page Context adhering to strict prompt hierarchy
    const pageContext = buildPageContext({
      page: targetPage,
      contentProfile,
      category: activeCategory?.title || defaultBadge,
      recentHistory,
      objective: effectiveTopic,
      verifiedFactPack,
      customSystemPrompt: pageSystemPrompt
    });

    console.log(`[AI Service] Generating post for page "${pageName}" (Template: "${template?.title || 'None'}", ContentType: "${pageContext.contentType}", Pillar: "${pageContext.selectedPillar?.title || 'None'}"), Topic: "${effectiveTopic}"`);

    let systemPrompt = pageContext.systemInstruction;
    if (templateGuidelines) {
      systemPrompt += templateGuidelines;
    }

    const isCustomRequest = !isAutoTopic;
    if (isCustomRequest) {
      systemPrompt += `\n\n[USER TOPIC / INSTRUCTION]
The user provided a specific topic / instruction: "${effectiveTopic}".
HONOR THE USER'S EXACT INTENT, TOPIC, AND DESIRED TONE. Do NOT distort the user's intent into an unrelated subject!`;
    }

    const userPrompt = `${pageContext.userPromptContext}\n\nRespond ONLY with the single valid JSON object.`;

    let result = null;

    // 1. Google Gemini API with fallback cascade
    if (geminiApiKey) {
      const candidateModels = ['gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.5-flash'];
      for (const model of candidateModels) {
        try {
          console.log(`[AI Service] Generating structured post using Google Gemini (${model})...`);
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
            if (parsed && parsed.line1_red && parsed.post_caption) {
              result = parsed;
              console.log(`[AI Service] Successfully generated structured post using ${model}!`);
              break;
            }
          }
        } catch (err) {
          console.log(`[AI Service] Gemini ${model} notice:`, err.response?.data?.error?.message || err.message);
        }
      }
    }

    // 2. Fallback via Pollinations OpenAI JSON
    if (!result) {
      try {
        console.log('[AI Service] Attempting fallback AI generator...');
        const res = await axios.post('https://text.pollinations.ai/', {
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          model: 'openai',
          temperature: 0.95
        }, { timeout: 12000 });

        let text = typeof res.data === 'string' ? res.data : res.data?.choices?.[0]?.message?.content;
        if (text) {
          const parsed = extractJson(text);
          if (parsed && parsed.line1_red && parsed.post_caption) {
            result = parsed;
          }
        }
      } catch (err) {
        console.log('[AI Service] Online fallback notice:', err.message);
      }
    }

    // 3. Fallback to Rich Dynamic Curated Library
    if (!result) {
      const picked = getFallbackForCategory(categoryId);
      result = JSON.parse(JSON.stringify(picked));
      result.isFallback = true;
      result.generationSource = 'curated_fallback';
      result.verified = false;
      console.log(`[AI Service] Using diverse dynamic curated fallback post: "${result.line1_red}" (Category: ${result.category || 'General'})`);
    }

    if (result) {
      result.strategy = {
        pillar: pageContext.selectedPillar ? pageContext.selectedPillar.title : null,
        pillarId: pageContext.selectedPillar ? pageContext.selectedPillar.id : null,
        contentType: pageContext.contentType,
        targetAudience: contentProfile?.audience?.professions?.[0] || 'General'
      };
      result.profileVersion = contentProfile?.schemaVersion || 1;
      result.riskLevel = pageContext.riskLevel;
      const captionText = result.post_caption || '';
      result.qualityReview = {
        charCount: captionText.length,
        hasPillar: !!pageContext.selectedPillar,
        withinLengthBounds: captionText.length >= (contentProfile?.preferredCaptionLength?.min || 200) &&
                            captionText.length <= (contentProfile?.preferredCaptionLength?.max || 900)
      };
    }

    return result;
  }

  /**
   * Fetch genuine, high-res photograph related to the topic/person
   */
  async fetchSmartBackground(searchTerm, topic = '', variation = 0, styleMode = 'auto', customPrompt = '') {
    const term = (customPrompt || searchTerm || topic || 'athletics stadium').trim();
    console.log(`[Smart Photo Fetcher] Looking for photo for: "${term}" (Mode: ${styleMode}, Var: #${variation})...`);

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
        const fluxRes = await axios.get(fluxUrl, { headers: BROWSER_HEADERS, responseType: 'arraybuffer', timeout: 18000 });
        if (fluxRes.data && fluxRes.data.length > 5000) {
          console.log(`[Smart Photo Fetcher] Generated Flux AI photo for "${term}"`);
          return Buffer.from(fluxRes.data);
        }
      } catch (err) {
        console.log('[Smart Photo Fetcher] Flux mode notice:', err.message);
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
              console.log(`[Smart Photo Fetcher] Found Wikipedia photo for "${chosenPage.title}": ${imgUrl}`);
              const imgRes = await axios.get(imgUrl, { headers: BROWSER_HEADERS, responseType: 'arraybuffer', timeout: 15000 });
              if (imgRes.data && imgRes.data.length > 5000) {
                return Buffer.from(imgRes.data);
              }
            }
          }
        }
      } catch (wikiErr) {
        console.log('[Smart Photo Fetcher] Wikipedia search notice:', wikiErr.message);
      }
    }

    // Mode C: Try Unsplash targeted keyword fetch with variation seed
    try {
      const unsplashUrl = `https://images.unsplash.com/featured/?${encodeURIComponent(term)}&sig=${Date.now() + variation * 888}`;
      const unsplashRes = await axios.get(unsplashUrl, { headers: BROWSER_HEADERS, responseType: 'arraybuffer', timeout: 8000 });
      if (unsplashRes.data && unsplashRes.data.length > 10000) {
        console.log(`[Smart Photo Fetcher] Got photo from Unsplash feature search for "${term}"`);
        return Buffer.from(unsplashRes.data);
      }
    } catch (e) {
      // ignore
    }

    // Mode D: Thematic Curated Pools with Browser User-Agent
    const lower = term.toLowerCase();
    let pool = THEMATIC_BG_POOLS.news;
    if (lower.includes('chopra') || lower.includes('sport') || lower.includes('cricket') || lower.includes('javelin') || lower.includes('olympic') || lower.includes('athlete') || lower.includes('football')) {
      pool = THEMATIC_BG_POOLS.sports;
    } else if (lower.includes('space') || lower.includes('isro') || lower.includes('chandrayaan') || lower.includes('galaxy') || lower.includes('nasa') || lower.includes('telescope')) {
      pool = THEMATIC_BG_POOLS.space;
    } else if (lower.includes('brain') || lower.includes('mind') || lower.includes('psychology') || lower.includes('neuron')) {
      pool = THEMATIC_BG_POOLS.brain;
    } else if (lower.includes('nature') || lower.includes('ocean') || lower.includes('animal') || lower.includes('forest')) {
      pool = THEMATIC_BG_POOLS.nature;
    } else if (lower.includes('history') || lower.includes('ancient') || lower.includes('temple') || lower.includes('civilization') || lower.includes('nalanda')) {
      pool = THEMATIC_BG_POOLS.history;
    } else if (lower.includes('tech') || lower.includes('ai') || lower.includes('robot') || lower.includes('cyber')) {
      pool = THEMATIC_BG_POOLS.tech;
    }

    try {
      const pickIndex = (Math.floor(Math.random() * pool.length) + variation) % pool.length;
      const randomUrl = pool[pickIndex];
      const res = await axios.get(randomUrl, { headers: BROWSER_HEADERS, responseType: 'arraybuffer', timeout: 10000 });
      return Buffer.from(res.data);
    } catch (poolErr) {
      console.log('[Smart Photo Fetcher] Pool error, attempting Flux fallback...');
    }

    // Mode E: Photorealistic AI generation fallback (Flux) with seed variation
    try {
      const seed = Math.floor(Math.random() * 1000000) + variation * 1337;
      const fluxUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent("professional high quality realistic photography of " + term + ", 8k sharp, natural lighting")}?width=1080&height=1080&model=flux&nologo=true&seed=${seed}`;
      const fluxRes = await axios.get(fluxUrl, { headers: BROWSER_HEADERS, responseType: 'arraybuffer', timeout: 15000 });
      if (fluxRes.data && fluxRes.data.length > 5000) {
        return Buffer.from(fluxRes.data);
      }
    } catch (fluxErr) {
      console.log('[Smart Photo Fetcher] Flux fallback error:', fluxErr.message);
    }

    // Final Canvas fallback
    return await sharp({
      create: { width: 1080, height: 1080, channels: 4, background: { r: 15, g: 23, b: 42, alpha: 1 } }
    }).jpeg().toBuffer();
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

    const fileName = `thumb_${effectiveLayout}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.jpg`;
    const localFilePath = path.join(UPLOADS_DIR, fileName);

    console.log(`[Thumbnail Card] Compositing card (Layout: ${effectiveLayout}, Var #${variation}): "${line1Red} ${line1White}" (TemplateImage: ${!!templateImage})...`);

    // Fetch matching background photo (using templateImage if provided!)
    let rawBg = null;
    if (templateImage) {
      try {
        console.log(`[Thumbnail Card] Loading provided template image: ${templateImage}`);
        if (templateImage.startsWith('http://') || templateImage.startsWith('https://')) {
          const tRes = await axios.get(templateImage, { responseType: 'arraybuffer', timeout: 12000 });
          if (tRes.data && tRes.data.length > 2000) {
            rawBg = Buffer.from(tRes.data);
          }
        } else {
          let localPath = templateImage;
          if (templateImage.startsWith('/uploads/')) {
            localPath = path.join(__dirname, '..', templateImage);
          }
          if (fs.existsSync(localPath)) {
            rawBg = fs.readFileSync(localPath);
          }
        }
      } catch (err) {
        console.warn('[Thumbnail Card] Template image notice:', err.message);
      }
    }

    if (!rawBg) {
      rawBg = await this.fetchSmartBackground(cardData.search_term, topic, variation, styleMode, customPrompt);
    }

    const resizedBg = await sharp(rawBg)
      .resize(width, height, { fit: 'cover' })
      .toBuffer();

    const activePage = storage.getActivePage();
    const settings = storage.getSettings();
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
      await sharp(resizedBg)
        .composite([{ input: Buffer.from(svgOverlay), top: 0, left: 0 }])
        .jpeg({ quality: 95 })
        .toFile(localFilePath);

      console.log(`[Thumbnail Card] Successfully created (${effectiveLayout}): ${localFilePath}`);
      return {
        success: true,
        fileName: fileName,
        localPath: localFilePath,
        url: `/uploads/${fileName}`,
        layout: effectiveLayout
      };
    } catch (err) {
      console.error('[Thumbnail Card] Render error:', err.message);
      return null;
    }
  }

  /**
   * Main Generator Entry: Generates Full Bundle (Viral Post + Reference-Style Thumbnail Card)
   */
  async generateFullPostBundle(options = {}) {
    const { topic = '', categoryId = '', pageId = '', templateId = '', templateImage = null, includeImage = true, templateObj = null } = options;
    const categories = storage.getCategories();
    const category = categoryId ? categories.find(c => c.id === categoryId) : null;

    let targetTemplate = templateObj;
    if (!targetTemplate && templateId) {
      targetTemplate = storage.getTemplateById(templateId);
    }
    const effectiveTemplateImage = templateImage || targetTemplate?.imageUrl || null;

    console.log(`[AI Service] Generating full post bundle (PageId: "${pageId || 'active'}", Category: ${category?.title || 'Auto'}, Template: "${targetTemplate?.title || 'None'}")...`);

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

    return {
      message: structuredData.post_caption,
      category: category ? { id: category.id, title: category.title } : null,
      isFallback: !!structuredData.isFallback,
      generationSource: structuredData.isFallback ? 'curated_fallback' : 'ai_model',
      verified: !structuredData.isFallback && Array.isArray(structuredData.sources) && structuredData.sources.length > 0,
      sources: structuredData.sources || [],
      strategy: structuredData.strategy || null,
      profileVersion: structuredData.profileVersion || 1,
      riskLevel: structuredData.riskLevel || 'low',
      qualityReview: structuredData.qualityReview || null,
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
      targetTemplate = storage.getTemplateById(templateId);
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

    console.log(`[AI Service] Regenerating thumbnail only (Var #${variation}, Page: ${pageId || 'active'}, Template: ${targetTemplate?.title || 'None'})...`);
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
    const settings = storage.getSettings();
    const targetPage = pageId ? (storage.getPageById(pageId) || storage.getActivePage()) : storage.getActivePage();
    const pageName = targetPage?.name || settings.pageName || 'Facebook Page';
    const pageSystemPrompt = storage.getPageSystemPrompt(targetPage?.id);
    const geminiApiKey = settings.geminiApiKey ? settings.geminiApiKey.trim() : '';

    let templateGuidelines = '';
    if (templateId) {
      const template = storage.getTemplateById(templateId);
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
          console.log(`[Regenerate Caption] Gemini ${m} notice:`, e.message);
        }
      }
    }

    if (!newCaption) {
      try {
        const res = await axios.post('https://text.pollinations.ai/', {
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          model: 'openai',
          temperature: 0.95
        }, { timeout: 10000 });
        let text = typeof res.data === 'string' ? res.data : res.data?.choices?.[0]?.message?.content;
        if (text && text.length > 30) {
          newCaption = text.trim();
        }
      } catch (e) {
        console.log('[Regenerate Caption] Fallback notice:', e.message);
      }
    }

    if (!newCaption) {
      newCaption = topic ? `📢 ${topic}\n\nআজকের আলোচিত ঘটনার পেছনের মূল তথ্য ও বিস্তারিত আপডেট। বিস্তারিত জানতে এবং নতুন কনটেন্টের জন্য পেজে সঙ্গে থাকুন! ✨\n\n#Trending #ViralPost #FacebookUpdate` : currentMessage;
    }

    return { success: true, message: newCaption };
  }

  /**
   * Generates a curated list of viral, high-CTR content topic ideas
   */
  async generateTopicIdeas({ category = '', keyword = '', count = 6 } = {}) {
    const settings = storage.getSettings();
    const geminiApiKey = settings.geminiApiKey ? settings.geminiApiKey.trim() : '';
    const categories = storage.getCategories();

    const activePage = storage.getActivePage();
    const pageName = activePage?.name || settings.pageName || "Facebook Page";
    const pageProfile = activePage?.contentProfile || (activePage?.id ? storage.getPageProfile(activePage.id) : null);
    const pillarsContext = Array.isArray(pageProfile?.contentPillars) && pageProfile.contentPillars.length > 0
      ? `\nPrioritize topics matching the Page Content Pillars: ${pageProfile.contentPillars.map(p => p.title).join(', ')}.`
      : '';
    const nicheContext = pageProfile?.niche
      ? `\nPage Niche: "${pageProfile.niche}". Cater specifically to this audience persona!`
      : '';

    let targetCategory = null;
    if (category) {
      targetCategory = categories.find(c => c.id === category || c.title.includes(category));
    }

    const categoryText = targetCategory ? targetCategory.title : (category || 'বিজ্ঞান, মহাকাশ, মানব মস্তিষ্ক, রোমাঞ্চকর ইতিহাস ও প্রকৃতির রহস্য');
    const keywordText = keyword ? keyword.trim() : '';

    const systemPrompt = `You are the chief content strategist for the Facebook page "${pageName}".
Your task is to generate ${count} completely unique, irresistible, and viral topic ideas for Facebook posts.${nicheContext}${pillarsContext}
Bengali audience loves fascinating science, space mysteries, brain hacks, ancient history, deep ocean, and strange nature facts.

Output format MUST be a valid JSON array containing ${count} objects with these exact keys:
[
  {
    "id": "idea_1",
    "title": "আকর্ষণীয় ও ছোট শিরোনাম (বাংলায়, ৮-১৪ শব্দ)",
    "hook": "১ লাইনে এই বিষয়ের রোমাঞ্চকর পয়েন্ট যা জানলে পাঠক চমকে যাবে (বাংলায়)",
    "badge": "ক্যাটাগরি ব্যাজ (২-৩ শব্দ, যেমন: মহাকাশ বিজ্ঞান, মনস্তত্ত্ব, গভীর সমুদ্র, প্রাচীন ইতিহাস, প্রযুক্তি)",
    "emoji": "🌌",
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
          console.log(`[AI Service] Generating topic ideas using Gemini (${model})...`);
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
              console.log(`[AI Service] Successfully generated ${topics.length} topic ideas!`);
              break;
            }
          }
        } catch (err) {
          console.log(`[AI Service] Gemini topic ideas notice (${model}):`, err.response?.data?.error?.message || err.message);
        }
      }
    }

    // Fallback Pollinations
    if (!topics || topics.length === 0) {
      try {
        const res = await axios.post('https://text.pollinations.ai/', {
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          model: 'openai',
          temperature: 0.95
        }, { timeout: 12000 });
        if (res.data) {
          const parsed = extractJson(res.data);
          if (Array.isArray(parsed) && parsed.length > 0) {
            topics = parsed;
          }
        }
      } catch (err) {
        console.log('[AI Service] Fallback topics error:', err.message);
      }
    }

    // Curated dynamic fallback if API fails
    if (!topics || topics.length === 0) {
      const shuffled = [...DYNAMIC_TOPIC_ANGLES].sort(() => 0.5 - Math.random()).slice(0, count);
      topics = shuffled.map((item, idx) => ({
        id: `idea_${Date.now()}_${idx}`,
        title: item.angle.split('(')[0].trim(),
        hook: 'এই বিষয়ে রয়েছে বিজ্ঞানীদের তাক লাগিয়ে দেওয়া অসংখ্য অজানা ও রোমাঞ্চকর তথ্য!',
        badge: item.badge,
        emoji: ['🌌', '🧠', '🌊', '🏛️', '🚀', '🥇', '💡', '🌍'][idx % 8],
        search_keyword: item.angle
      }));
    }

    return topics;
  }

  /**
   * Backward Compatibility helper
   */
  async generatePostText(topic = '', categoryId = '') {
    const data = await this.generateStructuredPost(topic, categoryId);
    return data.post_caption;
  }
}

module.exports = new AIService();
