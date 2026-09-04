/**
 * Curated Fallback Posts Dataset
 * Provides emergency fallback content when upstream AI providers (Gemini / Pollinations)
 * are unreachable or fail safety checks.
 *
 * Requirements:
 * - Every fallback belongs to a registered category in DEFAULT_CATEGORIES
 * - verified defaults to false
 * - autoPublish defaults to false
 * - generationSource is 'curated_fallback'
 * - Clean UTF-8 Bengali with zero mojibake
 */

const FALLBACK_VIRAL_POSTS = [
  {
    id: 'fallback_science_diamond_planet',
    category: 'science_nature',
    badge: 'মহাকাশ বিজ্ঞান',
    line1_red: 'ডায়মন্ড গ্রহ',
    line1_white: 'মহাবিশ্বের ৫৫ ক্যানক্রি ই',
    line2_white: 'পুরোটাই খাঁটি হীরা দিয়ে তৈরি,',
    line2_yellow: 'যার মূল্য কল্পনাতীত!',
    search_term: '55 Cancri e diamond planet in deep space cosmic nebula 8k photography',
    post_caption: `💎 মহাবিশ্বে এমন এক গ্রহ রয়েছে যা পুরোটাই তৈরি খাঁটি হীরা ও গ্রাফাইট দিয়ে! 🌌✨\n\nবিজ্ঞানীদের আবিষ্কৃত এই গ্রহটির নাম '৫৫ ক্যানক্রি ই' (55 Cancri e)। পৃথিবী থেকে প্রায় ৪০ আলোকবর্ষ দূরে অবস্থিত এই এক্সোপ্ল্যানেটটি মহাকাশ বিজ্ঞানের অন্যতম বড় বিস্ময়।\n\n📌 চমকপ্রদ তথ্য:\n🔹 এই গ্রহের উপরিভাগের তাপমাত্রা প্রায় ২,৪০০ ডিগ্রি সেলসিয়াস।\n🔹 প্রচণ্ড চাপ ও তাপমাত্রার কারণে এর অভ্যন্তরীণ কার্বন সরাসরি খাঁটি হীরায় রূপান্তরিত হয়েছে।\n🔹 আমাদের পৃথিবীর চেয়ে গ্রহটি আকারে প্রায় দ্বিগুণ এবং ভর আট গুণ বেশি।\n\nমহাবিশ্বের এই অপার রহস্য বিজ্ঞানীদেরও বারবার তাক লাগিয়ে দেয়! 🚀🔭\n\n#SpaceMystery #DiamondPlanet #55CancriE #AstronomyFacts #ScienceBangla #DailyKnowledge`,
    generationSource: 'curated_fallback',
    verified: false,
    autoPublish: false
  },
  {
    id: 'fallback_psychology_brain_facts',
    category: 'psychology_mind',
    badge: 'মনস্তত্ত্ব ও মস্তিষ্ক',
    line1_red: 'মানব মস্তিষ্ক',
    line1_white: 'প্রতি সেকেন্ডে তৈরি করে',
    line2_white: 'হাজার হাজার নতুন চিন্তা,',
    line2_yellow: 'মেমোরি ক্ষমতা প্রায় অসীম!',
    search_term: 'Human brain glowing synapses neural network digital art 8k photorealistic',
    post_caption: `🧠 আমাদের মানব মস্তিষ্ক কতটা শক্তিশালী জানেন কি? বিজ্ঞানের অবাক করা কিছু সত্য! 💡✨\n\nসারা বিশ্বের সমস্ত সুপারকম্পিউটার একসাথে মিলেও আমাদের মস্তিষ্কের সমকক্ষ হতে পারবে না। মানব মস্তিষ্ক প্রকৃতির সবচেয়ে জটিল ও বিস্ময়কর সৃষ্টি।\n\n📌 কিছু অবিশ্বাস্য ব্রেন ফ্যাক্টস:\n🔹 মস্তিষ্কে প্রায় ৮৬ বিলিয়ন (৮,৬০০ কোটি) নিউরন অবিরাম সক্রিয় থাকে।\n🔹 প্রতি সেকেন্ডে মস্তিষ্ক প্রায় ১,০০,০০০ রাসায়নিক বিক্রিয়া পরিচালনা করে।\n🔹 মানুষ যখন ঘুমায়, তখনও স্মৃতি সাজিয়ে রাখার জন্য মস্তিষ্ক দিনটির ঘটনা প্রসেস করে।\n\nনিজের মানসিক ক্ষমতা বাড়াতে প্রতিদিন অন্তত ১৫ মিনিট নতুন কিছু শেখার অভ্যাস করুন! 📚✨\n\n#BrainFacts #Neuroscience #PsychologyTricks #HumanMind #MindPower #BanglaGK`,
    generationSource: 'curated_fallback',
    verified: false,
    autoPublish: false
  },
  {
    id: 'fallback_geography_mariana_trench',
    category: 'world_geography',
    badge: 'প্রকৃতির বিস্ময়',
    line1_red: 'মারিয়ানা ট্রেঞ্চ',
    line1_white: 'পৃথিবীর সবচেয়ে গভীর খাদ,',
    line2_white: 'যেখানে সূর্যের আলো ছাড়াই',
    line2_yellow: 'বাস করে অদ্ভুত সব প্রাণী!',
    search_term: 'Mariana Trench deep sea bioluminescent glowing creature dark ocean 8k photorealistic',
    post_caption: `🌊 সাগরের সবচেয়ে গভীর অন্ধকার রহস্য: মারিয়ানা ট্রেঞ্চের অবাক করা দুনিয়া! 🐟✨\n\nপ্রশান্ত মহাসাগরের অতল গহ্বরে অবস্থিত মারিয়ানা ট্রেঞ্চ পৃথিবীর সবচেয়ে গভীরতম স্থান। এর গভীরতা প্রায় ৩৬,০০০ ফুট (১১,০৩৪ মিটার)!\n\n📌 মারিয়ানা ট্রেঞ্চের কিছু অদ্ভুত তথ্য:\n🔹 এখানে পানির চাপ সমুদ্রপৃষ্ঠের চেয়ে প্রায় ১,০০০ গুণ বেশি, যা কোনো সাধারণ প্রাণীর টিকে থাকার পক্ষে অসম্ভব।\n🔹 ঘুটঘুটে অন্ধকারেও বেঁচে থাকে অদ্ভুত সব বায়োলুমিনেসেন্ট প্রাণী, যারা নিজেদের শরীর থেকেই আলো ছড়ায়।\n🔹 মাউন্ট এভারেস্টকে যদি এই খাদের নিচে রাখা হয়, তবে তার চূড়াও সমুদ্রের পানির ২ কিলোমিটার নিচে থাকবে!\n\nপ্রকৃতির এই অপার বিস্ময় বিজ্ঞানীদের আজও মুগ্ধ করে! 🌌🔭\n\n#MarianaTrench #DeepSeaMystery #OceanExploration #MarineBiology #NatureWonders #ScienceBangla`,
    generationSource: 'curated_fallback',
    verified: false,
    autoPublish: false
  },
  {
    id: 'fallback_history_nalanda',
    category: 'history_civilization',
    badge: 'ইতিহাসের রহস্য',
    line1_red: 'নালন্দা বিশ্ববিদ্যালয়',
    line1_white: 'প্রাচীন ভারতের শ্রেষ্ঠ জ্ঞানপীঠ,',
    line2_white: 'জ্ঞানের কেন্দ্রস্থল, যার লাইব্রেরি',
    line2_yellow: 'টানা ৬ মাস ধরে জ্বলেছিল!',
    search_term: 'Ancient Nalanda University ruins Bihar architectural grandeur daylight 8k photography',
    post_caption: `🏛️ প্রাচীন ভারতের গর্ব: বিশ্বের প্রথম আন্তর্জাতিক বিশ্ববিদ্যালয় নালন্দার বিস্ময়কর ইতিহাস! 📜✨\n\nবিহারের নালন্দা মহাবিহার ছিল প্রাচীন পৃথিবীর জ্ঞানচর্চার কেন্দ্র। চীন, জাপান, তিব্বত, গ্রিস ও মধ্য এশিয়ার হাজার হাজার পণ্ডিত এখানে পড়াশোনা করতে আসতেন।\n\n📌 ইতিহাসের কিছু সোনালী পাতা:\n🔹 নালন্দার লাইব্রেরি 'ধর্মগঞ্জ'-এ সংরক্ষিত ছিল প্রায় ৯০ লক্ষ হস্তলিখিত পুঁথি ও পাণ্ডুলিপি।\n🔹 ১২০৩ সালে এটি আক্রান্ত হলে লাইব্রেরির পাণ্ডুলিপির বিপুল সংগ্রহ টানা প্রায় ৬ মাস ধরে জ্বলেছিল।\n🔹 সম্পূর্ণ বিনা খরচে প্রায় ১০,০০০ ছাত্র ও ২,০০০ শিক্ষক এখানে বসবাস করে জ্ঞানসাধনা করতেন।\n\nআমাদের প্রাচীন ভারতের এই জ্ঞানভাণ্ডার আজও বিশ্বজুড়ে স্মরণীয়। 🇮🇳📖\n\n#NalandaUniversity #AncientIndia #IndianHeritage #HistoryFacts #IncredibleIndia #BanglaHistory`,
    generationSource: 'curated_fallback',
    verified: false,
    autoPublish: false
  },
  {
    id: 'fallback_nature_octopus',
    category: 'science_nature',
    badge: 'বন্যপ্রাণী তথ্য',
    line1_red: 'অক্টোপাস',
    line1_white: 'এমন এক প্রাণী যার রয়েছে',
    line2_white: '৩টি হৃৎপিণ্ড, ৯টি মস্তিষ্ক',
    line2_yellow: 'এবং নীল রঙের রক্ত!',
    search_term: 'Intelligent Octopus swimming underwater coral reef clear water 8k photography',
    post_caption: `🐙 সাগরের সবচেয়ে বুদ্ধিমান জীব: অক্টোপাসের অবিশ্বাস্য শারীরিক গঠন! 🌊🔬\n\nঅক্টোপাস শুধুমাত্র সাগরের এক জলজ প্রাণীই নয়, প্রাণীজগতের অন্যতম বুদ্ধিমান ও রহস্যময় জীব।\n\n📌 অক্টোপাসের অদ্ভুত তথ্য:\n🔹 অক্টোপাসের ৩টি হৃৎপিণ্ড এবং শরীরের প্রতিটি বাহুতে একটি করে মোট ৯টি স্নায়বিক মিনি-মস্তিষ্ক রয়েছে।\n🔹 এদের রক্তে লোহার পরিবর্তে কপার (তামা) থাকার কারণে রক্তের রং লাল নয়, বরং উজ্জ্বল নীল!\n🔹 চোখের পলকে এরা নিজের গায়ের রং এবং চামড়ার টেক্সচার পাথরের মতো পরিবর্তন করে লুকিয়ে পড়তে পারে।\n\nপ্রকৃতির এই অপার বিস্ময় আপনাকেও অবাক করবে! 🌊✨\n\n#OctopusFacts #MarineLife #AnimalIntelligence #NatureFacts #WildlifeWonder #ScienceGK`,
    generationSource: 'curated_fallback',
    verified: false,
    autoPublish: false
  },
  {
    id: 'fallback_science_chandrayaan3',
    category: 'science_nature',
    badge: 'ভারতীয় বিজ্ঞান',
    line1_red: 'ইসরোর চন্দ্রযান-৩',
    line1_white: 'বিশ্বের প্রথম দেশ হিসেবে',
    line2_white: 'চাঁদের দক্ষিণ মেরুতে পা রেখে',
    line2_yellow: 'বিশ্বমঞ্চে ইতিহাস গড়ল ভারত!',
    search_term: 'ISRO Chandrayaan-3 lunar lander touching down on moon south pole surface 8k cinematic photorealistic',
    post_caption: `🚀 চাঁদের দক্ষিণ মেরুতে ভারতের তেরঙ্গা: ইসরোর অবিস্মরণীয় মহাকাশ কীর্তি! 🇮🇳🌕\n\nচন্দ্রযান-৩ অভিযানের মাধ্যমে বিশ্বের প্রথম দেশ হিসেবে চাঁদের রহস্যময় দক্ষিণ মেরুতে সফলভাবে অবতরণ করে ভারত।\n\n📌 চন্দ্রযান-৩ এর মূল সাফল্য:\n🔹 বিক্রম ল্যান্ডার এবং প্রজ্ঞান রোভার চাঁদের মাটিতে সফল সফট ল্যান্ডিং সম্পন্ন করে।\n🔹 চাঁদের দক্ষিণ মেরুর মাটি ও খনিজের মধ্যে সালফারের উপস্থিতি নিশ্চিত করে প্রজ্ঞান রোভার।\n🔹 বিশ্বের তাবড় মহাকাশ সংস্থা যেখানে ব্যর্থ হয়েছিল, ভারত সেখানে অত্যন্ত স্বল্প খরচে বাজিমাত করেছে।\n\nপ্রতিটি ভারতীয়র জন্য এটি এক পরম গর্বের অধ্যায়! জয় হিন্দ! 🇮🇳✨\n\n#Chandrayaan3 #ISRO #ProudIndian #SpaceExploration #MoonLanding #ScienceIndia #CurrentAffairs`,
    generationSource: 'curated_fallback',
    verified: false,
    autoPublish: false
  },
  {
    id: 'fallback_tech_quantum',
    category: 'tech_inventions',
    badge: 'প্রযুক্তি সংবাদ',
    line1_red: 'কোয়ান্টাম কম্পিউটার',
    line1_white: 'যা করতে সুপারকম্পিউটারের',
    line2_white: 'লাখ বছর লাগত, তা করতে পারে',
    line2_yellow: 'মাত্র কয়েক মিনিটের ব্যবধানে!',
    search_term: 'Futuristic Quantum Computer golden chandelier processor clean lab 8k photography',
    post_caption: `💻 প্রযুক্তির ভবিষ্যৎ: কোয়ান্টাম কম্পিউটারের অবিশ্বাস্য গতি ও বিপ্লব! ⚡🔬\n\nপ্রথাগত সাধারণ বাইনারি কম্পিউটারের চেয়ে কোটি কোটি গুণ দ্রুত কাজ করতে সক্ষম এই কোয়ান্টাম কম্পিউটার।\n\n📌 কোয়ান্টাম কম্পিউটিংয়ের শক্তি:\n🔹 সাধারণ কম্পিউটার কাজ করে বিটস (০ এবং ১) দিয়ে; কোয়ান্টাম কম্পিউটার ব্যবহার করে কিউবিটস (Qubits)।\n🔹 সুপারপজিশন ও এনট্যাঙ্গেলমেন্টের কারণে এটি একসাথে লক্ষ লক্ষ জটিল হিসাব করতে পারে।\n🔹 ওষুধ আবিষ্কার, জটিল রোগের সমাধান ও মহাকাশের সিমুলেশনে এটি যুগান্তকারী পরিবর্তন আনবে।\n\nভবিষ্যতের পৃথিবী বদলে দিতে কোয়ান্টাম প্রযুক্তিই হতে চলেছে প্রধান হাতিয়ার! 🚀💡\n\n#QuantumComputing #FutureTech #ArtificialIntelligence #TechnologyNews #TechRevolution #BanglaTech`,
    generationSource: 'curated_fallback',
    verified: false,
    autoPublish: false
  },
  {
    id: 'fallback_sports_neeraj_chopra',
    category: 'sports_records',
    badge: 'খেলার খবর',
    line1_red: 'নীরজ চোপড়া',
    line1_white: 'অলিম্পিক ও বিশ্বমঞ্চে',
    line2_white: 'জ্যাভলিন হাতে দেশকে এনে দিলেন',
    line2_yellow: 'সোনার হরফে লেখা সাফল্য!',
    search_term: 'Neeraj Chopra throwing javelin stadium competition national jersey 8k photography',
    post_caption: `🥇 অদম্য জেদ আর কঠোর পরিশ্রমে ইতিহাস: ভারতের গোল্ডেন বয় নীরজ চোপড়া! 🇮🇳✨\n\nঅ্যাথলেটিক্সে ভারতের বহু দশকের পদক খরা কাটিয়ে দেশকে বারবার বিশ্বসেরার আসনে বসিয়েছেন হরিয়ানার এই তারকা।\n\n📌 সাফল্যের কিছু মাইলফলক:\n🔹 টোকিও অলিম্পিক্সে ৮৭.৫৮ মিটার থ্রো করে অ্যাথলেটিক্সে ভারতের প্রথম ব্যক্তিগত সোনা জয়।\n🔹 বিশ্ব অ্যাথলেটিক্স চ্যাম্পিয়নশিপ এবং ডায়মন্ড লিগেও চ্যাম্পিয়ন হয়ে ভারতের নাম উজ্জ্বল করেছেন।\n🔹 চোট-আঘাত পেরিয়েও নিজের ধারাবাহিক পারফরম্যান্স দিয়ে আজ তরুণ প্রজন্মের সবচেয়ে বড় অনুপ্রেরণা।\n\nপরিশ্রমের কোনো বিকল্প নেই, নীরজ চোপড়া তার জ্বলন্ত প্রমাণ! 🇮🇳🔥\n\n#NeerajChopra #GoldenBoy #IndianAthletics #JavelinThrow #Inspiration #SportsHero #SportsNews`,
    generationSource: 'curated_fallback',
    verified: false,
    autoPublish: false
  },
  {
    id: 'fallback_philosophy_ikigai',
    category: 'philosophy_wisdom',
    badge: 'জীবনদর্শন',
    line1_red: 'ইকিগাই দর্শন',
    line1_white: 'জাপানিদের দীর্ঘ ও সুখী জীবনের',
    line2_white: 'গোপন ৪টি সোনালী সূত্র, যা বদলে',
    line2_yellow: 'দিতে পারে আপনার বেঁচে থাকার অর্থ!',
    search_term: 'Japanese Ikigai balance Zen garden peaceful morning meditation 8k photography',
    post_caption: `🌸 দীর্ঘ, সুস্থ ও সুখী জীবনের জাপানি রহস্য: 'ইকিগাই' (Ikigai) দর্শন! 🌿✨\n\nজাপানের ওকিনাওয়া দ্বীপের মানুষ পৃথিবীর মধ্যে সবচেয়ে বেশি দিন বাঁচেন এবং সুস্থ থাকেন। তাদের এই শতায়ু জীবনের মূল চাবিকাঠি হলো 'ইকিগাই'—যার সহজ অর্থ হলো 'সকালে ঘুম থেকে ওঠার কারণ' বা জীবনের উদ্দেশ্য।\n\n📌 ইকিগাই দর্শনের ৪টি মূল স্তম্ভ:\n১. আপনি কী করতে ভালোবাসেন (Passion)\n২. কোন কাজে আপনি পারদর্শী (Vocation)\n৩. পৃথিবীর বা সমাজের কোন জিনিসটির প্রয়োজন (Mission)\n৪. কোন কাজের বিনিময়ে আপনি উপার্জন করতে পারেন (Profession)\n\nএই চারটির মিলনস্থলই হলো আপনার ইকিগাই। নিজের জীবনের লক্ষ্য খুঁজে নিন এবং প্রতিটি দিন আনন্দে বাঁচুন! 💡✨\n\n#Ikigai #LifeWisdom #Philosophy #Mindfulness #JapaneseWisdom #Inspiration #PersonalGrowth`,
    generationSource: 'curated_fallback',
    verified: false,
    autoPublish: false
  }
];

/**
 * Get all curated fallback posts
 */
function getFallbacks() {
  return FALLBACK_VIRAL_POSTS.map(f => ({ ...f }));
}

/**
 * Get fallback post matching category, or a general fallback
 */
function getFallbackForCategory(categoryId) {
  if (!categoryId || typeof categoryId !== 'string') {
    return { ...FALLBACK_VIRAL_POSTS[0] };
  }
  const cleanCategory = categoryId.toLowerCase().trim();
  const matches = FALLBACK_VIRAL_POSTS.filter(p => p.category.toLowerCase() === cleanCategory);
  if (matches.length > 0) {
    return { ...matches[Math.floor(Math.random() * matches.length)] };
  }
  return { ...FALLBACK_VIRAL_POSTS[0] };
}

module.exports = {
  FALLBACK_VIRAL_POSTS,
  getFallbacks,
  getFallbackForCategory
};
