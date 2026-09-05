const DEFAULT_TEMPLATES = [
  {
    id: 'template_news',
    title: 'Breaking / Trending News Analysis',
    badge: '📰 সাম্প্রতিক খবর',
    category: 'trending_news',
    imageUrl: 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=1080&h=1080&q=85',
    desc: 'Catch immediate viral attention with a sensational event breakdown.',
    sample: '🚨 ব্রেকিং নিউজ ও সমসাময়িক আপডেট! 📢✨\n\nআজকের আলোচিত ঘটনার পেছনের মূল তথ্য ও বিস্তারিত বিশ্লেষণ:\n\n📌 গুরুত্বপূর্ণ পয়েন্ট:\n🔹 মূল ঘটনা ও প্রেক্ষাপট...\n🔹 জনসাধারণের ওপর এর প্রভাব...\n🔹 বিশেষজ্ঞদের মতামত...\n\nএই বিষয়ে আপনার ব্যক্তিগত মতামত কি? কমেন্টে জানান! 👇\n\n#TrendingNews #BreakingNews #CurrentAffairs #ViralPost'
  },
  {
    id: 'template_science',
    title: 'Amazing Science & Nature Mystery',
    badge: '🔬 বিজ্ঞানের রহস্য',
    category: 'science_nature',
    imageUrl: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1080&h=1080&q=85',
    desc: 'Fascinating mind-bending facts about the cosmos, ocean or biology.',
    sample: '🌌 মহাবিশ্বের এমন এক রহস্য যা জানলে আপনার চোখ কপালে উঠবে! 🔭✨\n\nবিজ্ঞানীদের সাম্প্রতিক গবেষণায় উঠে এসেছে কিছু অবিশ্বাস্য তথ্য:\n\n📌 বিস্ময়কর ফ্যাক্টস:\n🔹 প্রথম অদ্ভুত সত্য...\n🔹 মানবদেহের ওপর এর চমকপ্রদ প্রভাব...\n🔹 পৃথিবী ও মহাকাশের অদ্ভুত সংযোগ...\n\nবিজ্ঞানের এমন অদ্ভুত সব তথ্য বন্ধুদের সাথে শেয়ার করতে ভুলবেন না! 🚀\n\n#ScienceFacts #AmazingUniverse #Astronomy #NatureMystery'
  },
  {
    id: 'template_history',
    title: 'Historical Heritage & Lost Legends',
    badge: '🏛️ ইতিহাসের রহস্য',
    category: 'history_civilization',
    imageUrl: 'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?auto=format&fit=crop&w=1080&h=1080&q=85',
    desc: 'Unveil the forgotten facts about ancient empires and heroic rulers.',
    sample: '🏛️ ইতিহাসের পাতা থেকে: এক অজানা বীরগাথা ও ধ্বংস হওয়া সাম্রাজ্যের গল্প! 📜✨\n\nআজ থেকে শত শত বছর আগের এক অবিস্মরণীয় ঘটনা:\n\n📌 ঐতিহাসিক সত্য:\n🔹 ঘটনার পেছনের আসল রহস্য...\n🔹 যুগান্তকারী যুদ্ধের ফলাফল...\n🔹 কীভাবে বদলে গিয়েছিল ইতিহাস...\n\nআমাদের সমৃদ্ধ ঐতিহ্য ও অতীত জানতে সঙ্গে থাকুন! 🇮🇳\n\n#IndianHistory #Heritage #HistoryFacts #AncientLegends'
  },
  {
    id: 'template_brain',
    title: 'Mind Power & Psychology Hacks',
    badge: '🧠 মানব মস্তিষ্ক',
    category: 'psychology_mind',
    imageUrl: 'https://images.unsplash.com/photo-1507499739999-097706ad8914?auto=format&fit=crop&w=1080&h=1080&q=85',
    desc: 'High-engagement behavioral psychology and memory habits.',
    sample: '🧠 প্রতিদিন সকালে এই ১টি ভুল করলেই কমে যায় আপনার ব্রেইনের শক্তি! 💡\n\nমনোবিজ্ঞান ও নিউরোসায়েন্সের গবেষণায় পাওয়া ৩টি দারুণ টিপস:\n\n📌 মস্তিষ্কের গোপন নিয়ম:\n🔹 স্মৃতিশক্তি বাড়ানোর সহজ কৌশল...\n🔹 মানসিক চাপ দ্রুত কমানোর উপায়...\n🔹 অবচেতন মনের অবিশ্বাস্য ক্ষমতা...\n\nনিজেকে প্রতিদিন ১% উন্নত করতে আজই শুরু করুন! 📚✨\n\n#PsychologyTricks #MindPower #SelfImprovement #BrainFacts'
  },
  {
    id: 'template_tech',
    title: 'AI Revolution & Future Inventions',
    badge: '💡 ভবিষ্যৎ প্রযুক্তি',
    category: 'tech_inventions',
    imageUrl: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1080&h=1080&q=85',
    desc: 'Viral discussions on artificial intelligence, robots, and tech jobs.',
    sample: '🤖 কৃত্রিম বুদ্ধিমত্তা (AI) কি সত্যিই প্রযুক্তির ভবিষ্যৎ বদলে দেবে? ⚡\n\nবিশ্বজুড়ে প্রযুক্তির দ্রুত পরিবর্তন নিয়ে যা বলছেন শীর্ষ বিজ্ঞানীরা:\n\n📌 প্রযুক্তির নতুন দিগন্ত:\n🔹 যে কাজগুলো এআই কখনোই করতে পারবে না...\n🔹 নতুন কী ধরণের চাকরির সুযোগ আসছে...\n🔹 সাধারণ মানুষ কীভাবে এতে লাভবান হবে...\n\nপ্রযুক্তির এই বিপ্লবে আপনার অভিমত কি? কমেন্টে জানান! 👇\n\n#ArtificialIntelligence #TechInventions #FutureTech #Innovation'
  },
  {
    id: 'template_wisdom',
    title: 'Inspiring Life Philosophy & Quotes',
    badge: '✨ জীবন ভাবনা',
    category: 'philosophy_wisdom',
    imageUrl: 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?auto=format&fit=crop&w=1080&h=1080&q=85',
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
  }
];


module.exports = { DEFAULT_TEMPLATES, DEFAULT_RULES, DEFAULT_CATEGORIES };
