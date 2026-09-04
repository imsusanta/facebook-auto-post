const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
let SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
let HISTORY_FILE = path.join(DATA_DIR, 'history.json');
let QUEUE_FILE = path.join(DATA_DIR, 'queue.json');
let CATEGORIES_FILE = path.join(DATA_DIR, 'categories.json');
let RULES_FILE = path.join(DATA_DIR, 'automation_rules.json');
let TEMPLATES_FILE = path.join(DATA_DIR, 'templates.json');
let USERS_FILE = path.join(DATA_DIR, 'users.json');

function updateFilePaths(newDir) {
  DATA_DIR = newDir || process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
  HISTORY_FILE = path.join(DATA_DIR, 'history.json');
  QUEUE_FILE = path.join(DATA_DIR, 'queue.json');
  CATEGORIES_FILE = path.join(DATA_DIR, 'categories.json');
  RULES_FILE = path.join(DATA_DIR, 'automation_rules.json');
  TEMPLATES_FILE = path.join(DATA_DIR, 'templates.json');
  USERS_FILE = path.join(DATA_DIR, 'users.json');
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DEFAULT_TEMPLATES = [
  {
    id: 'template_news',
    title: 'Breaking / Trending News Analysis',
    badge: '📰 সাম্প্রতিক খবর',
    category: 'trending_news',
    imageUrl: '/robot.svg',
    desc: 'Catch immediate viral attention with a sensational event breakdown.',
    sample: '🚨 ব্রেকিং নিউজ ও সমসাময়িক আপডেট! 📢✨\n\nআজকের আলোচিত ঘটনার পেছনের মূল তথ্য ও বিস্তারিত বিশ্লেষণ:\n\n📌 গুরুত্বপূর্ণ পয়েন্ট:\n🔹 মূল ঘটনা ও প্রেক্ষাপট...\n🔹 জনসাধারণের ওপর এর প্রভাব...\n🔹 বিশেষজ্ঞদের মতামত...\n\nএই বিষয়ে আপনার ব্যক্তিগত মতামত কি? কমেন্টে জানান! 👇\n\n#TrendingNews #BreakingNews #CurrentAffairs #ViralPost'
  },
  {
    id: 'template_science',
    title: 'Amazing Science & Nature Mystery',
    badge: '🔬 বিজ্ঞানের রহস্য',
    category: 'science_nature',
    imageUrl: '/robot.svg',
    desc: 'Fascinating mind-bending facts about the cosmos, ocean or biology.',
    sample: '🌌 মহাবিশ্বের এমন এক রহস্য যা জানলে আপনার চোখ কপালে উঠবে! 🔭✨\n\nবিজ্ঞানীদের সাম্প্রতিক গবেষণায় উঠে এসেছে কিছু অবিশ্বাস্য তথ্য:\n\n📌 বিস্ময়কর ফ্যাক্টস:\n🔹 প্রথম অদ্ভুত সত্য...\n🔹 মানবদেহের ওপর এর চমকপ্রদ প্রভাব...\n🔹 পৃথিবী ও মহাকাশের অদ্ভুত সংযোগ...\n\nবিজ্ঞানের এমন অদ্ভুত সব তথ্য বন্ধুদের সাথে শেয়ার করতে ভুলবেন না! 🚀\n\n#ScienceFacts #AmazingUniverse #Astronomy #NatureMystery'
  },
  {
    id: 'template_history',
    title: 'Historical Heritage & Lost Legends',
    badge: '🏛️ ইতিহাসের রহস্য',
    category: 'history_civilization',
    imageUrl: '/robot.svg',
    desc: 'Unveil the forgotten facts about ancient empires and heroic rulers.',
    sample: '🏛️ ইতিহাসের পাতা থেকে: এক অজানা বীরগাথা ও ধ্বংস হওয়া সাম্রাজ্যের গল্প! 📜✨\n\nআজ থেকে শত শত বছর আগের এক অবিস্মরণীয় ঘটনা:\n\n📌 ঐতিহাসিক সত্য:\n🔹 ঘটনার পেছনের আসল রহস্য...\n🔹 যুগান্তকারী যুদ্ধের ফলাফল...\n🔹 কীভাবে বদলে গিয়েছিল ইতিহাস...\n\nআমাদের সমৃদ্ধ ঐতিহ্য ও অতীত জানতে সঙ্গে থাকুন! 🇮🇳\n\n#IndianHistory #Heritage #HistoryFacts #AncientLegends'
  },
  {
    id: 'template_brain',
    title: 'Mind Power & Psychology Hacks',
    badge: '🧠 মানব মস্তিষ্ক',
    category: 'psychology_mind',
    imageUrl: '/robot.svg',
    desc: 'High-engagement behavioral psychology and memory habits.',
    sample: '🧠 প্রতিদিন সকালে এই ১টি ভুল করলেই কমে যায় আপনার ব্রেইনের শক্তি! 💡\n\nমনোবিজ্ঞান ও নিউরোসায়েন্সের গবেষণায় পাওয়া ৩টি দারুণ টিপস:\n\n📌 মস্তিষ্কের গোপন নিয়ম:\n🔹 স্মৃতিশক্তি বাড়ানোর সহজ কৌশল...\n🔹 মানসিক চাপ দ্রুত কমানোর উপায়...\n🔹 অবচেতন মনের অবিশ্বাস্য ক্ষমতা...\n\nনিজেকে প্রতিদিন ১% উন্নত করতে আজই শুরু করুন! 📚✨\n\n#PsychologyTricks #MindPower #SelfImprovement #BrainFacts'
  },
  {
    id: 'template_tech',
    title: 'AI Revolution & Future Inventions',
    badge: '💡 ভবিষ্যৎ প্রযুক্তি',
    category: 'tech_inventions',
    imageUrl: '/robot.svg',
    desc: 'Viral discussions on artificial intelligence, robots, and tech jobs.',
    sample: '🤖 কৃত্রিম বুদ্ধিমত্তা (AI) কি সত্যিই প্রযুক্তির ভবিষ্যৎ বদলে দেবে? ⚡\n\nবিশ্বজুড়ে প্রযুক্তির দ্রুত পরিবর্তন নিয়ে যা বলছেন শীর্ষ বিজ্ঞানীরা:\n\n📌 প্রযুক্তির নতুন দিগন্ত:\n🔹 যে কাজগুলো এআই কখনোই করতে পারবে না...\n🔹 নতুন কী ধরণের চাকরির সুযোগ আসছে...\n🔹 সাধারণ মানুষ কীভাবে এতে লাভবান হবে...\n\nপ্রযুক্তির এই বিপ্লবে আপনার অভিমত কি? কমেন্টে জানান! 👇\n\n#ArtificialIntelligence #TechInventions #FutureTech #Innovation'
  },
  {
    id: 'template_wisdom',
    title: 'Inspiring Life Philosophy & Quotes',
    badge: '✨ জীবন ভাবনা',
    category: 'philosophy_wisdom',
    imageUrl: '/robot.svg',
    desc: 'Emotional storytelling and moral guidance that drives massive shares.',
    sample: '✨ জীবনের এই ৩টি কঠিন সত্য যত তাড়াতাড়ি বুঝবেন, ততই ভালো থাকবেন! 🌸\n\nঅভিজ্ঞতার চেয়ে বড় কোনো শিক্ষক জীবনে আর নেই:\n\n📌 জীবনের ৩টি শিক্ষা:\n🔹 মানুষের আচরণ ও প্রত্যাশা নিয়ন্ত্রণ...\n🔹 সময়ের মূল্য ও আত্মসম্মান...\n🔹 কঠিন সময়ে নিজেকে শান্ত রাখার কৌশল...\n\nকথাগুলো মনের মতো লাগলে আপনার প্রিয় মানুষের সাথে শেয়ার করুন। ❤️\n\n#LifeQuotes #Inspiration #Philosophy #DailyWisdom #Motivational'
  }
];

const DEFAULT_RULES = {
  commentAutomationEnabled: true,
  chatAutomationEnabled: true,
  aiCommentFallbackEnabled: true,
  commentRules: [
    {
      id: 'rule_price_inquiry',
      name: 'Price & Admission Inquiry',
      keywords: ['price', 'dam koto', 'koto', 'cost', 'details', 'kivabe pabo', 'info', 'admission', 'interested'],
      publicReply: 'হ্যালো {name}! আপনার আগ্রহের জন্য ধন্যবাদ। বিস্তারিত তথ্য আমরা আপনার মেসেঞ্জার ইনবক্সে পাঠিয়ে দিয়েছি, দয়া করে চেক করুন! ❤️',
      sendPrivateDm: true,
      privateDm: 'নমস্কার {name}! আমাদের সমস্ত তথ্য ও লিংক: https://example.com/details। যেকোনো সহায়তায় আমাদের জানান!',
      autoLike: true,
      isActive: true
    },
    {
      id: 'rule_appreciation',
      name: 'Appreciation & Positive Feedback',
      keywords: ['nice', 'great', 'valolaglo', 'osadharon', 'dhonnobad', 'good', 'helpful', 'thanks', 'darun'],
      publicReply: 'অনেক অনেক ধন্যবাদ {name}! আপনার এই সুন্দর মন্তব্য আমাদের নতুন কনটেন্ট তৈরির অনুপ্রেরণা যোগায়। সঙ্গে থাকুন! 🌸✨',
      sendPrivateDm: false,
      privateDm: '',
      autoLike: true,
      isActive: true
    }
  ],
  chatSettings: {
    enabled: true,
    welcomeMessage: 'স্বাগতম আমাদের পেজে! 👋 আমরা আপনাকে কীভাবে সাহায্য করতে পারি? নিচে প্রশ্ন লিখুন অথবা অপশন বেছে নিন।',
    personaPrompt: "তুমি এই ফেসবুক পেজের একজন অত্যন্ত অভিজ্ঞ ও নম্র কাস্টমার সাপোর্ট গাইড। তোমার কাজ গ্রাহক ও ফলোয়ারদের যেকোনো প্রশ্নের সহজ, প্রাঞ্জল ও মিষ্টি বাংলা ভাষায় নির্ভরযোগ্য তথ্য ও উৎসাহ দেওয়া।",
    quickReplies: ['📚 তথ্য ও বিবরণী', '💰 কোর্স ও প্যাকেজ', '📞 কাস্টমার সাপোর্ট']
  }
};

const DEFAULT_CATEGORIES = [
  {
    id: 'trending_news',
    title: '📰 সমসাময়িক খবর ও ট্রেন্ডিং নিউজ (Trending & Breaking News)',
    promptContext: 'দেশ ও বিদেশের সাম্প্রতিক আলোচিত খবর, জাতীয় ও আন্তর্জাতিক গুরুত্বপূর্ণ ঘটনা, নতুন নীতি, বৈজ্ঞানিক অগ্রগতি বা ভাইরাল খবরের সহজ ও তথ্যবহুল বিশ্লেষণ।',
    icon: 'newspaper',
    badge: '📰 সাম্প্রতিক খবর',
    isDefault: true
  },
  {
    id: 'science_nature',
    title: '🔬 বিজ্ঞান ও প্রকৃতির বিস্ময় (Science & Nature Wonders)',
    promptContext: 'মহাবিশ্ব, মহাকাশ, মানবদেহ, পদার্থবিজ্ঞান, প্রাণীজগৎ বা প্রকৃতির কোনো অদ্ভুত ও বৈজ্ঞানিক সত্য যা মানুষকে কৌতূহলী করে তুলবে।',
    icon: 'atom',
    badge: '🔬 বিজ্ঞানের রহস্য',
    isDefault: true
  },
  {
    id: 'history_civilization',
    title: '🏛️ ইতিহাস ও বিশ্ব সভ্যতা (World History & Heritage)',
    promptContext: 'বিশ্বের প্রাচীন সভ্যতা, বিখ্যাত আবিষ্কার, ঐতিহাসিক ঘটনা, প্রত্নতত্ত্ব বা কোনো যুগান্তকারী সিদ্ধান্তের পেছনের গল্প ও ইতিহাস।',
    icon: 'landmark',
    badge: '🏛️ ইতিহাসের রহস্য',
    isDefault: true
  },
  {
    id: 'psychology_mind',
    title: '🧠 মানব মস্তিষ্ক ও মনোবিজ্ঞান (Psychology & Human Mind)',
    promptContext: 'মানুষের আচরণ, অভ্যাস গঠনের বিজ্ঞান, স্মৃতিশক্তি, আবেগ, অবচেতন মন ও ব্রেইনের কার্যপদ্ধতির সহজ ও শিক্ষণীয় ব্যাখ্যা।',
    icon: 'brain',
    badge: '🧠 মানব মস্তিষ্ক',
    isDefault: true
  },
  {
    id: 'world_geography',
    title: '🌍 জানা-অজানা পৃথিবী ও বিশ্বজ্ঞান (World Wonders & Geography)',
    promptContext: 'পৃথিবীর অদ্ভুত সব স্থান, ভৌগোলিক বিস্ময়, মহাসাগরের রহস্য, বৈচিত্র্যময় সংস্কৃতি বা আন্তর্জাতিক জ্ঞানের আকর্ষণীয় তথ্য।',
    icon: 'globe',
    badge: '🌍 বিশ্ব বিস্ময়',
    isDefault: true
  },
  {
    id: 'tech_inventions',
    title: '💡 প্রযুক্তি ও দৈনন্দিন আবিষ্কার (Inventions & Future Tech)',
    promptContext: 'দৈনন্দিন জীবনের নানা জিনিসের আবিষ্কারের পেছনের গল্প, ইন্টারনেট, কৃত্রিম বুদ্ধিমত্তা (AI), রোবোটিক্স বা ভবিষ্যতের প্রযুক্তির ব্যাখ্যা।',
    icon: 'cpu',
    badge: '⚡ ভবিষ্যৎ প্রযুক্তি',
    isDefault: true
  },
  {
    id: 'philosophy_wisdom',
    title: '✨ জীবন দর্শন ও শিক্ষণীয় ভাবনা (Philosophy & Life Wisdom)',
    promptContext: 'জীবনদর্শন, গভীর শিক্ষণীয় দৃষ্টিভঙ্গি, আত্মউন্নয়ন, চিন্তাশক্তি বৃদ্ধি ও মানবিক মূল্যবোধের চমৎকার আলোচনা।',
    icon: 'sparkles',
    badge: '✨ জীবন ভাবনা',
    isDefault: true
  },
  {
    id: 'sports_records',
    title: '🏆 খেলাধুলা ও বিশ্ব রেকর্ড (Sports & World Records)',
    promptContext: 'আন্তর্জাতিক ও জাতীয় খেলাধুলার রোমাঞ্চকর রেকর্ড, কিংবদন্তি অ্যাথলেটদের অনুপ্রেরণামূলক গল্প এবং অবিস্মরণীয় ক্রীড়া ইতিহাস।',
    icon: 'trophy',
    badge: '🏆 খেলার খবর',
    isDefault: true
  }
];

function readJsonFile(filePath, defaultVal = {}) {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(defaultVal, null, 2), 'utf8');
      return defaultVal;
    }
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data || '{}');
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err.message);
    return defaultVal;
  }
}

function writeJsonFile(filePath, data) {
  try {
    const isSensitive = filePath.endsWith('settings.json') || filePath.endsWith('users.json');
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), {
      encoding: 'utf8',
      mode: isSensitive ? 0o600 : 0o644
    });
    if (isSensitive) {
      try { fs.chmodSync(filePath, 0o600); } catch { /* ignore non-posix */ }
    }
    return true;
  } catch (err) {
    console.error(`Error writing ${filePath}:`, err.message);
    return false;
  }
}

const DEFAULT_SYSTEM_PROMPT = `ব্যবহারকারীর দেওয়া টপিক ও নির্দেশনা অনুযায়ী আকর্ষণীয়, তথ্যবহুল এবং সম্পূর্ণ মৌলিক ফেসবুক পোস্ট তৈরি করো। বিষয়বস্তুর সাথে মানানসই সুন্দর বাংলা ভাষা, প্রাসঙ্গিক ইমোজি এবং উপযুক্ত ট্রেন্ডিং হ্যাশট্যাগ ব্যবহার করবে।`;

// Storage helpers
const storage = {
  getDefaultSystemPrompt() {
    return DEFAULT_SYSTEM_PROMPT;
  },

  getSettings() {
    const s = readJsonFile(SETTINGS_FILE, {
      pageId: '',
      accessToken: '',
      pageName: 'My Facebook Page',
      isDemoMode: false,
      autoPostEnabled: false,
      intervalMinutes: 15,
      autoPilotEnabled: false,
      cronSchedule: '0 9,14,20 * * *', // Daily 9am, 2pm, 8pm
      cronLabel: 'প্রতিদিন ৩ বার (সকাল ৯টা, দুপুর ২টা, রাত ৮টা)',
      selectedCategories: ['trending_news', 'science_nature', 'history_civilization', 'psychology_mind', 'world_geography', 'tech_inventions', 'philosophy_wisdom'],
      includeAiImage: true,
      geminiApiKey: '',
      customSystemPrompt: DEFAULT_SYSTEM_PROMPT,
      lastCheck: null
    });
    if (!s.customSystemPrompt) {
      s.customSystemPrompt = DEFAULT_SYSTEM_PROMPT;
    }
    return s;
  },

  saveSettings(newSettings) {
    const current = this.getSettings();
    const updated = { ...current, ...newSettings, updatedAt: new Date().toISOString() };
    writeJsonFile(SETTINGS_FILE, updated);
    return updated;
  },

  getAdminAuth() {
    const s = this.getSettings();
    return {
      hasPassword: Boolean(s.adminPasswordHash && s.adminPasswordSalt),
      hash: s.adminPasswordHash || null,
      salt: s.adminPasswordSalt || null
    };
  },

  setAdminPassword(hash, salt) {
    return this.saveSettings({
      adminPasswordHash: hash,
      adminPasswordSalt: salt
    });
  },

  // =========================================================================
  // User Management & SaaS Accounts
  // =========================================================================
  initDefaultUsers() {
    let users = readJsonFile(USERS_FILE, []);
    if (!Array.isArray(users)) users = [];

    const existingSuperAdmin = users.find(u => u && typeof u.email === 'string' && u.email.toLowerCase() === 'susantalohr@gmail.com');
    if (!existingSuperAdmin) {
      // In production or when NODE_ENV is unset, NEVER seed a hardcoded default password.
      // Require explicit environment variable or allow dev/test fallback
      const isDevOrTest = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
      const initialPassword = process.env.ADMIN_INITIAL_PASSWORD || process.env.ADMIN_PASSWORD || (isDevOrTest ? 'admin@123' : null);
      if (initialPassword) {
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = crypto.pbkdf2Sync(initialPassword, salt, 100000, 64, 'sha512').toString('hex');
        const defaultUser = {
          id: 'usr_superadmin_' + crypto.randomBytes(4).toString('hex'),
          email: 'susantalohr@gmail.com',
          name: 'Susanta Lohar',
          role: 'super_admin',
          passwordHash: hash,
          passwordSalt: salt,
          status: 'active',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        users.unshift(defaultUser);
        writeJsonFile(USERS_FILE, users);
      }
    }
    return users;
  },

  getUsers() {
    return this.initDefaultUsers();
  },

  findUserByEmail(email) {
    if (!email || typeof email !== 'string') return null;
    const users = this.getUsers();
    const cleanEmail = email.toLowerCase().trim();
    return users.find(u => u && typeof u.email === 'string' && u.email.toLowerCase().trim() === cleanEmail) || null;
  },

  findUserById(id) {
    if (!id || typeof id !== 'string') return null;
    const users = this.getUsers();
    return users.find(u => u && u.id === id) || null;
  },

  createUser({ email, password, name, role = 'user', status = 'active' }) {
    if (!email || !password) throw new Error('Email and password are required.');
    const cleanEmail = email.toLowerCase().trim();
    const existing = this.findUserByEmail(cleanEmail);
    if (existing) throw new Error('User with this email already exists.');

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');

    const newUser = {
      id: 'usr_' + crypto.randomBytes(6).toString('hex'),
      email: cleanEmail,
      name: name || cleanEmail.split('@')[0],
      role,
      passwordHash: hash,
      passwordSalt: salt,
      status,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const users = this.getUsers();
    users.push(newUser);
    writeJsonFile(USERS_FILE, users);
    return newUser;
  },

  updateUser(id, updates) {
    const users = this.getUsers();
    const index = users.findIndex(u => u.id === id);
    if (index === -1) return null;

    const current = users[index];
    if (updates.password) {
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.pbkdf2Sync(updates.password, salt, 100000, 64, 'sha512').toString('hex');
      updates.passwordHash = hash;
      updates.passwordSalt = salt;
      delete updates.password;
    }

    users[index] = {
      ...current,
      ...updates,
      updatedAt: new Date().toISOString()
    };
    writeJsonFile(USERS_FILE, users);
    return users[index];
  },

  getConnectedPages() {
    const s = this.getSettings();
    if (!Array.isArray(s.pages) || s.pages.length === 0) {
      const initialPage = {
        id: s.pageId || '',
        name: s.pageName || 'My Facebook Page',
        pictureUrl: s.pictureUrl || '',
        accessToken: s.accessToken || '',
        category: 'General',
        systemPrompt: s.customSystemPrompt || DEFAULT_SYSTEM_PROMPT,
        connectedAt: s.updatedAt || new Date().toISOString(),
        isActive: true
      };
      s.pages = [initialPage];
      s.activePageId = initialPage.id;
      writeJsonFile(SETTINGS_FILE, s);
    } else {
      // Ensure all existing pages have systemPrompt field
      let changed = false;
      s.pages.forEach(p => {
        if (!p.systemPrompt) {
          p.systemPrompt = s.customSystemPrompt || DEFAULT_SYSTEM_PROMPT;
          changed = true;
        }
      });
      if (changed) writeJsonFile(SETTINGS_FILE, s);
    }
    return s.pages;
  },

  getActivePage() {
    const pages = this.getConnectedPages();
    const s = this.getSettings();
    const active = pages.find(p => p.id === s.activePageId) || pages.find(p => p.isActive) || pages[0] || null;
    return active;
  },

  getPageById(pageId) {
    const pages = this.getConnectedPages();
    return pages.find(p => p.id === pageId) || null;
  },

  getPageSystemPrompt(pageId) {
    if (pageId) {
      const page = this.getPageById(pageId);
      if (page && page.systemPrompt && page.systemPrompt.trim()) {
        return page.systemPrompt.trim();
      }
    }
    const active = this.getActivePage();
    if (active && active.systemPrompt && active.systemPrompt.trim()) {
      return active.systemPrompt.trim();
    }
    const s = this.getSettings();
    return s.customSystemPrompt || DEFAULT_SYSTEM_PROMPT;
  },

  addConnectedPage(pageData) {
    const s = this.getSettings();
    const pages = this.getConnectedPages();
    
    const existingIndex = pages.findIndex(p => p.id === pageData.id);
    const newPage = {
      id: pageData.id,
      name: pageData.name || 'Facebook Page',
      pictureUrl: pageData.pictureUrl || '/pariksha_notes_logo.jpg',
      accessToken: pageData.accessToken,
      category: pageData.category || 'General',
      systemPrompt: pageData.systemPrompt || s.customSystemPrompt || DEFAULT_SYSTEM_PROMPT,
      connectedAt: new Date().toISOString(),
      isActive: pages.length === 0 || !!pageData.setAsActive
    };

    if (existingIndex >= 0) {
      pages[existingIndex] = { ...pages[existingIndex], ...newPage };
    } else {
      pages.push(newPage);
    }

    if (newPage.isActive) {
      pages.forEach(p => { p.isActive = (p.id === newPage.id); });
      s.activePageId = newPage.id;
      s.pageId = newPage.id;
      s.pageName = newPage.name;
      s.accessToken = newPage.accessToken;
      s.pictureUrl = newPage.pictureUrl;
      s.customSystemPrompt = newPage.systemPrompt;
    }

    s.pages = pages;
    writeJsonFile(SETTINGS_FILE, s);
    return newPage;
  },

  updateConnectedPage(pageId, updates = {}) {
    const s = this.getSettings();
    const pages = this.getConnectedPages();
    const index = pages.findIndex(p => p.id === pageId);
    if (index === -1) return null;

    const current = pages[index];
    const updated = {
      ...current,
      ...updates,
      id: current.id, // Cannot mutate immutable ID
      updatedAt: new Date().toISOString()
    };
    pages[index] = updated;

    // If active page, synchronize top-level settings fields
    if (s.activePageId === pageId || updated.isActive) {
      if (updates.name) s.pageName = updates.name;
      if (updates.accessToken) s.accessToken = updates.accessToken;
      if (updates.pictureUrl) s.pictureUrl = updates.pictureUrl;
      if (updates.systemPrompt) s.customSystemPrompt = updates.systemPrompt;
    }

    s.pages = pages;
    writeJsonFile(SETTINGS_FILE, s);
    return updated;
  },

  setActivePage(pageId) {
    const s = this.getSettings();
    const pages = this.getConnectedPages();
    const target = pages.find(p => p.id === pageId);
    if (!target) return null;

    pages.forEach(p => {
      p.isActive = (p.id === pageId);
    });

    s.pages = pages;
    s.activePageId = target.id;
    s.pageId = target.id;
    s.pageName = target.name;
    s.accessToken = target.accessToken;
    s.pictureUrl = target.pictureUrl;
    if (target.systemPrompt) {
      s.customSystemPrompt = target.systemPrompt;
    }

    writeJsonFile(SETTINGS_FILE, s);
    return target;
  },

  removeConnectedPage(pageId) {
    const s = this.getSettings();
    let pages = this.getConnectedPages();
    if (pages.length <= 1) {
      throw new Error('At least one Facebook Page must remain connected.');
    }

    pages = pages.filter(p => p.id !== pageId);
    s.pages = pages;

    if (s.activePageId === pageId) {
      const nextActive = pages[0];
      nextActive.isActive = true;
      s.activePageId = nextActive.id;
      s.pageId = nextActive.id;
      s.pageName = nextActive.name;
      s.accessToken = nextActive.accessToken;
      s.pictureUrl = nextActive.pictureUrl;
    }

    writeJsonFile(SETTINGS_FILE, s);
    return pages;
  },

  getCategories() {
    if (!fs.existsSync(CATEGORIES_FILE)) {
      writeJsonFile(CATEGORIES_FILE, DEFAULT_CATEGORIES);
      return DEFAULT_CATEGORIES;
    }
    const data = readJsonFile(CATEGORIES_FILE, null);
    if (Array.isArray(data) && data.length > 0) {
      return data;
    }
    writeJsonFile(CATEGORIES_FILE, DEFAULT_CATEGORIES);
    return DEFAULT_CATEGORIES;
  },

  saveCategories(categories) {
    writeJsonFile(CATEGORIES_FILE, categories);
    return categories;
  },

  addCategory(category) {
    const categories = this.getCategories();
    const id = category.id || 'cat_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    const newCat = {
      id: id,
      title: category.title || 'নতুন ক্যাটাগরি',
      promptContext: category.promptContext || '',
      icon: category.icon || 'tag',
      badge: category.badge || '💡 তথ্য',
      isDefault: false
    };
    categories.push(newCat);
    this.saveCategories(categories);
    return newCat;
  },

  updateCategory(id, updates) {
    const categories = this.getCategories();
    const index = categories.findIndex(c => c.id === id);
    if (index !== -1) {
      categories[index] = { ...categories[index], ...updates };
      this.saveCategories(categories);
      return categories[index];
    }
    return null;
  },

  deleteCategory(id) {
    let categories = this.getCategories();
    categories = categories.filter(c => c.id !== id);
    this.saveCategories(categories);

    // Also remove from selectedCategories in settings
    const settings = this.getSettings();
    if (Array.isArray(settings.selectedCategories)) {
      const updatedSelected = settings.selectedCategories.filter(catId => catId !== id);
      this.saveSettings({ selectedCategories: updatedSelected });
    }
    return categories;
  },

  getHistory() {
    const data = readJsonFile(HISTORY_FILE, []);
    return Array.isArray(data) ? data : [];
  },

  addHistory(entry) {
    const history = this.getHistory();
    const item = {
      id: entry.id || 'hist_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      timestamp: new Date().toISOString(),
      status: entry.status || 'success',
      message: entry.message || '',
      imageUrl: entry.imageUrl || null,
      postId: entry.postId || null,
      fbUrl: entry.postId ? `https://facebook.com/${entry.postId}` : null,
      error: entry.error || null,
      source: entry.source || 'manual'
    };
    history.unshift(item);
    if (history.length > 200) history.length = 200;
    writeJsonFile(HISTORY_FILE, history);
    return item;
  },

  updateHistoryItem(id, updates) {
    const history = this.getHistory();
    const index = history.findIndex(h => h.id === id);
    if (index !== -1) {
      history[index] = { ...history[index], ...updates };
      writeJsonFile(HISTORY_FILE, history);
      return history[index];
    }
    return null;
  },

  clearHistory() {
    writeJsonFile(HISTORY_FILE, []);
    return [];
  },

  getQueue() {
    const data = readJsonFile(QUEUE_FILE, []);
    return Array.isArray(data) ? data : [];
  },

  addToQueue(item) {
    const queue = this.getQueue();
    const queueItem = {
      id: 'queue_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      message: item.message || '',
      imageUrl: item.imageUrl || null,
      createdAt: new Date().toISOString(),
      scheduledAt: item.scheduledAt ? new Date(item.scheduledAt).toISOString() : null,
      status: item.status || 'pending',
      generationSource: item.generationSource || 'manual',
      verified: item.verified === true,
      issues: Array.isArray(item.issues) ? item.issues : []
    };
    queue.push(queueItem);
    writeJsonFile(QUEUE_FILE, queue);
    return queueItem;
  },

  removeFromQueue(id) {
    let queue = this.getQueue();
    queue = queue.filter(q => q.id !== id);
    writeJsonFile(QUEUE_FILE, queue);
    return queue;
  },

  updateQueue(queue) {
    writeJsonFile(QUEUE_FILE, queue);
    return queue;
  },

  getAutomationRules() {
    if (!fs.existsSync(RULES_FILE)) {
      writeJsonFile(RULES_FILE, DEFAULT_RULES);
      return DEFAULT_RULES;
    }
    const data = readJsonFile(RULES_FILE, null);
    return data && typeof data === 'object' ? data : DEFAULT_RULES;
  },

  saveAutomationRules(rules) {
    writeJsonFile(RULES_FILE, rules);
    return rules;
  },

  addCommentRule(rule) {
    const rules = this.getAutomationRules();
    const newRule = {
      id: 'rule_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      name: rule.name || 'New Comment Rule',
      keywords: Array.isArray(rule.keywords) ? rule.keywords : (rule.keywords || '').split(',').map(k => k.trim()).filter(Boolean),
      publicReply: rule.publicReply || '',
      sendPrivateDm: !!rule.sendPrivateDm,
      privateDm: rule.privateDm || '',
      autoLike: rule.autoLike !== false,
      isActive: true
    };
    rules.commentRules = rules.commentRules || [];
    rules.commentRules.unshift(newRule);
    this.saveAutomationRules(rules);
    return newRule;
  },

  updateCommentRule(id, updates) {
    const rules = this.getAutomationRules();
    const index = (rules.commentRules || []).findIndex(r => r.id === id);
    if (index !== -1) {
      rules.commentRules[index] = { ...rules.commentRules[index], ...updates };
      this.saveAutomationRules(rules);
      return rules.commentRules[index];
    }
    return null;
  },

  deleteCommentRule(id) {
    const rules = this.getAutomationRules();
    rules.commentRules = (rules.commentRules || []).filter(r => r.id !== id);
    this.saveAutomationRules(rules);
    return rules.commentRules;
  },

  updateChatSettings(chatSettings) {
    const rules = this.getAutomationRules();
    rules.chatSettings = { ...(rules.chatSettings || {}), ...chatSettings };
    this.saveAutomationRules(rules);
    return rules.chatSettings;
  },

  // Templates Management
  getTemplates() {
    let templates = readJsonFile(TEMPLATES_FILE, null);
    if (!templates || !Array.isArray(templates) || templates.length === 0) {
      writeJsonFile(TEMPLATES_FILE, DEFAULT_TEMPLATES);
      return DEFAULT_TEMPLATES;
    }
    return templates;
  },

  saveTemplates(templates) {
    writeJsonFile(TEMPLATES_FILE, templates);
    return templates;
  },

  getTemplateById(id) {
    const templates = this.getTemplates();
    return templates.find(t => t.id === id) || null;
  },

  addTemplate(templateData) {
    const templates = this.getTemplates();
    const newTemplate = {
      id: 'template_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      title: templateData.title || 'Untitled Template',
      badge: templateData.badge || '📌 কাস্টম টেমপ্লেট',
      category: templateData.category || 'trending_news',
      imageUrl: templateData.imageUrl || '/robot.svg',
      desc: templateData.desc || 'Custom post template style for Facebook.',
      sample: templateData.sample || '📢 নতুন কাস্টম পোস্ট টেমপ্লেট!\n\nএখানে আপনার পোস্টের মূল বিষয়বস্তু লিখুন...\n\n#Trending #ViralPost #Template',
      learnedStyle: templateData.learnedStyle || null,
      createdAt: new Date().toISOString()
    };
    templates.unshift(newTemplate);
    this.saveTemplates(templates);
    return newTemplate;
  },

  deleteTemplate(id) {
    let templates = this.getTemplates();
    templates = templates.filter(t => t.id !== id);
    this.saveTemplates(templates);
    return templates;
  },

  updateTemplate(id, updates) {
    const templates = this.getTemplates();
    const idx = templates.findIndex(t => t.id === id);
    if (idx !== -1) {
      templates[idx] = { ...templates[idx], ...updates };
      this.saveTemplates(templates);
      return templates[idx];
    }
    return null;
  },

  getDataDir() {
    return DATA_DIR;
  },

  setDataDir(newDir) {
    updateFilePaths(newDir);
    return DATA_DIR;
  },

  DEFAULT_CATEGORIES
};

module.exports = storage;
