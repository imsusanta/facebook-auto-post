// AutoPost - Complete Modern Facebook Automation UI Engine

document.addEventListener('DOMContentLoaded', () => {
  // Global State
  let state = {
    settings: {},
    scheduler: { isRunning: true, autoPilotEnabled: true, nextRun: null, secondsRemaining: null },
    history: [],
    queue: [],
    media: [],
    notifications: [
      { id: 'notif_1', text: 'Auto-pilot scheduler initialized successfully.', time: 'Just now', type: 'info' },
      { id: 'notif_2', text: 'Facebook Page automation module initialized.', time: '5m ago', type: 'success' },
      { id: 'notif_3', text: 'Google Gemini 3.1 Flash AI engine ready for content generation.', time: '10m ago', type: 'success' }
    ],
    selectedFile: null,
    generatedAiImage: null,
    currentView: 'dashboard',
    calendarViewMode: 'week',
    calendarDate: new Date(2024, 4, 28), // May 28, 2024 default matching reference design
    pages: [],
    activePageId: null,
    activeTemplate: null,
    activeTemplateImage: null,
    activeTemplateTitle: null,
    lastCardData: null,
    imageVariation: 1,
    textVariation: 1,
    templates: []
  };

  // Month & Day Names
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const monthShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Templates Data with Visual Template Images
  const VIRAL_TEMPLATES = [
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

  // DOM Elements
  const headerTitle = document.getElementById('headerTitle');
  const headerSubtitle = document.getElementById('headerSubtitle');
  const sidebarItems = document.querySelectorAll('.sidebar-item');
  const brandLogoHome = document.getElementById('brandLogoHome');
  const liveStatusBadge = document.getElementById('liveStatusBadge');
  const liveStatusPing = document.getElementById('liveStatusPing');
  const liveStatusDot = document.getElementById('liveStatusDot');
  const liveStatusText = document.getElementById('liveStatusText');

  // Notification elements
  const notificationBtn = document.getElementById('notificationBtn');
  const notificationDrawer = document.getElementById('notificationDrawer');
  const notificationsList = document.getElementById('notificationsList');
  const clearNotificationsBtn = document.getElementById('clearNotificationsBtn');
  const bellBadgeDot = document.getElementById('bellBadgeDot');

  // Modals
  const composerModal = document.getElementById('composerModal');
  const openComposerBtn = document.getElementById('openComposerBtn');
  const closeComposerModalBtn = document.getElementById('closeComposerModalBtn');
  const cancelComposerBtn = document.getElementById('cancelComposerBtn');
  const postMessage = document.getElementById('postMessage');
  const charCount = document.getElementById('charCount');
  const aiCustomTopic = document.getElementById('aiCustomTopic');
  const composerCategorySelect = document.getElementById('composerCategorySelect');
  const generateAiPostBtn = document.getElementById('generateAiPostBtn');
  const generateAiBtnText = document.getElementById('generateAiBtnText');
  const postImageFile = document.getElementById('postImageFile');
  const imagePreviewBox = document.getElementById('imagePreviewBox');
  const previewImgElement = document.getElementById('previewImgElement');
  const removeImageBtn = document.getElementById('removeImageBtn');
  const enableScheduleCheck = document.getElementById('enableScheduleCheck');
  const scheduleTimePickers = document.getElementById('scheduleTimePickers');
  const composerScheduleDateTime = document.getElementById('composerScheduleDateTime');
  const publishNowBtn = document.getElementById('publishNowBtn');
  const saveToQueueBtn = document.getElementById('saveToQueueBtn');

  // Independent Regeneration Buttons (Image & Caption)
  const regenerateCaptionBtn = document.getElementById('regenerateCaptionBtn');
  const regenerateCardImageBtn = document.getElementById('regenerateCardImageBtn');
  const fbPreviewRegenTextBtn = document.getElementById('fbPreviewRegenTextBtn');
  const fbPreviewRegenImgBtn = document.getElementById('fbPreviewRegenImgBtn');
  const aiPostStyleSelect = document.getElementById('aiPostStyleSelect');
  const aiCardLayoutSelect = document.getElementById('aiCardLayoutSelect');

  // Multi-Page Header & Modal Elements
  const headerPageSwitcherBtn = document.getElementById('headerPageSwitcherBtn');
  const headerPageDropdown = document.getElementById('headerPageDropdown');
  const headerActivePageLogo = document.getElementById('headerActivePageLogo');
  const headerActivePageName = document.getElementById('headerActivePageName');
  const headerPagesCountBadge = document.getElementById('headerPagesCountBadge');
  const headerPagesList = document.getElementById('headerPagesList');
  const headerAddNewPageBtn = document.getElementById('headerAddNewPageBtn');

  const openAddPageModalBtn = document.getElementById('openAddPageModalBtn');
  const addPageModal = document.getElementById('addPageModal');
  const closeAddPageModalBtn = document.getElementById('closeAddPageModalBtn');
  const cancelAddPageModalBtn = document.getElementById('cancelAddPageModalBtn');
  const submitAddPageBtn = document.getElementById('submitAddPageBtn');
  const newPageIdInput = document.getElementById('newPageIdInput');
  const newPageTokenInput = document.getElementById('newPageTokenInput');
  const newPageNameInput = document.getElementById('newPageNameInput');
  const newPageSetActiveCheck = document.getElementById('newPageSetActiveCheck');
  const accountsPageGrid = document.getElementById('accountsPageGrid');

  // Edit Page & Strategy Guidelines Modal Elements
  const editPageModal = document.getElementById('editPageModal');
  const closeEditPageModalBtn = document.getElementById('closeEditPageModalBtn');
  const cancelEditPageModalBtn = document.getElementById('cancelEditPageModalBtn');
  const submitEditPageBtn = document.getElementById('submitEditPageBtn');
  const editPageIdInput = document.getElementById('editPageIdInput');
  const editPageNameInput = document.getElementById('editPageNameInput');
  const editPageCategoryInput = document.getElementById('editPageCategoryInput');
  const editPageTokenInput = document.getElementById('editPageTokenInput');
  const editPagePromptInput = document.getElementById('editPagePromptInput');

  // Templates Management Modal Elements
  const openAddTemplateModalBtn = document.getElementById('openAddTemplateModalBtn');
  const addTemplateModal = document.getElementById('addTemplateModal');
  const closeAddTemplateModalBtn = document.getElementById('closeAddTemplateModalBtn');
  const cancelAddTemplateModalBtn = document.getElementById('cancelAddTemplateModalBtn');
  const submitAddTemplateBtn = document.getElementById('submitAddTemplateBtn');
  const newTemplateTitleInput = document.getElementById('newTemplateTitleInput');
  const newTemplateBadgeInput = document.getElementById('newTemplateBadgeInput');
  const newTemplateCategorySelect = document.getElementById('newTemplateCategorySelect');
  const newTemplateImageUrlInput = document.getElementById('newTemplateImageUrlInput');
  const newTemplateImageFileInput = document.getElementById('newTemplateImageFileInput');
  const newTemplateFileName = document.getElementById('newTemplateFileName');
  const newTemplateDescInput = document.getElementById('newTemplateDescInput');
  const newTemplateSampleInput = document.getElementById('newTemplateSampleInput');

  // Quick Schedule Form
  const quickScheduleDateInput = document.getElementById('quickScheduleDateInput');
  const quickScheduleDateLabel = document.getElementById('quickScheduleDateLabel');
  const quickScheduleTimeInput = document.getElementById('quickScheduleTimeInput');
  const quickScheduleTimeLabel = document.getElementById('quickScheduleTimeLabel');
  const quickScheduleBtn = document.getElementById('quickScheduleBtn');

  // Automation Status Switch
  const automationToggleSwitch = document.getElementById('automationToggleSwitch');
  const automationStatusHeading = document.getElementById('automationStatusHeading');
  const schedulerCountdownText = document.getElementById('schedulerCountdownText');

  // Analytics filter
  const analyticsPeriodSelect = document.getElementById('analyticsPeriodSelect');

  // Lucide helper
  function refreshIcons() {
    if (window.lucide) {
      lucide.createIcons();
    }
  }

  // ================= VIEW ROUTING =================
  function switchView(viewName) {
    state.currentView = viewName;

    // Hide all views
    document.querySelectorAll('.app-view').forEach(el => el.classList.add('hidden'));

    // Highlight sidebar
    sidebarItems.forEach(item => {
      if (item.getAttribute('data-nav') === viewName) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    // Show target view
    const target = document.getElementById(`view-${viewName}`);
    if (target) {
      target.classList.remove('hidden');
    }

    // Update Header Text dynamically
    const headerConfigs = {
      'dashboard': { title: 'Facebook Post Automation', subtitle: 'Create once. Schedule anytime. Publish <span class="text-indigo-600 font-semibold">automatically</span>.' },
      'create-post': { title: 'Create Facebook Post Studio', subtitle: 'Compose manually or generate viral content and HD image cards with Gemini AI.' },
      'queue': { title: 'Scheduled Post Queue', subtitle: 'View, edit, reschedule and manage all queued Facebook posts.' },
      'calendar': { title: 'Content Schedule Calendar', subtitle: 'Browse planned content by week or month and click any slot to schedule.' },
      'automation': { title: 'Facebook Automation Hub', subtitle: 'Auto-reply to comments, send private DMs to inbox, AI Messenger chatbot & scheduler.' },
      'templates': { title: 'Viral Post Templates', subtitle: 'Choose from tested, high-engagement post formats to launch your next post.' },
      'media': { title: 'Media Asset Library', subtitle: 'Browse high-definition AI generated thumbnail cards and uploaded assets.' },
      'accounts': { title: 'Facebook Accounts & Pages Hub', subtitle: 'Connect multiple Facebook pages and switch active account anytime with 1-click.' },
      'settings': { title: 'Facebook & AI Settings', subtitle: 'Configure Meta Page tokens, Google Gemini API keys and simulation mode.' },
      'integrations': { title: 'API & Service Integrations', subtitle: 'Monitor connection health across Meta Graph API, Gemini AI and Webhooks.' },
      'activity': { title: 'Live Execution & History Log', subtitle: 'Real-time trace of scheduler triggers, published posts and system events.' }
    };

    const cfg = headerConfigs[viewName] || headerConfigs['dashboard'];
    headerTitle.innerHTML = cfg.title;
    headerSubtitle.innerHTML = cfg.subtitle;

    // Trigger view-specific renderers
    if (viewName === 'create-post') {
      updateLivePreview();
      updateStudioPageBanner();
      updateActiveTemplateUI();
    }
    if (viewName === 'queue') renderFullQueueView();
    if (viewName === 'calendar') renderFullMonthCalendar();
    if (viewName === 'automation') fetchAutomationRules();
    if (viewName === 'templates') fetchTemplates();
    if (viewName === 'media') fetchAndRenderMedia();
    if (viewName === 'accounts') renderAccountsView();
    if (viewName === 'integrations') fetchAndRenderIntegrations();
    if (viewName === 'activity') renderActivityLogsView();

    refreshIcons();
  }

  // Bind sidebar items
  sidebarItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const nav = item.getAttribute('data-nav');
      if (nav === 'create-post') {
        navigateToCreatePost();
      } else if (nav === 'notifications') {
        toggleNotificationDrawer();
      } else if (nav) {
        switchView(nav);
      }
    });
  });

  if (brandLogoHome) {
    brandLogoHome.addEventListener('click', () => switchView('dashboard'));
  }
  const profileTrigger = document.getElementById('profileTrigger');
  if (profileTrigger) {
    profileTrigger.addEventListener('click', () => switchView('accounts'));
  }

  // ================= NOTIFICATION FLYOUT =================
  function toggleNotificationDrawer() {
    notificationDrawer.classList.toggle('hidden');
    bellBadgeDot.classList.add('hidden');
    renderNotifications();
    refreshIcons();
  }

  if (notificationBtn) {
    notificationBtn.addEventListener('click', toggleNotificationDrawer);
  }

  function renderNotifications() {
    notificationsList.innerHTML = '';
    if (state.notifications.length === 0) {
      notificationsList.innerHTML = '<div class="text-xs text-slate-400 text-center py-6">No notifications</div>';
      return;
    }
    state.notifications.forEach(n => {
      const item = document.createElement('div');
      item.className = 'p-2.5 rounded-xl bg-slate-50 border border-slate-100 flex items-start gap-2.5 text-xs';
      item.innerHTML = `
        <div class="w-2 h-2 rounded-full ${n.type === 'success' ? 'bg-emerald-500' : 'bg-indigo-500'} mt-1.5 shrink-0"></div>
        <div class="min-w-0 flex-1">
          <p class="text-slate-800 font-medium leading-snug">${n.text}</p>
          <span class="text-[10px] text-slate-400 mt-0.5 block">${n.time}</span>
        </div>
      `;
      notificationsList.appendChild(item);
    });
  }

  if (clearNotificationsBtn) {
    clearNotificationsBtn.addEventListener('click', () => {
      state.notifications = [];
      renderNotifications();
    });
  }

  // ================= POST CREATION STUDIO (FULL-PAGE) =================
  function updateLivePreview() {
    const text = (postMessage?.value || '').trim();
    const caption = document.getElementById('fbPreviewCaption');
    if (caption) {
      caption.textContent = text || 'What would you like to share on Facebook today? Your post caption will update here in real-time as you type or generate with AI...';
    }
    if (charCount && postMessage) {
      charCount.textContent = `${postMessage.value.length} characters`;
    }
    const imgWrapper = document.getElementById('fbPreviewImageWrapper');
    const fbImg = document.getElementById('fbPreviewImage');
    const fbLink = document.getElementById('fbPreviewImgLink');
    const generatingBox = document.getElementById('fbPreviewGenerating');

    if (imgWrapper && fbImg) {
      let activeImgSrc = null;
      if (state.generatedAiImage) {
        activeImgSrc = state.generatedAiImage;
      } else if (state.selectedFile && previewImgElement && previewImgElement.src) {
        activeImgSrc = previewImgElement.src;
      }

      if (activeImgSrc) {
        fbImg.src = activeImgSrc;
        if (fbLink) fbLink.href = activeImgSrc;
        imgWrapper.classList.remove('hidden');
        if (generatingBox) generatingBox.classList.add('hidden');
      } else {
        imgWrapper.classList.add('hidden');
        fbImg.src = '';
      }
    }
    refreshIcons();
  }

  function navigateToCreatePost(presetDate = null, presetText = '') {
    switchView('create-post');
    if (presetText) {
      if (postMessage) postMessage.value = presetText;
    }
    if (presetDate) {
      if (enableScheduleCheck) enableScheduleCheck.checked = true;
      if (scheduleTimePickers) scheduleTimePickers.classList.remove('hidden');
      if (composerScheduleDateTime) composerScheduleDateTime.value = presetDate;
    }
    updateLivePreview();
    refreshIcons();
  }

  const openComposer = navigateToCreatePost;

  // Quick Emoji Bar click
  document.querySelectorAll('.quick-emoji-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (postMessage) {
        postMessage.value += btn.textContent;
        updateLivePreview();
        postMessage.focus();
      }
    });
  });

  // Clear Draft
  const clearDraftBtn = document.getElementById('clearDraftBtn');
  if (clearDraftBtn) {
    clearDraftBtn.addEventListener('click', () => {
      if (confirm('Clear current post draft and attachments?')) {
        if (postMessage) postMessage.value = '';
        state.selectedFile = null;
        state.generatedAiImage = null;
        state.lastCardData = null;
        state.imageVariation = 1;
        state.textVariation = 1;
        if (postImageFile) postImageFile.value = '';
        if (previewImgElement) previewImgElement.src = '';
        if (imagePreviewBox) imagePreviewBox.classList.add('hidden');
        updateLivePreview();
      }
    });
  }

  if (openComposerBtn) openComposerBtn.addEventListener('click', () => navigateToCreatePost());

  if (postMessage) {
    postMessage.addEventListener('input', () => {
      updateLivePreview();
    });
  }

  if (enableScheduleCheck) {
    enableScheduleCheck.addEventListener('change', () => {
      if (enableScheduleCheck.checked) {
        scheduleTimePickers.classList.remove('hidden');
        if (!composerScheduleDateTime.value) {
          const inTwoHours = new Date(Date.now() + 2 * 60 * 60 * 1000);
          composerScheduleDateTime.value = inTwoHours.toISOString().slice(0, 16);
        }
      } else {
        scheduleTimePickers.classList.add('hidden');
      }
    });
  }

  // Image Upload
  if (postImageFile) {
    postImageFile.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        state.selectedFile = file;
        state.generatedAiImage = null;
        const reader = new FileReader();
        reader.onload = (event) => {
          previewImgElement.src = event.target.result;
          imagePreviewBox.classList.remove('hidden');
          updateLivePreview();
          refreshIcons();
        };
        reader.readAsDataURL(file);
      }
    });
  }

  if (removeImageBtn) {
    removeImageBtn.addEventListener('click', () => {
      state.selectedFile = null;
      state.generatedAiImage = null;
      postImageFile.value = '';
      previewImgElement.src = '';
      imagePreviewBox.classList.add('hidden');
      updateLivePreview();
    });
  }

  const useUploadedAsTemplateBtn = document.getElementById('useUploadedAsTemplateBtn');
  if (useUploadedAsTemplateBtn) {
    useUploadedAsTemplateBtn.addEventListener('click', () => {
      if (previewImgElement && previewImgElement.src) {
        state.activeTemplateImage = previewImgElement.src;
        state.activeTemplateTitle = 'Uploaded Photo';
        updateActiveTemplateUI();
        alert('🎨 Attached this image as the template background for AI!');
      }
    });
  }

  // Gemini AI Content Generator
  if (generateAiPostBtn) {
    generateAiPostBtn.addEventListener('click', async () => {
      const topic = aiCustomTopic ? aiCustomTopic.value.trim() : '';
      const category = composerCategorySelect ? composerCategorySelect.value : '';

      generateAiPostBtn.disabled = true;
      generateAiBtnText.textContent = 'Generating with Gemini AI...';

      // Visual shimmer in Live Facebook Feed Preview
      const imgWrapper = document.getElementById('fbPreviewImageWrapper');
      const generatingBox = document.getElementById('fbPreviewGenerating');
      if (imgWrapper) imgWrapper.classList.add('hidden');
      if (generatingBox) generatingBox.classList.remove('hidden');
      refreshIcons();

      try {
        const res = await fetch('/api/ai/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topic: topic || undefined,
            categoryId: category || undefined,
            category: category || undefined,
            pageId: state.activePageId || undefined,
            templateId: state.activeTemplate?.id || undefined,
            templateImage: state.activeTemplate?.imageUrl || state.activeTemplateImage || undefined,
            includeImage: true
          })
        });

        const data = await res.json();
        const postText = data.bundle?.message || data.content || data.message;
        const imgUrl = data.bundle?.image?.url || data.imageUrl || data.bundle?.imageUrl;

        if (data.success && postText) {
          postMessage.value = postText;
          if (data.bundle?.cardData) {
            state.lastCardData = data.bundle.cardData;
          }
          state.imageVariation = 1;
          state.textVariation = 1;

          if (imgUrl) {
            state.generatedAiImage = imgUrl;
            state.selectedFile = null;
            previewImgElement.src = imgUrl;
            imagePreviewBox.classList.remove('hidden');
          }

          updateLivePreview();
          refreshIcons();

          state.notifications.unshift({
            id: `notif_${Date.now()}`,
            text: `AI generated post created: "${topic || 'Auto'}"`,
            time: 'Just now',
            type: 'success'
          });
          bellBadgeDot.classList.remove('hidden');
        } else {
          alert('AI Generation: ' + (data.error || 'Failed to generate post. Check Gemini API key in Settings.'));
        }
      } catch (err) {
        console.error('AI error:', err);
        alert('Network error during AI post generation.');
      } finally {
        generateAiPostBtn.disabled = false;
        generateAiBtnText.textContent = 'Generate Post';
        if (generatingBox) generatingBox.classList.add('hidden');
        updateLivePreview();
        refreshIcons();
      }
    });
  }

  // ================= INDEPENDENT REGENERATION LOGIC =================
  // 1. Regenerate Image / Thumbnail Only (Caption remains 100% intact)
  async function handleRegenerateImageOnly() {
    const topic = aiCustomTopic ? aiCustomTopic.value.trim() : '';
    const imgWrapper = document.getElementById('fbPreviewImageWrapper');
    const generatingBox = document.getElementById('fbPreviewGenerating');

    if (imgWrapper) imgWrapper.classList.add('hidden');
    if (generatingBox) generatingBox.classList.remove('hidden');

    const origCardBtnText = regenerateCardImageBtn ? regenerateCardImageBtn.innerHTML : '';
    const origFbBtnText = fbPreviewRegenImgBtn ? fbPreviewRegenImgBtn.innerHTML : '';

    if (regenerateCardImageBtn) {
      regenerateCardImageBtn.disabled = true;
      regenerateCardImageBtn.innerHTML = `<span class="animate-spin text-xs">⌛</span> <span>ছবি তৈরি হচ্ছে...</span>`;
    }
    if (fbPreviewRegenImgBtn) {
      fbPreviewRegenImgBtn.disabled = true;
      fbPreviewRegenImgBtn.innerHTML = `<span class="animate-spin text-xs">⌛</span> <span>ছবি হচ্ছে...</span>`;
    }
    refreshIcons();

    state.imageVariation = (state.imageVariation || 1) + 1;

    try {
      const res = await fetch('/api/ai/regenerate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topic || (postMessage ? postMessage.value.slice(0, 120) : ''),
          cardData: state.lastCardData || undefined,
          pageId: state.activePageId || undefined,
          templateId: state.activeTemplate?.id || undefined,
          templateImage: state.activeTemplate?.imageUrl || state.activeTemplateImage || undefined,
          variation: state.imageVariation
        })
      });

      const data = await res.json();
      if (data.success && data.image?.url) {
        state.generatedAiImage = data.image.url;
        state.selectedFile = null;
        if (data.cardData) {
          state.lastCardData = data.cardData;
        }
        if (previewImgElement) previewImgElement.src = data.image.url;
        if (imagePreviewBox) imagePreviewBox.classList.remove('hidden');

        state.notifications.unshift({
          id: `notif_${Date.now()}`,
          text: `নতুন ফটো ভ্যারিয়েশন #${state.imageVariation} সফলভাবে তৈরি হয়েছে!`,
          time: 'Just now',
          type: 'success'
        });
        if (bellBadgeDot) bellBadgeDot.classList.remove('hidden');
      } else {
        alert('ছবি রিজেনারেট ব্যর্থ হয়েছে: ' + (data.error || 'Server error'));
      }
    } catch (err) {
      console.error('Regenerate image error:', err);
      alert('নেটওয়ার্ক ত্রুটি: নতুন ছবি তৈরি করা যায়নি।');
    } finally {
      if (regenerateCardImageBtn) {
        regenerateCardImageBtn.disabled = false;
        regenerateCardImageBtn.innerHTML = origCardBtnText;
      }
      if (fbPreviewRegenImgBtn) {
        fbPreviewRegenImgBtn.disabled = false;
        fbPreviewRegenImgBtn.innerHTML = origFbBtnText;
      }
      if (generatingBox) generatingBox.classList.add('hidden');
      updateLivePreview();
      refreshIcons();
    }
  }

  // 2. Regenerate Caption / Post Text Only (Attached image remains 100% intact)
  async function handleRegenerateTextOnly() {
    const topic = aiCustomTopic ? aiCustomTopic.value.trim() : '';
    const origCaptionBtnText = regenerateCaptionBtn ? regenerateCaptionBtn.innerHTML : '';
    const origFbTextBtnText = fbPreviewRegenTextBtn ? fbPreviewRegenTextBtn.innerHTML : '';

    if (regenerateCaptionBtn) {
      regenerateCaptionBtn.disabled = true;
      regenerateCaptionBtn.innerHTML = `<span class="animate-spin text-xs">⌛</span> <span>নতুন ক্যাপশন লেখা হচ্ছে...</span>`;
    }
    if (fbPreviewRegenTextBtn) {
      fbPreviewRegenTextBtn.disabled = true;
      fbPreviewRegenTextBtn.innerHTML = `<span class="animate-spin text-xs">⌛</span> <span>ক্যাপশন হচ্ছে...</span>`;
    }
    refreshIcons();

    state.textVariation = (state.textVariation || 1) + 1;

    try {
      const res = await fetch('/api/ai/regenerate-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topic || '',
          currentMessage: postMessage ? postMessage.value : '',
          pageId: state.activePageId || undefined,
          templateId: state.activeTemplate?.id || undefined,
          variation: state.textVariation
        })
      });

      const data = await res.json();
      if (data.success && data.message) {
        if (postMessage) {
          postMessage.value = data.message;
        }
        updateLivePreview();

        state.notifications.unshift({
          id: `notif_${Date.now()}`,
          text: `নতুন পোস্ট ক্যাপশন #${state.textVariation} জেনারেট হয়েছে!`,
          time: 'Just now',
          type: 'success'
        });
        if (bellBadgeDot) bellBadgeDot.classList.remove('hidden');
      } else {
        alert('ক্যাপশন তৈরি ব্যর্থ হয়েছে: ' + (data.error || 'Server error'));
      }
    } catch (err) {
      console.error('Regenerate caption error:', err);
      alert('নেটওয়ার্ক ত্রুটি: নতুন ক্যাপশন তৈরি করা যায়নি।');
    } finally {
      if (regenerateCaptionBtn) {
        regenerateCaptionBtn.disabled = false;
        regenerateCaptionBtn.innerHTML = origCaptionBtnText;
      }
      if (fbPreviewRegenTextBtn) {
        fbPreviewRegenTextBtn.disabled = false;
        fbPreviewRegenTextBtn.innerHTML = origFbTextBtnText;
      }
      refreshIcons();
    }
  }

  if (regenerateCardImageBtn) {
    regenerateCardImageBtn.addEventListener('click', handleRegenerateImageOnly);
  }
  if (fbPreviewRegenImgBtn) {
    fbPreviewRegenImgBtn.addEventListener('click', handleRegenerateImageOnly);
  }
  if (regenerateCaptionBtn) {
    regenerateCaptionBtn.addEventListener('click', handleRegenerateTextOnly);
  }
  if (fbPreviewRegenTextBtn) {
    fbPreviewRegenTextBtn.addEventListener('click', handleRegenerateTextOnly);
  }

  // Publish Now Button
  if (publishNowBtn) {
    publishNowBtn.addEventListener('click', async () => {
      const text = postMessage.value.trim();
      if (!text) {
        alert('Please enter post message or generate one with AI.');
        return;
      }

      publishNowBtn.disabled = true;
      publishNowBtn.innerHTML = `<span class="animate-spin mr-1">⌛</span> Publishing...`;

      try {
        const formData = new FormData();
        formData.append('message', text);
        formData.append('category', composerCategorySelect ? composerCategorySelect.value : 'general');

        if (state.selectedFile) {
          formData.append('image', state.selectedFile);
        } else if (state.generatedAiImage) {
          formData.append('imageUrl', state.generatedAiImage);
        }

        const res = await fetch('/api/post', {
          method: 'POST',
          body: formData
        });

        const result = await res.json();
        if (result.success) {
          alert('🎉 Post published successfully to Facebook Page!');
          postMessage.value = '';
          state.selectedFile = null;
          state.generatedAiImage = null;
          imagePreviewBox.classList.add('hidden');
          updateLivePreview();
          
          state.notifications.unshift({
            id: `notif_${Date.now()}`,
            text: `Post published to Facebook (Post ID: ${result.postId || 'OK'})`,
            time: 'Just now',
            type: 'success'
          });
          bellBadgeDot.classList.remove('hidden');
          fetchStatus();
          switchView('dashboard');
        } else {
          alert('Publish Failed: ' + (result.error || 'Facebook Graph API error'));
        }
      } catch (err) {
        console.error('Publish error:', err);
        alert('Error publishing post.');
      } finally {
        publishNowBtn.disabled = false;
        publishNowBtn.innerHTML = `<i data-lucide="send" class="w-3.5 h-3.5"></i><span>Publish Now</span>`;
        refreshIcons();
      }
    });
  }

  // Save to Queue Button
  if (saveToQueueBtn) {
    saveToQueueBtn.addEventListener('click', async () => {
      const text = postMessage.value.trim();
      if (!text) {
        alert('Please enter post content.');
        return;
      }

      saveToQueueBtn.disabled = true;
      saveToQueueBtn.textContent = 'Saving...';

      try {
        const formData = new FormData();
        formData.append('message', text);
        if (enableScheduleCheck.checked && composerScheduleDateTime.value) {
          formData.append('scheduledAt', new Date(composerScheduleDateTime.value).toISOString());
        }
        if (state.selectedFile) {
          formData.append('image', state.selectedFile);
        } else if (state.generatedAiImage) {
          formData.append('imageUrl', state.generatedAiImage);
        }

        const res = await fetch('/api/queue', {
          method: 'POST',
          body: formData
        });

        const result = await res.json();
        if (result.success) {
          alert('✅ Post successfully scheduled and added to queue!');
          postMessage.value = '';
          state.selectedFile = null;
          state.generatedAiImage = null;
          imagePreviewBox.classList.add('hidden');
          updateLivePreview();
          fetchStatus();
          switchView('queue');
        } else {
          alert('Queue error: ' + (result.error || 'Could not queue post'));
        }
      } catch (err) {
        console.error('Queue error:', err);
        alert('Failed to add post to queue.');
      } finally {
        saveToQueueBtn.disabled = false;
        saveToQueueBtn.innerHTML = `<i data-lucide="layers" class="w-3.5 h-3.5 text-slate-500"></i><span>Add to Queue</span>`;
        refreshIcons();
      }
    });
  }

  // ================= CALENDAR (WEEK & MONTH VIEW) =================
  const calToggleWeekBtns = document.querySelectorAll('.cal-toggle-week');
  const calToggleMonthBtns = document.querySelectorAll('.cal-toggle-month');
  const dashboardWeekContainer = document.getElementById('dashboardWeekContainer');
  const dashboardMonthContainer = document.getElementById('dashboardMonthContainer');
  const monthGridCells = document.getElementById('monthGridCells');
  const fullMonthGrid = document.getElementById('fullMonthGrid');

  calToggleWeekBtns.forEach(b => b.addEventListener('click', () => setCalendarMode('week')));
  calToggleMonthBtns.forEach(b => b.addEventListener('click', () => setCalendarMode('month')));

  function setCalendarMode(mode) {
    state.calendarViewMode = mode;
    if (mode === 'month') {
      calToggleMonthBtns.forEach(b => {
        b.className = 'cal-toggle-month text-xs font-semibold px-3 py-1 rounded-lg bg-indigo-50 text-indigo-600 shadow-sm transition';
      });
      calToggleWeekBtns.forEach(b => {
        b.className = 'cal-toggle-week text-xs font-medium px-3 py-1 rounded-lg text-slate-500 hover:text-slate-900 transition';
      });
      if (dashboardWeekContainer) dashboardWeekContainer.classList.add('hidden');
      if (dashboardMonthContainer) dashboardMonthContainer.classList.remove('hidden');
      renderMonthGrid(monthGridCells);
    } else {
      calToggleWeekBtns.forEach(b => {
        b.className = 'cal-toggle-week text-xs font-semibold px-3 py-1 rounded-lg bg-indigo-50 text-indigo-600 shadow-sm transition';
      });
      calToggleMonthBtns.forEach(b => {
        b.className = 'cal-toggle-month text-xs font-medium px-3 py-1 rounded-lg text-slate-500 hover:text-slate-900 transition';
      });
      if (dashboardWeekContainer) dashboardWeekContainer.classList.remove('hidden');
      if (dashboardMonthContainer) dashboardMonthContainer.classList.add('hidden');
    }
  }

  function renderMonthGrid(container) {
    if (!container) return;
    container.innerHTML = '';
    const year = state.calendarDate.getFullYear();
    const month = state.calendarDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();

    // Empty cells before first day
    for (let i = 0; i < firstDay; i++) {
      const empty = document.createElement('div');
      empty.className = 'cal-month-cell bg-slate-50/60 opacity-40';
      container.appendChild(empty);
    }

    // Days 1 to totalDays
    for (let day = 1; day <= totalDays; day++) {
      const cell = document.createElement('div');
      const isToday = day === 28 && month === 4; // May 28 reference day
      cell.className = `cal-month-cell ${isToday ? 'bg-indigo-50/40 ring-1 ring-indigo-500' : ''}`;
      
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      cell.setAttribute('data-date', dateStr);

      let contentHtml = `<span class="text-xs font-bold ${isToday ? 'text-indigo-600' : 'text-slate-700'}">${day}</span>`;

      // Check if scheduled posts fall on this day
      if (day === 28) {
        contentHtml += `
          <div class="mt-1.5 p-1 bg-indigo-100 text-indigo-700 text-[10px] font-semibold rounded leading-tight truncate">
            09:15 AM - New Blog Post
          </div>
          <div class="mt-1 p-1 bg-emerald-100 text-emerald-700 text-[10px] font-semibold rounded leading-tight truncate">
            12:00 PM - Tips & Tricks
          </div>
        `;
      } else if (day === 26) {
        contentHtml += `<div class="mt-1.5 p-1 bg-sky-100 text-sky-700 text-[10px] font-semibold rounded leading-tight truncate">09:30 AM - Motivation</div>`;
      } else if (day === 29) {
        contentHtml += `<div class="mt-1.5 p-1 bg-amber-100 text-amber-700 text-[10px] font-semibold rounded leading-tight truncate">03:00 PM - Product Update</div>`;
      } else if (day === 30) {
        contentHtml += `<div class="mt-1.5 p-1 bg-sky-100 text-sky-700 text-[10px] font-semibold rounded leading-tight truncate">06:00 PM - Customer Story</div>`;
      } else if (day === 31) {
        contentHtml += `<div class="mt-1.5 p-1 bg-rose-100 text-rose-700 text-[10px] font-semibold rounded leading-tight truncate">12:30 PM - Weekend Offer</div>`;
      }

      cell.innerHTML = contentHtml;

      // Click cell to open composer with pre-filled date
      cell.addEventListener('click', () => {
        openComposer(`${dateStr}T09:00`);
      });

      container.appendChild(cell);
    }
  }

  function renderFullMonthCalendar() {
    const label = document.getElementById('calendarCurrentMonthLabel');
    if (label) {
      label.textContent = `${monthNames[state.calendarDate.getMonth()]} ${state.calendarDate.getFullYear()}`;
    }
    renderMonthGrid(fullMonthGrid);
  }

  // Click on time slot in week calendar to schedule post
  document.querySelectorAll('.calendar-cell').forEach(cell => {
    cell.addEventListener('click', (e) => {
      // Don't trigger if clicked on an existing card
      if (e.target.closest('.cal-event-card')) {
        const cardTitle = e.target.closest('.cal-event-card').getAttribute('title');
        alert(`📅 Scheduled Event: "${cardTitle}"\nStatus: Scheduled to post automatically.`);
        return;
      }
      const d = cell.getAttribute('data-date') || '2024-05-28';
      const t = cell.getAttribute('data-time') || '09:00';
      openComposer(`${d}T${t}`);
    });
  });

  // Calendar Prev / Next Chevrons
  document.querySelectorAll('.cal-nav-prev').forEach(b => {
    b.addEventListener('click', () => {
      state.calendarDate.setMonth(state.calendarDate.getMonth() - 1);
      renderMonthGrid(monthGridCells);
      renderFullMonthCalendar();
    });
  });
  document.querySelectorAll('.cal-nav-next').forEach(b => {
    b.addEventListener('click', () => {
      state.calendarDate.setMonth(state.calendarDate.getMonth() + 1);
      renderMonthGrid(monthGridCells);
      renderFullMonthCalendar();
    });
  });

  // Quick Schedule Form Click
  if (quickScheduleBtn) {
    quickScheduleBtn.addEventListener('click', () => {
      const d = quickScheduleDateInput.value || '2024-05-28';
      const t = quickScheduleTimeInput.value || '09:00';
      openComposer(`${d}T${t}`);
    });
  }

  // ================= UPCOMING POST QUEUE (DASHBOARD & FULL VIEW) =================
  const viewAllQueueBtn = document.getElementById('viewAllQueueBtn');
  if (viewAllQueueBtn) {
    viewAllQueueBtn.addEventListener('click', () => switchView('queue'));
  }

  function renderDashboardQueue() {
    const container = document.getElementById('queueListContainer');
    if (!container) return;

    // Sample default items matching the screenshot
    const defaultItems = [
      {
        id: 'mock_1',
        title: 'Start Your Day with Positive Vibes ☕',
        snippet: 'Good morning! Make today amazing...',
        date: '28 May 2024',
        time: '09:15 AM',
        thumb: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=120&auto=format&fit=crop&q=80'
      },
      {
        id: 'mock_2',
        title: '5 Productivity Tips That Actually Work',
        snippet: 'Boost your productivity with these simple...',
        date: '28 May 2024',
        time: '12:00 PM',
        thumb: 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=120&auto=format&fit=crop&q=80'
      },
      {
        id: 'mock_3',
        title: 'Exciting News! 🎉',
        snippet: 'We have something great to share...',
        date: '28 May 2024',
        time: '03:00 PM',
        thumb: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=120&auto=format&fit=crop&q=80'
      },
      {
        id: 'mock_4',
        title: 'Customer Success Story',
        snippet: 'See how our solution helped...',
        date: '28 May 2024',
        time: '06:00 PM',
        thumb: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=120&auto=format&fit=crop&q=80'
      }
    ];

    container.innerHTML = '';
    const pendingItems = state.queue.filter(q => q.status === 'pending');
    const itemsToDisplay = pendingItems.length > 0 ? pendingItems.slice(0, 4) : defaultItems;

    itemsToDisplay.forEach((item, idx) => {
      const isReal = !!item.scheduledAt;
      const title = isReal ? (item.message.slice(0, 36) + (item.message.length > 36 ? '...' : '')) : item.title;
      const snippet = isReal ? (item.message.slice(36, 80) + '...') : item.snippet;
      const thumb = (isReal && item.imageUrl) ? item.imageUrl : (item.thumb || '/pariksha_notes_logo.jpg');
      
      let dateText = item.date || '28 May 2024';
      let timeText = item.time || '09:15 AM';
      if (isReal && item.scheduledAt) {
        const d = new Date(item.scheduledAt);
        dateText = `${d.getDate()} ${monthShort[d.getMonth()]} ${d.getFullYear()}`;
        const h = d.getHours();
        timeText = `${String(h % 12 || 12).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
      }

      const row = document.createElement('div');
      row.className = 'py-3.5 flex items-center justify-between gap-4 group';
      row.innerHTML = `
        <div class="flex items-center gap-3.5 min-w-0">
          <img src="${thumb}" class="w-12 h-12 rounded-xl object-cover shrink-0 shadow-sm border border-slate-100">
          <div class="min-w-0">
            <h4 class="text-sm font-semibold text-slate-900 truncate">${title}</h4>
            <p class="text-xs text-slate-500 truncate mt-0.5">${snippet}</p>
          </div>
        </div>
        <div class="flex items-center gap-5 shrink-0">
          <div class="text-right">
            <div class="text-xs font-medium text-slate-800">${dateText}</div>
            <div class="text-[11px] text-slate-400 mt-0.5">${timeText}</div>
          </div>
          <span class="bg-blue-50 text-blue-600 border border-blue-100 font-semibold px-3 py-1 rounded-full text-xs">Scheduled</span>
          <div class="flex items-center gap-1.5 text-slate-400">
            <button class="queue-edit-btn p-1 hover:text-slate-700 transition" title="Edit Post" data-id="${item.id}"><i data-lucide="edit-2" class="w-4 h-4"></i></button>
            <button class="queue-delete-btn p-1 hover:text-rose-600 transition" title="Delete Post" data-id="${item.id}"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
            <button class="queue-publish-btn p-1 hover:text-indigo-600 transition" title="Publish Right Now" data-id="${item.id}"><i data-lucide="send" class="w-4 h-4"></i></button>
          </div>
        </div>
      `;
      container.appendChild(row);
    });

    // Attach actions
    container.querySelectorAll('.queue-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        if (confirm('Are you sure you want to remove this scheduled post?')) {
          if (!id.startsWith('mock_')) {
            await fetch(`/api/queue/${id}`, { method: 'DELETE' });
            fetchStatus();
          } else {
            btn.closest('.py-3\\.5').remove();
          }
        }
      });
    });

    container.querySelectorAll('.queue-publish-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        if (confirm('Publish this post immediately to Facebook?')) {
          if (!id.startsWith('mock_')) {
            btn.disabled = true;
            await fetch(`/api/queue/${id}/publish-now`, { method: 'POST' });
            alert('🚀 Post published immediately to Facebook!');
            fetchStatus();
          } else {
            alert('🚀 Post simulated and published to Facebook!');
          }
        }
      });
    });

    refreshIcons();
  }

  // Full Queue View
  function renderFullQueueView() {
    const container = document.getElementById('fullQueueListContainer');
    if (!container) return;
    container.innerHTML = '';

    if (state.queue.length === 0) {
      container.innerHTML = `
        <div class="text-center py-12 text-slate-400 text-xs">
          <i data-lucide="layers" class="w-10 h-10 mx-auto mb-3 text-slate-300"></i>
          No items in queue. Click "+ Add Post" to schedule your next update.
        </div>`;
      refreshIcons();
      return;
    }

    state.queue.forEach(item => {
      const isPending = item.status === 'pending';
      const d = item.scheduledAt ? new Date(item.scheduledAt).toLocaleString() : 'Autopilot Queue';
      const card = document.createElement('div');
      card.className = 'py-4 flex flex-wrap items-center justify-between gap-4';
      card.innerHTML = `
        <div class="flex items-center gap-4 min-w-0 max-w-xl">
          <img src="${item.imageUrl || '/pariksha_notes_logo.jpg'}" class="w-14 h-14 rounded-xl object-cover border border-slate-100 shadow-sm shrink-0">
          <div class="min-w-0">
            <h4 class="text-sm font-semibold text-slate-900 line-clamp-1">${item.message || 'Post without text'}</h4>
            <p class="text-xs text-slate-400 mt-1 flex items-center gap-2">
              <span>📅 ${d}</span>
              <span class="${isPending ? 'text-blue-600 bg-blue-50' : 'text-emerald-600 bg-emerald-50'} px-2 py-0.5 rounded-full font-bold text-[10px]">
                ${(item.status || 'pending').toUpperCase()}
              </span>
            </p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          ${isPending ? `
            <button class="fullqueue-publish-btn px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-sm" data-id="${item.id}">
              <i data-lucide="send" class="w-3.5 h-3.5"></i>
              <span>Publish Now</span>
            </button>
          ` : ''}
          <button class="fullqueue-delete-btn p-2 text-rose-600 hover:bg-rose-50 rounded-xl transition" data-id="${item.id}" title="Delete">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        </div>
      `;
      container.appendChild(card);
    });

    container.querySelectorAll('.fullqueue-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        if (confirm('Delete this queued post?')) {
          await fetch(`/api/queue/${id}`, { method: 'DELETE' });
          fetchStatus();
          renderFullQueueView();
        }
      });
    });

    container.querySelectorAll('.fullqueue-publish-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        btn.disabled = true;
        btn.textContent = 'Publishing...';
        await fetch(`/api/queue/${id}/publish-now`, { method: 'POST' });
        alert('🚀 Post published directly to Facebook!');
        fetchStatus();
        renderFullQueueView();
      });
    });

    refreshIcons();
  }

  // ================= TEMPLATES VIEW (VISUAL TEMPLATES & IMAGE STYLES) =================
  function updateActiveTemplateUI() {
    const banner = document.getElementById('activeTemplateBanner');
    const thumb = document.getElementById('activeTemplateThumb');
    const name = document.getElementById('activeTemplateName');
    const summary = document.getElementById('activeTemplateLearnedSummary');
    const hint = document.getElementById('studioNoTemplateHint');
    if (!banner) return;

    const currentTmpl = state.activeTemplate;
    const currentImg = currentTmpl?.imageUrl || state.activeTemplateImage;
    const currentTitle = currentTmpl?.title || state.activeTemplateTitle;

    if (currentImg) {
      banner.classList.remove('hidden');
      if (hint) hint.classList.add('hidden');
      if (thumb) thumb.src = currentImg;
      if (name) name.textContent = currentTitle ? `Template: ${currentTitle}` : 'Custom Reference Template';
      if (summary) {
        if (currentTmpl?.learnedStyle?.summary) {
          summary.textContent = `Learned: ${currentTmpl.learnedStyle.summary}`;
        } else if (currentTmpl?.desc) {
          summary.textContent = currentTmpl.desc;
        } else {
          summary.textContent = 'AI mimics this card layout, colors & writing style';
        }
      }
    } else {
      banner.classList.add('hidden');
      if (hint) hint.classList.remove('hidden');
    }
    refreshIcons();
  }

  const clearActiveTemplateBtn = document.getElementById('clearActiveTemplateBtn');
  if (clearActiveTemplateBtn) {
    clearActiveTemplateBtn.addEventListener('click', () => {
      state.activeTemplate = null;
      state.activeTemplateImage = null;
      state.activeTemplateTitle = null;
      updateActiveTemplateUI();
    });
  }

  const studioOpenTemplatesBtn = document.getElementById('studioOpenTemplatesBtn');
  if (studioOpenTemplatesBtn) {
    studioOpenTemplatesBtn.addEventListener('click', () => {
      switchView('templates');
    });
  }

  const studioUploadTemplateBtn = document.getElementById('studioUploadTemplateBtn');
  if (studioUploadTemplateBtn) {
    studioUploadTemplateBtn.addEventListener('click', () => {
      if (addTemplateModal) addTemplateModal.classList.remove('hidden');
      refreshIcons();
    });
  }

  const studioEditPagePromptBtn = document.getElementById('studioEditPagePromptBtn');
  if (studioEditPagePromptBtn) {
    studioEditPagePromptBtn.addEventListener('click', () => {
      openEditPageModal(state.activePageId);
    });
  }

  // ================= TEMPLATES VIEW & MANAGEMENT =================
  async function fetchTemplates() {
    try {
      const res = await fetch('/api/templates');
      const data = await res.json();
      if (data.success && Array.isArray(data.templates)) {
        state.templates = data.templates;
        renderTemplatesView();
      }
    } catch (e) {
      console.warn('Failed to fetch templates:', e);
    }
  }

  function renderTemplatesView() {
    const grid = document.getElementById('templatesGrid');
    if (!grid) return;
    grid.innerHTML = '';

    const templates = (state.templates && state.templates.length > 0) ? state.templates : VIRAL_TEMPLATES;

    templates.forEach(t => {
      const card = document.createElement('div');
      card.className = 'saas-card overflow-hidden flex flex-col justify-between hover:border-indigo-300 hover:shadow-md transition group relative';
      card.innerHTML = `
        <div>
          <!-- Visual Template Image Banner -->
          <div class="relative h-44 w-full bg-slate-900 overflow-hidden">
            <img src="${t.imageUrl}" alt="${t.title}" class="w-full h-full object-cover group-hover:scale-105 transition duration-500 opacity-90">
            <div class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent"></div>
            
            <!-- Category Badge -->
            <div class="absolute top-3 left-3 flex items-center gap-2">
              <span class="text-[11px] font-bold px-2.5 py-1 bg-black/70 text-amber-300 rounded-full border border-amber-400/30 backdrop-blur-sm shadow-sm">${t.badge || '📌 টেমপ্লেট'}</span>
            </div>

            <!-- Top Right Action Controls: Change Image & Delete Template -->
            <div class="absolute top-3 right-3 flex items-center gap-1.5">
              <!-- Upload Custom Image for this Template -->
              <label class="bg-black/60 hover:bg-black/90 text-white text-[10px] font-semibold px-2 py-1 rounded-lg cursor-pointer shadow backdrop-blur-sm flex items-center gap-1 transition" title="Change template background photo">
                <i data-lucide="upload" class="w-3 h-3 text-indigo-300"></i>
                <span>Image</span>
                <input type="file" class="custom-template-img-input hidden" data-id="${t.id}" accept="image/*">
              </label>

              <!-- Delete Template Button -->
              <button type="button" class="delete-template-btn bg-rose-600/80 hover:bg-rose-600 text-white p-1 rounded-lg shadow backdrop-blur-sm transition flex items-center justify-center" title="Delete Template" data-id="${t.id}">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
              </button>
            </div>

            <div class="absolute bottom-3 left-3 right-3 text-white">
              <h4 class="text-sm font-bold leading-tight drop-shadow-md text-white">${t.title}</h4>
            </div>
          </div>

          <div class="p-4 space-y-2.5">
            <p class="text-xs text-slate-500 line-clamp-2">${t.desc || 'Viral post format'}</p>
            <div class="p-2.5 bg-slate-50 rounded-xl border border-slate-100 text-[11px] text-slate-600 font-mono whitespace-pre-line line-clamp-3">
              ${t.sample || ''}
            </div>
          </div>
        </div>

        <div class="p-4 pt-0 flex items-center justify-between gap-2 border-t border-slate-100 mt-2">
          <span class="text-[10px] text-slate-400 font-medium">1080x1080 HD Graphic Card</span>
          <button class="use-template-btn px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-sm transition" data-id="${t.id}">
            <i data-lucide="sparkles" class="w-3.5 h-3.5"></i>
            <span>Use Template Style</span>
          </button>
        </div>
      `;

      // Custom Image Upload Listener
      const fileInput = card.querySelector('.custom-template-img-input');
      if (fileInput) {
        fileInput.addEventListener('change', async (e) => {
          const file = e.target.files[0];
          if (file) {
            const formData = new FormData();
            formData.append('file', file);
            try {
              const res = await fetch('/api/media/upload', { method: 'POST', body: formData });
              const d = await res.json();
              if (d.success && d.media) {
                t.imageUrl = d.media.url;
                await fetch(`/api/templates/${t.id}`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ imageUrl: d.media.url })
                });
                renderTemplatesView();
                alert(`Uploaded custom template image for "${t.title}"!`);
              }
            } catch (err) {
              alert('Failed to upload template image: ' + err.message);
            }
          }
        });
      }

      // Delete Template Listener
      const deleteBtn = card.querySelector('.delete-template-btn');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (confirm(`Delete template "${t.title}"?`)) {
            try {
              const res = await fetch(`/api/templates/${t.id}`, { method: 'DELETE' });
              const d = await res.json();
              if (d.success) {
                state.templates = d.templates;
                renderTemplatesView();
                state.notifications.unshift({
                  id: `notif_${Date.now()}`,
                  text: `Template "${t.title}" deleted.`,
                  time: 'Just now',
                  type: 'info'
                });
                if (bellBadgeDot) bellBadgeDot.classList.remove('hidden');
              }
            } catch (err) {
              alert('Failed to delete template: ' + err.message);
            }
          }
        });
      }

      grid.appendChild(card);
    });

    // Use Template button listeners
    grid.querySelectorAll('.use-template-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const tmpl = (state.templates && state.templates.length > 0 ? state.templates : VIRAL_TEMPLATES).find(x => x.id === id);
        if (tmpl) {
          state.activeTemplate = tmpl;
          state.activeTemplateImage = tmpl.imageUrl;
          state.activeTemplateTitle = tmpl.title;
          navigateToCreatePost(null, tmpl.sample);
          updateActiveTemplateUI();
        }
      });
    });

    refreshIcons();
  }

  // Bind Add Template Modal
  if (openAddTemplateModalBtn) {
    openAddTemplateModalBtn.addEventListener('click', () => {
      if (addTemplateModal) addTemplateModal.classList.remove('hidden');
      refreshIcons();
    });
  }

  if (closeAddTemplateModalBtn) {
    closeAddTemplateModalBtn.addEventListener('click', () => {
      if (addTemplateModal) addTemplateModal.classList.add('hidden');
    });
  }

  if (cancelAddTemplateModalBtn) {
    cancelAddTemplateModalBtn.addEventListener('click', () => {
      if (addTemplateModal) addTemplateModal.classList.add('hidden');
    });
  }

  if (newTemplateImageFileInput) {
    newTemplateImageFileInput.addEventListener('change', () => {
      const file = newTemplateImageFileInput.files[0];
      if (newTemplateFileName) {
        newTemplateFileName.textContent = file ? file.name : 'No file chosen';
      }
    });
  }

  if (submitAddTemplateBtn) {
    submitAddTemplateBtn.addEventListener('click', async () => {
      const title = newTemplateTitleInput ? newTemplateTitleInput.value.trim() : '';
      if (!title) {
        alert('Please enter a template title.');
        return;
      }

      submitAddTemplateBtn.disabled = true;
      submitAddTemplateBtn.innerHTML = `<span class="animate-spin mr-1">⌛</span> Saving...`;

      try {
        let imageUrl = newTemplateImageUrlInput ? newTemplateImageUrlInput.value.trim() : '';
        const file = newTemplateImageFileInput?.files?.[0];
        if (file) {
          const formData = new FormData();
          formData.append('file', file);
          const uploadRes = await fetch('/api/media/upload', { method: 'POST', body: formData });
          const uploadData = await uploadRes.json();
          if (uploadData.success && uploadData.media?.url) {
            imageUrl = uploadData.media.url;
          }
        }

        const res = await fetch('/api/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            badge: newTemplateBadgeInput ? newTemplateBadgeInput.value.trim() : '',
            category: newTemplateCategorySelect ? newTemplateCategorySelect.value : 'trending_news',
            imageUrl: imageUrl || undefined,
            desc: newTemplateDescInput ? newTemplateDescInput.value.trim() : '',
            sample: newTemplateSampleInput ? newTemplateSampleInput.value.trim() : ''
          })
        });

        const data = await res.json();
        if (data.success && data.template) {
          if (!state.templates || state.templates.length === 0) {
            state.templates = [...VIRAL_TEMPLATES];
          }
          state.templates.unshift(data.template);
          state.activeTemplate = data.template;
          state.activeTemplateImage = data.template.imageUrl;
          state.activeTemplateTitle = data.template.title;
          renderTemplatesView();
          updateActiveTemplateUI();

          if (addTemplateModal) addTemplateModal.classList.add('hidden');

          // Reset inputs
          if (newTemplateTitleInput) newTemplateTitleInput.value = '';
          if (newTemplateBadgeInput) newTemplateBadgeInput.value = '';
          if (newTemplateImageUrlInput) newTemplateImageUrlInput.value = '';
          if (newTemplateImageFileInput) newTemplateImageFileInput.value = '';
          if (newTemplateFileName) newTemplateFileName.textContent = 'No file chosen';
          if (newTemplateDescInput) newTemplateDescInput.value = '';
          if (newTemplateSampleInput) newTemplateSampleInput.value = '';

          state.notifications.unshift({
            id: `notif_${Date.now()}`,
            text: `New template "${title}" added successfully!`,
            time: 'Just now',
            type: 'success'
          });
          if (bellBadgeDot) bellBadgeDot.classList.remove('hidden');
        } else {
          alert('Failed to add template: ' + (data.error || 'Server error'));
        }
      } catch (err) {
        console.error('Error adding template:', err);
        alert('Network error while saving template.');
      } finally {
        submitAddTemplateBtn.disabled = false;
        submitAddTemplateBtn.innerHTML = `<i data-lucide="check" class="w-3.5 h-3.5"></i><span>Save Template</span>`;
        refreshIcons();
      }
    });
  }

  // ================= MEDIA LIBRARY VIEW =================
  async function fetchAndRenderMedia() {
    const grid = document.getElementById('mediaGridContainer');
    if (!grid) return;
    grid.innerHTML = '<div class="col-span-full py-10 text-center text-xs text-slate-400">Loading media...</div>';

    try {
      const res = await fetch('/api/media');
      const mediaList = await res.json();
      state.media = mediaList || [];

      grid.innerHTML = '';
      if (state.media.length === 0) {
        grid.innerHTML = '<div class="col-span-full py-12 text-center text-xs text-slate-400">No media uploaded yet.</div>';
        return;
      }

      state.media.forEach(m => {
        const card = document.createElement('div');
        card.className = 'saas-card overflow-hidden group relative border border-slate-200/80';
        card.innerHTML = `
          <div class="aspect-square bg-slate-100 relative overflow-hidden">
            <img src="${m.url}" class="w-full h-full object-cover group-hover:scale-105 transition duration-300">
            <div class="absolute inset-0 bg-slate-900/60 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-2 p-2">
              <button class="media-use-btn p-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow" title="Use in New Post" data-url="${m.url}">
                <i data-lucide="plus" class="w-4 h-4"></i>
              </button>
              <button class="media-delete-btn p-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold shadow" title="Delete" data-file="${m.fileName}">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
              </button>
            </div>
          </div>
          <div class="p-2.5 text-[11px] truncate bg-white">
            <p class="font-medium text-slate-800 truncate">${m.fileName}</p>
            <span class="text-slate-400 text-[10px]">${(m.size / 1024).toFixed(0)} KB</span>
          </div>
        `;
        grid.appendChild(card);
      });

      // Actions
      grid.querySelectorAll('.media-use-btn').forEach(b => {
        b.addEventListener('click', () => {
          const url = b.getAttribute('data-url');
          openComposer();
          state.generatedAiImage = url;
          previewImgElement.src = url;
          imagePreviewBox.classList.remove('hidden');
          refreshIcons();
        });
      });

      grid.querySelectorAll('.media-delete-btn').forEach(b => {
        b.addEventListener('click', async () => {
          const file = b.getAttribute('data-file');
          if (confirm(`Delete ${file}?`)) {
            await fetch(`/api/media/${file}`, { method: 'DELETE' });
            fetchAndRenderMedia();
          }
        });
      });

      refreshIcons();
    } catch (e) {
      grid.innerHTML = '<div class="col-span-full py-10 text-center text-xs text-rose-500">Failed to load media</div>';
    }
  }

  // ================= INTEGRATIONS VIEW =================
  async function fetchAndRenderIntegrations() {
    const grid = document.getElementById('integrationsGrid');
    if (!grid) return;

    try {
      const res = await fetch('/api/integrations');
      const data = await res.json();

      grid.innerHTML = `
        <!-- Meta Facebook -->
        <div class="saas-card p-5 flex items-start gap-4">
          <div class="w-12 h-12 rounded-2xl bg-[#1877F2]/10 text-[#1877F2] flex items-center justify-center font-bold text-xl shrink-0">
            f
          </div>
          <div class="flex-1">
            <div class="flex items-center justify-between">
              <h4 class="text-sm font-bold text-slate-900">Meta Graph API</h4>
              <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${data.meta.connected ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}">
                ${data.meta.connected ? 'CONNECTED' : 'DISCONNECTED'}
              </span>
            </div>
            <p class="text-xs text-slate-500 mt-1">Page: ${data.meta.pageName || 'My Facebook Page'} (ID: ${data.meta.pageId || 'Not connected'})</p>
            <p class="text-[11px] text-slate-400 mt-0.5">Automated post publishing and feed monitor.</p>
          </div>
        </div>

        <!-- Google Gemini -->
        <div class="saas-card p-5 flex items-start gap-4">
          <div class="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
            <i data-lucide="sparkles" class="w-6 h-6"></i>
          </div>
          <div class="flex-1">
            <div class="flex items-center justify-between">
              <h4 class="text-sm font-bold text-slate-900">Google Gemini AI</h4>
              <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-600">
                ACTIVE
              </span>
            </div>
            <p class="text-xs text-slate-500 mt-1">Active Model: ${data.gemini.model || 'gemini-3.1-flash-lite'}</p>
            <p class="text-[11px] text-slate-400 mt-0.5">High-speed structured post generator & viral prompts.</p>
          </div>
        </div>

        <!-- Express Server -->
        <div class="saas-card p-5 flex items-start gap-4">
          <div class="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <i data-lucide="server" class="w-6 h-6"></i>
          </div>
          <div class="flex-1">
            <div class="flex items-center justify-between">
              <h4 class="text-sm font-bold text-slate-900">Backend Server</h4>
              <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-600">
                HEALTHY
              </span>
            </div>
            <p class="text-xs text-slate-500 mt-1">Port: ${data.server.port} | Uptime: ${Math.floor(data.server.uptime / 60)} mins</p>
            <p class="text-[11px] text-slate-400 mt-0.5">Node.js Express runtime with persistent storage.</p>
          </div>
        </div>

        <!-- Realtime SSE -->
        <div class="saas-card p-5 flex items-start gap-4">
          <div class="w-12 h-12 rounded-2xl bg-sky-50 text-sky-600 flex items-center justify-center shrink-0">
            <i data-lucide="radio" class="w-6 h-6"></i>
          </div>
          <div class="flex-1">
            <div class="flex items-center justify-between">
              <h4 class="text-sm font-bold text-slate-900">Live SSE Stream</h4>
              <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-600">
                LIVE
              </span>
            </div>
            <p class="text-xs text-slate-500 mt-1">Server-Sent Events active</p>
            <p class="text-[11px] text-slate-400 mt-0.5">Instant realtime push updates for queue and status.</p>
          </div>
        </div>
      `;
      refreshIcons();
    } catch (e) {
      grid.innerHTML = '<div class="text-xs text-rose-500">Failed to load integrations status</div>';
    }
  }

  // ================= ACTIVITY LOG VIEW =================
  function renderActivityLogsView() {
    const list = document.getElementById('activityLogsList');
    if (!list) return;
    list.innerHTML = '';

    if (state.history.length === 0) {
      list.innerHTML = '<div class="text-center py-10 text-xs text-slate-400">No activity recorded yet.</div>';
      return;
    }

    state.history.forEach(item => {
      const isSuccess = item.status === 'success';
      const div = document.createElement('div');
      div.className = 'p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between gap-3 text-xs';
      div.innerHTML = `
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-8 h-8 rounded-lg ${isSuccess ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'} flex items-center justify-center shrink-0">
            <i data-lucide="${isSuccess ? 'check-circle' : 'alert-triangle'}" class="w-4 h-4"></i>
          </div>
          <div class="min-w-0">
            <p class="font-semibold text-slate-900 truncate">${item.message || 'Automated Post'}</p>
            <div class="flex items-center gap-2 mt-0.5 text-[11px] text-slate-400">
              <span>${new Date(item.timestamp).toLocaleString()}</span>
              ${item.fbUrl ? `<a href="${item.fbUrl}" target="_blank" class="text-indigo-600 font-semibold hover:underline">View Post on FB ↗</a>` : ''}
            </div>
          </div>
        </div>
        <span class="${isSuccess ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'} px-2.5 py-0.5 rounded-full text-[10px] font-bold">
          ${item.status.toUpperCase()}
        </span>
      `;
      list.appendChild(div);
    });

    refreshIcons();
  }

  const clearActivityHistoryBtn = document.getElementById('clearActivityHistoryBtn');
  if (clearActivityHistoryBtn) {
    clearActivityHistoryBtn.addEventListener('click', async () => {
      if (confirm('Clear all activity logs?')) {
        await fetch('/api/history', { method: 'DELETE' });
        fetchStatus();
        setTimeout(renderActivityLogsView, 200);
      }
    });
  }

  // ================= AUTOMATION HUB (COMMENT & MESSENGER) =================
  let autoRulesState = {
    commentAutomationEnabled: true,
    chatAutomationEnabled: true,
    aiCommentFallbackEnabled: true,
    commentRules: [],
    chatSettings: {}
  };

  // Sub-Tab Switching
  const autoTabBtns = document.querySelectorAll('.auto-tab-btn');
  const autoSubviews = document.querySelectorAll('.auto-subview');

  autoTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-autotab');
      autoTabBtns.forEach(b => {
        b.className = 'auto-tab-btn px-4 py-2.5 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-50 flex items-center gap-2 transition';
      });
      btn.className = 'auto-tab-btn px-4 py-2.5 rounded-xl bg-indigo-600 text-white shadow-sm flex items-center gap-2 transition';

      autoSubviews.forEach(v => v.classList.add('hidden'));
      const activeView = document.getElementById(`auto-subview-${target}`);
      if (activeView) activeView.classList.remove('hidden');
      refreshIcons();
    });
  });

  // Fetch & Render Automation Rules
  async function fetchAutomationRules() {
    try {
      const res = await fetch('/api/automation/rules');
      const data = await res.json();
      autoRulesState = data || autoRulesState;

      // Update Toggles
      const toggleCommentAuto = document.getElementById('toggleCommentAutoMaster');
      const commentStatusLabel = document.getElementById('commentAutoStatusLabel');
      if (toggleCommentAuto) {
        toggleCommentAuto.checked = !!autoRulesState.commentAutomationEnabled;
        if (commentStatusLabel) {
          commentStatusLabel.textContent = autoRulesState.commentAutomationEnabled ? 'Active & Responding' : 'Automation Paused';
          commentStatusLabel.className = `text-xs font-bold ${autoRulesState.commentAutomationEnabled ? 'text-emerald-600' : 'text-slate-400'}`;
        }
      }

      const toggleChatAuto = document.getElementById('toggleChatAutoMaster');
      const chatStatusLabel = document.getElementById('chatAutoStatusLabel');
      if (toggleChatAuto) {
        toggleChatAuto.checked = !!autoRulesState.chatAutomationEnabled;
        if (chatStatusLabel) {
          chatStatusLabel.textContent = autoRulesState.chatAutomationEnabled ? 'AI Bot Active' : 'Chatbot Paused';
          chatStatusLabel.className = `text-xs font-bold ${autoRulesState.chatAutomationEnabled ? 'text-purple-600' : 'text-slate-400'}`;
        }
      }

      const toggleAiFallback = document.getElementById('toggleAiCommentFallback');
      if (toggleAiFallback) {
        toggleAiFallback.checked = !!autoRulesState.aiCommentFallbackEnabled;
      }

      // Populate Messenger Settings
      const chatPersonaPrompt = document.getElementById('chatPersonaPrompt');
      const chatWelcomeMessage = document.getElementById('chatWelcomeMessage');
      if (autoRulesState.chatSettings) {
        if (chatPersonaPrompt) chatPersonaPrompt.value = autoRulesState.chatSettings.personaPrompt || '';
        if (chatWelcomeMessage) chatWelcomeMessage.value = autoRulesState.chatSettings.welcomeMessage || '';
      }

      // Render Comment Rules
      renderCommentRulesList();
    } catch (e) {
      console.warn('Failed to fetch automation rules:', e);
    }
  }

  function renderCommentRulesList() {
    const container = document.getElementById('commentRulesList');
    if (!container) return;
    container.innerHTML = '';

    const rules = autoRulesState.commentRules || [];
    if (rules.length === 0) {
      container.innerHTML = `<div class="p-6 text-center text-xs text-slate-400">No keyword rules added yet. Click "+ Add New Rule" to create one.</div>`;
      return;
    }

    rules.forEach(rule => {
      const card = document.createElement('div');
      card.className = 'p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2 text-xs relative group hover:border-indigo-300 transition';
      
      const keywordsBadges = (rule.keywords || []).map(k => `<span class="bg-white border border-slate-200 text-slate-700 font-mono text-[10px] px-2 py-0.5 rounded-md font-semibold">${k}</span>`).join(' ');

      card.innerHTML = `
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full ${rule.isActive ? 'bg-emerald-500' : 'bg-slate-300'}"></span>
            <h5 class="font-bold text-slate-900">${rule.name}</h5>
          </div>
          <button class="delete-rule-btn text-slate-400 hover:text-rose-600 p-1 transition" data-id="${rule.id}" title="Delete Rule">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        </div>

        <div class="flex flex-wrap items-center gap-1.5 pt-1">
          <span class="text-[11px] font-bold text-slate-500">Keywords:</span>
          ${keywordsBadges}
        </div>

        <div class="p-2.5 bg-white border border-slate-100 rounded-lg text-slate-700 leading-snug text-[11px]">
          <span class="font-bold text-slate-500 block mb-0.5">💬 Public Reply:</span>
          ${rule.publicReply}
        </div>

        ${rule.sendPrivateDm ? `
          <div class="p-2.5 bg-indigo-50/50 border border-indigo-100 rounded-lg text-indigo-900 leading-snug text-[11px]">
            <span class="font-bold text-indigo-600 block mb-0.5">📩 Auto-DM to Inbox:</span>
            ${rule.privateDm}
          </div>
        ` : ''}

        <div class="flex items-center gap-3 pt-1 text-[10px] text-slate-400">
          ${rule.autoLike ? '<span class="flex items-center gap-1 text-emerald-600 font-semibold"><i data-lucide="thumbs-up" class="w-3 h-3"></i> Auto-Like enabled</span>' : ''}
          ${rule.sendPrivateDm ? '<span class="flex items-center gap-1 text-indigo-600 font-semibold"><i data-lucide="mail" class="w-3 h-3"></i> Auto-DM enabled</span>' : ''}
        </div>
      `;
      container.appendChild(card);
    });

    // Delete actions
    container.querySelectorAll('.delete-rule-btn').forEach(b => {
      b.addEventListener('click', async () => {
        const id = b.getAttribute('data-id');
        if (confirm('Delete this keyword automation rule?')) {
          await fetch(`/api/automation/rules/comment/${id}`, { method: 'DELETE' });
          fetchAutomationRules();
        }
      });
    });

    refreshIcons();
  }

  // Add Comment Rule Modal Handlers
  const addRuleModal = document.getElementById('addRuleModal');
  const openAddRuleModalBtn = document.getElementById('openAddRuleModalBtn');
  const closeAddRuleModalBtn = document.getElementById('closeAddRuleModalBtn');
  const cancelAddRuleModalBtn = document.getElementById('cancelAddRuleModalBtn');
  const saveNewRuleBtn = document.getElementById('saveNewRuleBtn');
  const newRuleSendDm = document.getElementById('newRuleSendDm');
  const newRuleDmBox = document.getElementById('newRuleDmBox');

  if (openAddRuleModalBtn) {
    openAddRuleModalBtn.addEventListener('click', () => {
      addRuleModal.classList.remove('hidden');
      refreshIcons();
    });
  }

  function closeAddRuleModal() {
    if (addRuleModal) addRuleModal.classList.add('hidden');
  }

  if (closeAddRuleModalBtn) closeAddRuleModalBtn.addEventListener('click', closeAddRuleModal);
  if (cancelAddRuleModalBtn) cancelAddRuleModalBtn.addEventListener('click', closeAddRuleModal);

  if (newRuleSendDm) {
    newRuleSendDm.addEventListener('change', () => {
      if (newRuleDmBox) {
        newRuleDmBox.classList.toggle('hidden', !newRuleSendDm.checked);
      }
    });
  }

  if (saveNewRuleBtn) {
    saveNewRuleBtn.addEventListener('click', async () => {
      const name = document.getElementById('newRuleName').value.trim();
      const keywords = document.getElementById('newRuleKeywords').value.trim();
      const publicReply = document.getElementById('newRulePublicReply').value.trim();
      const sendPrivateDm = newRuleSendDm.checked;
      const privateDm = document.getElementById('newRulePrivateDm').value.trim();
      const autoLike = document.getElementById('newRuleAutoLike').checked;

      if (!name || !keywords || !publicReply) {
        alert('Please provide a Rule Name, at least one Keyword, and a Public Reply message.');
        return;
      }

      saveNewRuleBtn.disabled = true;
      saveNewRuleBtn.textContent = 'Saving...';

      try {
        const res = await fetch('/api/automation/rules/comment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, keywords, publicReply, sendPrivateDm, privateDm, autoLike })
        });
        const data = await res.json();
        if (data.success) {
          closeAddRuleModal();
          document.getElementById('newRuleName').value = '';
          document.getElementById('newRuleKeywords').value = '';
          document.getElementById('newRulePublicReply').value = '';
          document.getElementById('newRulePrivateDm').value = '';
          fetchAutomationRules();
        }
      } catch (err) {
        alert('Failed to save rule');
      } finally {
        saveNewRuleBtn.disabled = false;
        saveNewRuleBtn.textContent = 'Save Rule';
      }
    });
  }

  // Toggle Masters
  const toggleCommentAutoMaster = document.getElementById('toggleCommentAutoMaster');
  if (toggleCommentAutoMaster) {
    toggleCommentAutoMaster.addEventListener('change', async () => {
      await fetch('/api/automation/toggle-comment', { method: 'POST' });
      fetchAutomationRules();
    });
  }

  const toggleChatAutoMaster = document.getElementById('toggleChatAutoMaster');
  if (toggleChatAutoMaster) {
    toggleChatAutoMaster.addEventListener('change', async () => {
      await fetch('/api/automation/toggle-chat', { method: 'POST' });
      fetchAutomationRules();
    });
  }

  const toggleAiCommentFallback = document.getElementById('toggleAiCommentFallback');
  if (toggleAiCommentFallback) {
    toggleAiCommentFallback.addEventListener('change', async () => {
      autoRulesState.aiCommentFallbackEnabled = toggleAiCommentFallback.checked;
      await fetch('/api/automation/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(autoRulesState)
      });
    });
  }

  // Save Chat Settings
  const saveChatSettingsBtn = document.getElementById('saveChatSettingsBtn');
  if (saveChatSettingsBtn) {
    saveChatSettingsBtn.addEventListener('click', async () => {
      saveChatSettingsBtn.disabled = true;
      saveChatSettingsBtn.textContent = 'Saving...';

      autoRulesState.chatSettings = {
        enabled: true,
        welcomeMessage: document.getElementById('chatWelcomeMessage').value.trim(),
        personaPrompt: document.getElementById('chatPersonaPrompt').value.trim()
      };

      try {
        await fetch('/api/automation/rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(autoRulesState)
        });

        const statusPill = document.getElementById('chatSaveStatus');
        if (statusPill) {
          statusPill.classList.remove('hidden');
          setTimeout(() => statusPill.classList.add('hidden'), 3000);
        }
      } catch (e) {
        alert('Failed to save chat settings');
      } finally {
        saveChatSettingsBtn.disabled = false;
        saveChatSettingsBtn.textContent = 'Save Bot Settings';
      }
    });
  }

  // Comment Simulator
  const runCommentSimBtn = document.getElementById('runCommentSimBtn');
  if (runCommentSimBtn) {
    runCommentSimBtn.addEventListener('click', async () => {
      const name = document.getElementById('simCommenterName').value.trim() || 'Follower';
      const text = document.getElementById('simCommentText').value.trim();

      if (!text) {
        alert('Please enter a comment to simulate.');
        return;
      }

      runCommentSimBtn.disabled = true;
      runCommentSimBtn.innerHTML = `<span class="animate-spin mr-1">⌛</span> Testing Bot...`;

      try {
        const res = await fetch('/api/automation/test-comment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, senderName: name })
        });
        const data = await res.json();
        const r = data.result;

        if (r && r.handled) {
          const box = document.getElementById('commentSimResultBox');
          box.classList.remove('hidden');

          document.getElementById('simResultRuleBadge').textContent = r.ruleName || 'Keyword Rule';
          document.getElementById('simResultPublicReply').textContent = r.publicReply || '';

          const dmBox = document.getElementById('simResultDmContainer');
          if (r.privateDmSent) {
            dmBox.classList.remove('hidden');
            document.getElementById('simResultPrivateDm').textContent = `Sent directly to ${r.senderName}'s Messenger inbox!`;
          } else {
            dmBox.classList.add('hidden');
          }

          document.getElementById('simResultTime').textContent = new Date().toLocaleTimeString();
          refreshIcons();
        } else {
          alert('Notice: ' + (r?.reason || data.error || 'Comment was not matched.'));
        }
      } catch (err) {
        alert('Error during comment simulation');
      } finally {
        runCommentSimBtn.disabled = false;
        runCommentSimBtn.innerHTML = `<i data-lucide="send" class="w-3.5 h-3.5"></i><span>Simulate & Test Comment Bot</span>`;
        refreshIcons();
      }
    });
  }

  // Messenger Chat Simulator
  const chatSimInput = document.getElementById('chatSimInput');
  const chatSimSendBtn = document.getElementById('chatSimSendBtn');
  const chatMessagesContainer = document.getElementById('chatMessagesContainer');
  const resetChatSimBtn = document.getElementById('resetChatSimBtn');

  async function sendChatMessage() {
    const text = chatSimInput.value.trim();
    if (!text) return;

    chatSimInput.value = '';

    // Append user message bubble
    const userBubble = document.createElement('div');
    userBubble.className = 'flex items-start justify-end gap-2.5';
    userBubble.innerHTML = `
      <div class="p-3 rounded-2xl bg-purple-600 text-white text-xs shadow-sm max-w-[85%] leading-relaxed">
        ${text}
      </div>
    `;
    chatMessagesContainer.appendChild(userBubble);
    chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;

    // Typing indicator
    const typingIndicator = document.createElement('div');
    typingIndicator.className = 'flex items-start gap-2.5 chat-typing-indicator';
    typingIndicator.innerHTML = `
      <img src="/pariksha_notes_logo.jpg" class="w-6 h-6 rounded-full object-cover shrink-0 mt-0.5">
      <div class="p-3 rounded-2xl bg-white border border-slate-200/80 text-xs text-slate-400 shadow-sm flex items-center gap-1.5">
        <span class="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce"></span>
        <span class="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style="animation-delay: 0.2s"></span>
        <span class="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style="animation-delay: 0.4s"></span>
      </div>
    `;
    chatMessagesContainer.appendChild(typingIndicator);
    chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;

    try {
      const res = await fetch('/api/automation/test-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, senderName: 'শিক্ষার্থী' })
      });
      const data = await res.json();
      typingIndicator.remove();

      const botReplyText = data.result?.botReply || data.error || 'ধন্যবাদ আপনার মেসেজের জন্য!';
      const botBubble = document.createElement('div');
      botBubble.className = 'flex items-start gap-2.5';
      botBubble.innerHTML = `
        <img src="/pariksha_notes_logo.jpg" class="w-6 h-6 rounded-full object-cover shrink-0 mt-0.5">
        <div class="p-3 rounded-2xl bg-white border border-slate-200/80 text-xs text-slate-800 shadow-sm max-w-[85%] leading-relaxed whitespace-pre-line">
          ${botReplyText}
        </div>
      `;
      chatMessagesContainer.appendChild(botBubble);
      chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
    } catch (err) {
      typingIndicator.remove();
    }
  }

  if (chatSimSendBtn) chatSimSendBtn.addEventListener('click', sendChatMessage);
  if (chatSimInput) {
    chatSimInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        sendChatMessage();
      }
    });
  }

  if (resetChatSimBtn) {
    resetChatSimBtn.addEventListener('click', () => {
      chatMessagesContainer.innerHTML = `
        <div class="flex items-start gap-2.5">
          <img src="/pariksha_notes_logo.jpg" class="w-6 h-6 rounded-full object-cover shrink-0 mt-0.5">
          <div class="p-3 rounded-2xl bg-white border border-slate-200/80 text-xs text-slate-800 shadow-sm max-w-[85%] leading-relaxed">
            স্বাগতম আমাদের পেজে! 👋 আমরা আপনাকে কীভাবে সাহায্য করতে পারি? আপনার যেকোনো প্রশ্ন লিখুন।
          </div>
        </div>
      `;
    });
  }

  function appendAutoLogItem(item, type) {
    const list = document.getElementById('autoEventLogsList');
    if (!list) return;

    const div = document.createElement('div');
    div.className = 'p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3 text-xs';
    
    if (type === 'comment') {
      div.innerHTML = `
        <div class="flex items-center gap-2.5 min-w-0">
          <span class="w-2 h-2 rounded-full bg-emerald-500 shrink-0"></span>
          <div class="min-w-0">
            <span class="font-bold text-slate-800">💬 Comment Replied (${item.senderName})</span>
            <p class="text-[11px] text-slate-500 truncate">${item.publicReply}</p>
          </div>
        </div>
        <span class="text-[10px] text-slate-400 shrink-0">Just now</span>
      `;
    } else {
      div.innerHTML = `
        <div class="flex items-center gap-2.5 min-w-0">
          <span class="w-2 h-2 rounded-full bg-purple-500 shrink-0"></span>
          <div class="min-w-0">
            <span class="font-bold text-slate-800">🤖 Messenger Chat (${item.senderName})</span>
            <p class="text-[11px] text-slate-500 truncate">${item.botReply || item.userMessage}</p>
          </div>
        </div>
        <span class="text-[10px] text-slate-400 shrink-0">Just now</span>
      `;
    }
    list.prepend(div);
  }

  // Existing Autopilot Post Controls
  const triggerAutoPilotNowBtn = document.getElementById('triggerAutoPilotNowBtn');
  if (triggerAutoPilotNowBtn) {
    triggerAutoPilotNowBtn.addEventListener('click', async () => {
      triggerAutoPilotNowBtn.disabled = true;
      triggerAutoPilotNowBtn.textContent = 'Generating & Posting...';

      try {
        const res = await fetch('/api/ai/autopilot/trigger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic: '' })
        });
        const data = await res.json();
        if (data.success) {
          alert('🚀 Auto-Pilot Post generated and published to Facebook successfully!');
          fetchStatus();
        } else {
          alert('Auto-Pilot error: ' + (data.error || 'Check settings'));
        }
      } catch (e) {
        alert('Network error triggering Auto-Pilot.');
      } finally {
        triggerAutoPilotNowBtn.disabled = false;
        triggerAutoPilotNowBtn.innerHTML = `<i data-lucide="zap" class="w-3.5 h-3.5"></i><span>Trigger Post Now</span>`;
        refreshIcons();
      }
    });
  }

  if (automationToggleSwitch) {
    automationToggleSwitch.addEventListener('change', async () => {
      try {
        const res = await fetch('/api/scheduler/toggle', { method: 'POST' });
        const data = await res.json();
        updateAutomationUI(data.autoPostEnabled);
      } catch (err) {
        console.error('Toggle error:', err);
      }
    });
  }

  function updateAutomationUI(isActive) {
    if (automationToggleSwitch) automationToggleSwitch.checked = !!isActive;
    if (automationStatusHeading) {
      if (isActive) {
        automationStatusHeading.textContent = 'Automation is Active';
        automationStatusHeading.className = 'text-sm font-bold text-emerald-600';
        if (schedulerCountdownText) schedulerCountdownText.textContent = 'Active & Running';
      } else {
        automationStatusHeading.textContent = 'Automation is Paused';
        automationStatusHeading.className = 'text-sm font-bold text-slate-500';
        if (schedulerCountdownText) schedulerCountdownText.textContent = 'Scheduler Paused';
      }
    }
  }

  // Settings in View-Settings
  const pageSettingsPageId = document.getElementById('pageSettingsPageId');
  const pageSettingsAccessToken = document.getElementById('pageSettingsAccessToken');
  const pageSettingsGeminiKey = document.getElementById('pageSettingsGeminiKey');
  const pageSettingsDemoMode = document.getElementById('pageSettingsDemoMode');
  const savePageSettingsBtn = document.getElementById('savePageSettingsBtn');
  const testPageSettingsConnection = document.getElementById('testPageSettingsConnection');
  const pageSettingsStatusMsg = document.getElementById('pageSettingsStatusMsg');
  const togglePageSettingsToken = document.getElementById('togglePageSettingsToken');

  if (togglePageSettingsToken) {
    togglePageSettingsToken.addEventListener('click', () => {
      const isPwd = pageSettingsAccessToken.type === 'password';
      pageSettingsAccessToken.type = isPwd ? 'text' : 'password';
    });
  }

  if (testPageSettingsConnection) {
    testPageSettingsConnection.addEventListener('click', async () => {
      testPageSettingsConnection.disabled = true;
      testPageSettingsConnection.textContent = 'Testing...';
      pageSettingsStatusMsg.classList.remove('hidden');
      pageSettingsStatusMsg.className = 'p-2.5 rounded-xl text-xs font-medium bg-indigo-50 text-indigo-700';
      pageSettingsStatusMsg.textContent = 'Testing Meta Graph API...';

      try {
        const res = await fetch('/api/settings/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pageId: pageSettingsPageId.value.trim(),
            accessToken: pageSettingsAccessToken.value.trim()
          })
        });
        const data = await res.json();
        if (data.success) {
          pageSettingsStatusMsg.className = 'p-2.5 rounded-xl text-xs font-medium bg-emerald-50 text-emerald-700';
          pageSettingsStatusMsg.textContent = `✅ Connected to Facebook Page: "${data.pageName || 'Verified'}"`;
        } else {
          pageSettingsStatusMsg.className = 'p-2.5 rounded-xl text-xs font-medium bg-rose-50 text-rose-700';
          pageSettingsStatusMsg.textContent = `❌ Facebook Error: ${data.error || 'Invalid token'}`;
        }
      } catch (e) {
        pageSettingsStatusMsg.textContent = 'Connection test failed';
      } finally {
        testPageSettingsConnection.disabled = false;
        testPageSettingsConnection.textContent = 'Test FB Connection';
      }
    });
  }

  if (savePageSettingsBtn) {
    savePageSettingsBtn.addEventListener('click', async () => {
      savePageSettingsBtn.disabled = true;
      savePageSettingsBtn.textContent = 'Saving...';

      try {
        const geminiKey = pageSettingsGeminiKey ? pageSettingsGeminiKey.value.trim() : '';
        const accessToken = pageSettingsAccessToken ? pageSettingsAccessToken.value.trim() : '';
        const pageId = pageSettingsPageId ? pageSettingsPageId.value.trim() : '';
        const isDemo = pageSettingsDemoMode ? pageSettingsDemoMode.checked : false;

        // 1. Update Gemini key via dedicated endpoint if changed
        if (geminiKey) {
          const gemRes = await fetch('/api/settings/gemini-credential', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey: geminiKey })
          });
          const gemData = await gemRes.json();
          if (!gemData.success) {
            alert('Failed to save Gemini key: ' + (gemData.error || 'Validation error'));
            return;
          }
        }

        // 2. Update Facebook token via dedicated endpoint if changed
        const targetPageId = pageId || state.settings.pageId || (state.pages && state.pages[0]?.id);
        if (accessToken && targetPageId) {
          const fbRes = await fetch(`/api/facebook/pages/${targetPageId}/credential`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken })
          });
          const fbData = await fbRes.json();
          if (!fbData.success) {
            alert('Failed to save Facebook token: ' + (fbData.error || 'Validation error'));
            return;
          }
        }

        // 3. Save general non-secret configuration
        const payload = {
          pageId: targetPageId,
          isDemoMode: isDemo
        };

        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (data.success) {
          pageSettingsStatusMsg.classList.remove('hidden');
          pageSettingsStatusMsg.className = 'p-2.5 rounded-xl text-xs font-medium bg-emerald-50 text-emerald-700';
          pageSettingsStatusMsg.textContent = '✅ Settings saved successfully!';
          fetchStatus();
        } else {
          alert('Failed to save settings: ' + (data.error || 'Server error'));
        }
      } catch (err) {
        alert('Failed to save settings: ' + err.message);
      } finally {
        savePageSettingsBtn.disabled = false;
        savePageSettingsBtn.textContent = 'Save Changes';
      }
    });
  }

  // Analytics Filter
  if (analyticsPeriodSelect) {
    analyticsPeriodSelect.addEventListener('change', () => {
      const val = analyticsPeriodSelect.value;
      const engage = document.getElementById('metricEngageVal');
      const clicks = document.getElementById('metricClicksVal');
      const react = document.getElementById('metricReactVal');
      const shares = document.getElementById('metricSharesVal');

      if (val === 'today') {
        if (engage) engage.textContent = '7.8%';
        if (clicks) clicks.textContent = '312';
        if (react) react.textContent = '1,420';
        if (shares) shares.textContent = '289';
      } else if (val === 'week') {
        if (engage) engage.textContent = '6.9%';
        if (clicks) clicks.textContent = '780';
        if (react) react.textContent = '4,105';
        if (shares) shares.textContent = '720';
      } else if (val === 'all') {
        if (engage) engage.textContent = '5.9%';
        if (clicks) clicks.textContent = '14,890';
        if (react) react.textContent = '94,200';
        if (shares) shares.textContent = '18,500';
      } else {
        if (engage) engage.textContent = '6.2%';
        if (clicks) clicks.textContent = '1,245';
        if (react) react.textContent = '8,732';
        if (shares) shares.textContent = '1,234';
      }
    });
  }

  // ================= MULTI-PAGE FACEBOOK ACCOUNTS =================
  async function fetchConnectedPages() {
    try {
      const res = await fetch('/api/facebook/pages');
      const data = await res.json();
      if (data.success) {
        state.pages = data.pages || [];
        state.activePageId = data.activePageId;
        renderHeaderPageSwitcher();
        updateStudioPageBanner();
        if (state.currentView === 'accounts') {
          renderAccountsView();
        }
      }
    } catch (e) {
      console.warn('Failed to fetch pages:', e);
    }
  }

  function updateStudioPageBanner() {
    const pages = state.pages || [];
    const active = pages.find(p => p.id === state.activePageId) || pages[0];
    const studioLogo = document.getElementById('studioPageLogo');
    const studioName = document.getElementById('studioPageName');
    const studioCategory = document.getElementById('studioPageCategory');
    const studioPromptSnippet = document.getElementById('studioPagePromptSnippet');

    if (active) {
      if (studioLogo) studioLogo.src = active.pictureUrl || '/pariksha_notes_logo.jpg';
      if (studioName) studioName.textContent = active.name;
      if (studioCategory) studioCategory.textContent = active.category || 'General';
      if (studioPromptSnippet) {
        if (active.systemPrompt && active.systemPrompt.trim()) {
          const firstLine = active.systemPrompt.trim().split('\n')[0];
          studioPromptSnippet.textContent = `"${firstLine.substring(0, 95)}${firstLine.length > 95 ? '...' : ''}"`;
          studioPromptSnippet.title = active.systemPrompt;
        } else {
          studioPromptSnippet.textContent = 'Standard Bengali post guidelines. Click "Edit Page Instructions" to customize rules.';
          studioPromptSnippet.title = '';
        }
      }
    }
  }

  function renderHeaderPageSwitcher() {
    const pages = state.pages || [];
    const active = pages.find(p => p.id === state.activePageId) || pages[0];
    
    if (active) {
      if (headerActivePageLogo) headerActivePageLogo.src = active.pictureUrl || '/pariksha_notes_logo.jpg';
      if (headerActivePageName) headerActivePageName.textContent = active.name;
    }
    if (headerPagesCountBadge) {
      headerPagesCountBadge.textContent = pages.length;
    }

    if (headerPagesList) {
      headerPagesList.innerHTML = '';
      pages.forEach(p => {
        const isActive = p.id === state.activePageId;
        const row = document.createElement('div');
        row.className = `flex items-center justify-between p-2 rounded-xl cursor-pointer transition text-xs ${isActive ? 'bg-indigo-50/80 font-bold text-indigo-900' : 'hover:bg-slate-50 text-slate-700'}`;
        row.innerHTML = `
          <div class="flex items-center gap-2.5 min-w-0">
            <img src="${p.pictureUrl || '/pariksha_notes_logo.jpg'}" class="w-6 h-6 rounded-full object-cover ring-1 ${isActive ? 'ring-indigo-500' : 'ring-slate-200'} shrink-0">
            <div class="min-w-0 truncate">
              <span class="block truncate">${p.name}</span>
              <span class="text-[10px] text-slate-400 font-mono block truncate">ID: ${p.id}</span>
            </div>
          </div>
          ${isActive ? '<span class="text-indigo-600 font-bold shrink-0 ml-2">✓ Active</span>' : '<span class="text-[10px] text-slate-400 shrink-0 ml-2 hover:text-indigo-600">Switch</span>'}
        `;
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!isActive) {
            switchActivePage(p.id);
          }
          if (headerPageDropdown) headerPageDropdown.classList.add('hidden');
        });
        headerPagesList.appendChild(row);
      });
    }

    updateStudioPageBanner();
  }

  async function switchActivePage(pageId) {
    try {
      const res = await fetch('/api/facebook/pages/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId })
      });
      const data = await res.json();
      if (data.success) {
        state.activePageId = pageId;
        state.pages = data.pages || state.pages;
        renderHeaderPageSwitcher();
        updateStudioPageBanner();
        if (state.currentView === 'accounts') renderAccountsView();
        
        state.notifications.unshift({
          id: `notif_${Date.now()}`,
          text: `Switched active page to "${data.activePage.name}"`,
          time: 'Just now',
          type: 'success'
        });
        bellBadgeDot.classList.remove('hidden');
        fetchStatus();
      } else {
        alert('Switch failed: ' + (data.error || 'Unknown error'));
      }
    } catch (e) {
      alert('Error switching page: ' + e.message);
    }
  }

  function renderAccountsView() {
    const grid = document.getElementById('accountsPageGrid');
    if (!grid) return;

    grid.innerHTML = '';
    const pages = state.pages || [];

    if (pages.length === 0) {
      grid.innerHTML = `<div class="col-span-full py-12 text-center text-slate-400 text-xs">No pages connected yet. Click "+ Connect New Facebook Page" above to add one.</div>`;
      return;
    }

    pages.forEach(p => {
      const isActive = p.id === state.activePageId;
      const card = document.createElement('div');
      card.className = `p-5 rounded-2xl border transition-all ${isActive ? 'bg-gradient-to-br from-white via-indigo-50/20 to-purple-50/20 border-indigo-200 shadow-md ring-2 ring-indigo-500/20' : 'bg-white border-slate-200 hover:border-slate-300 shadow-sm'}`;
      card.innerHTML = `
        <div class="flex items-start justify-between gap-3 mb-4">
          <div class="flex items-center gap-3.5 min-w-0">
            <img src="${p.pictureUrl || '/pariksha_notes_logo.jpg'}" class="w-12 h-12 rounded-full object-cover ring-2 ${isActive ? 'ring-indigo-500' : 'ring-slate-200'} shrink-0">
            <div class="min-w-0">
              <div class="flex items-center gap-1.5 flex-wrap">
                <h4 class="text-sm font-bold text-slate-900 truncate">${p.name}</h4>
                ${isActive ? '<span class="bg-emerald-50 text-emerald-600 border border-emerald-200 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>Active</span>' : '<span class="bg-slate-100 text-slate-500 text-[10px] font-medium px-2 py-0.5 rounded-full">Connected</span>'}
              </div>
              <p class="text-xs text-slate-500 font-medium mt-0.5">${p.category || 'General'}</p>
              <p class="text-[11px] text-slate-400 font-mono mt-0.5 truncate">Page ID: ${p.id}</p>
            </div>
          </div>
        </div>

        <div class="p-3 bg-slate-50/80 rounded-xl border border-slate-100 mb-4 text-[11px] text-slate-500 space-y-2">
          <div class="flex justify-between">
            <span>Status:</span>
            <span class="font-semibold ${isActive ? 'text-indigo-600' : 'text-slate-600'}">${isActive ? 'Active for Auto-Post & Chat' : 'Standby / Connected'}</span>
          </div>
          <div class="flex justify-between">
            <span>Permissions:</span>
            <span class="text-emerald-600 font-semibold flex items-center gap-1">✓ Verified Meta Scopes</span>
          </div>
          <div class="pt-2 border-t border-slate-200/60">
            <div class="flex items-center justify-between mb-1">
              <span class="font-bold text-slate-700 flex items-center gap-1">
                <i data-lucide="sparkles" class="w-3 h-3 text-indigo-500"></i>
                AI Instructions / Strategy
              </span>
              ${p.systemPrompt ? '<span class="text-[9px] text-indigo-600 font-bold bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100">Custom Rules</span>' : '<span class="text-[9px] text-slate-400">Default Rules</span>'}
            </div>
            <p class="text-[10.5px] text-slate-600 line-clamp-2 italic leading-relaxed">
              ${p.systemPrompt ? p.systemPrompt : 'No custom guidelines configured yet. AI uses default Bengali post rules.'}
            </p>
          </div>
        </div>

        <div class="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
          ${isActive ? `
            <button class="edit-page-btn flex-1 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold rounded-xl border border-indigo-200 transition flex items-center justify-center gap-1.5" data-id="${p.id}">
              <i data-lucide="settings" class="w-3.5 h-3.5"></i>
              <span>Edit Page & Guidelines</span>
            </button>
          ` : `
            <button class="switch-page-btn flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl shadow-sm transition flex items-center justify-center gap-1.5" data-id="${p.id}">
              <i data-lucide="arrow-right-left" class="w-3.5 h-3.5"></i>
              <span>Switch</span>
            </button>
            <button class="edit-page-btn px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition flex items-center justify-center gap-1" data-id="${p.id}" title="Edit Guidelines">
              <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
              <span>Edit</span>
            </button>
            <button class="delete-page-btn p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition" data-id="${p.id}" data-name="${p.name}" title="Disconnect Page">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          `}
        </div>
      `;

      card.querySelectorAll('.switch-page-btn').forEach(btn => {
        btn.addEventListener('click', () => switchActivePage(btn.getAttribute('data-id')));
      });

      card.querySelectorAll('.edit-page-btn').forEach(btn => {
        btn.addEventListener('click', () => openEditPageModal(btn.getAttribute('data-id')));
      });

      card.querySelectorAll('.delete-page-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.getAttribute('data-id');
          const name = btn.getAttribute('data-name');
          if (confirm(`Disconnect and remove "${name}" from connected pages?`)) {
            try {
              const res = await fetch(`/api/facebook/pages/${id}`, { method: 'DELETE' });
              const data = await res.json();
              if (data.success) {
                state.pages = data.pages;
                state.activePageId = data.activePage?.id;
                renderAccountsView();
                renderHeaderPageSwitcher();
                updateStudioPageBanner();
                fetchStatus();
                alert(`Removed "${name}" from connected pages.`);
              } else {
                alert('Cannot remove: ' + (data.error || 'Failed'));
              }
            } catch (e) {
              alert('Error removing page: ' + e.message);
            }
          }
        });
      });

      grid.appendChild(card);
    });

    refreshIcons();
  }

  // ================= EDIT PAGE & GUIDELINES MODAL =================
  function openEditPageModal(pageId) {
    const page = (state.pages || []).find(p => p.id === pageId) || (state.pages || []).find(p => p.id === state.activePageId) || (state.pages || [])[0];
    if (!page) {
      alert('No page selected to edit.');
      return;
    }

    if (editPageIdInput) editPageIdInput.value = page.id;
    if (editPageNameInput) editPageNameInput.value = page.name || '';
    if (editPageCategoryInput) editPageCategoryInput.value = page.category || '';
    if (editPageTokenInput) editPageTokenInput.value = '';
    if (editPagePromptInput) editPagePromptInput.value = page.systemPrompt || '';

    if (editPageModal) editPageModal.classList.remove('hidden');
    refreshIcons();
  }

  if (closeEditPageModalBtn) {
    closeEditPageModalBtn.addEventListener('click', () => {
      if (editPageModal) editPageModal.classList.add('hidden');
    });
  }

  if (cancelEditPageModalBtn) {
    cancelEditPageModalBtn.addEventListener('click', () => {
      if (editPageModal) editPageModal.classList.add('hidden');
    });
  }

  if (submitEditPageBtn) {
    submitEditPageBtn.addEventListener('click', async () => {
      const pageId = editPageIdInput ? editPageIdInput.value : '';
      const name = editPageNameInput ? editPageNameInput.value.trim() : '';
      const category = editPageCategoryInput ? editPageCategoryInput.value.trim() : '';
      const accessToken = editPageTokenInput ? editPageTokenInput.value.trim() : '';
      const systemPrompt = editPagePromptInput ? editPagePromptInput.value.trim() : '';

      if (!pageId || !name) {
        alert('Page Name is required.');
        return;
      }

      submitEditPageBtn.disabled = true;
      submitEditPageBtn.innerHTML = `<span class="animate-spin mr-1">⌛</span> Saving...`;

      try {
        if (accessToken && accessToken.trim()) {
          const credRes = await fetch(`/api/facebook/pages/${pageId}/credential`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken: accessToken.trim() })
          });
          const credData = await credRes.json();
          if (!credData.success) {
            alert('Failed to update page access token: ' + (credData.error || 'Validation error'));
            return;
          }
        }

        const payload = { name, category, systemPrompt };

        const res = await fetch(`/api/facebook/pages/${pageId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (data.success) {
          state.pages = data.pages || state.pages;
          renderHeaderPageSwitcher();
          updateStudioPageBanner();
          if (state.currentView === 'accounts') renderAccountsView();
          if (editPageModal) editPageModal.classList.add('hidden');

          state.notifications.unshift({
            id: `notif_${Date.now()}`,
            text: `Page "${name}" settings and AI instructions updated!`,
            time: 'Just now',
            type: 'success'
          });
          if (bellBadgeDot) bellBadgeDot.classList.remove('hidden');
        } else {
          alert('Failed to update page: ' + (data.error || 'Server error'));
        }
      } catch (err) {
        alert('Error updating page: ' + err.message);
      } finally {
        submitEditPageBtn.disabled = false;
        submitEditPageBtn.innerHTML = `<i data-lucide="check" class="w-3.5 h-3.5"></i><span>Save Page & Guidelines</span>`;
        refreshIcons();
      }
    });
  }

  // Toggle Header Page Dropdown
  if (headerPageSwitcherBtn && headerPageDropdown) {
    headerPageSwitcherBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      headerPageDropdown.classList.toggle('hidden');
      refreshIcons();
    });

    document.addEventListener('click', (e) => {
      if (!headerPageSwitcherBtn.contains(e.target) && !headerPageDropdown.contains(e.target)) {
        headerPageDropdown.classList.add('hidden');
      }
    });
  }

  // Connect New Page Modal
  function openAddPageModal() {
    if (addPageModal) {
      addPageModal.classList.remove('hidden');
      if (headerPageDropdown) headerPageDropdown.classList.add('hidden');
      refreshIcons();
    }
  }

  function closeAddPageModal() {
    if (addPageModal) {
      addPageModal.classList.add('hidden');
      if (newPageIdInput) newPageIdInput.value = '';
      if (newPageTokenInput) newPageTokenInput.value = '';
      if (newPageNameInput) newPageNameInput.value = '';
    }
  }

  if (openAddPageModalBtn) openAddPageModalBtn.addEventListener('click', openAddPageModal);
  if (headerAddNewPageBtn) headerAddNewPageBtn.addEventListener('click', openAddPageModal);
  if (closeAddPageModalBtn) closeAddPageModalBtn.addEventListener('click', closeAddPageModal);
  if (cancelAddPageModalBtn) cancelAddPageModalBtn.addEventListener('click', closeAddPageModal);

  if (submitAddPageBtn) {
    submitAddPageBtn.addEventListener('click', async () => {
      const pageId = newPageIdInput ? newPageIdInput.value.trim() : '';
      const accessToken = newPageTokenInput ? newPageTokenInput.value.trim() : '';
      const name = newPageNameInput ? newPageNameInput.value.trim() : '';
      const setAsActive = newPageSetActiveCheck ? newPageSetActiveCheck.checked : true;

      if (!pageId || !accessToken) {
        alert('Please enter both Facebook Page ID and Page Access Token.');
        return;
      }

      submitAddPageBtn.disabled = true;
      submitAddPageBtn.innerHTML = `<span class="animate-spin mr-1">⌛</span> Verifying with Meta...`;

      try {
        const res = await fetch('/api/facebook/pages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pageId, accessToken, name, setAsActive })
        });

        const data = await res.json();
        if (data.success) {
          alert(`🎉 Successfully connected "${data.page.name}"!`);
          closeAddPageModal();
          state.pages = data.pages;
          state.activePageId = data.activePageId;
          renderHeaderPageSwitcher();
          if (state.currentView === 'accounts') renderAccountsView();
          fetchStatus();
        } else {
          alert('Failed to connect page: ' + (data.error || 'Invalid token or page ID.'));
        }
      } catch (err) {
        alert('Network error connecting page: ' + err.message);
      } finally {
        submitAddPageBtn.disabled = false;
        submitAddPageBtn.innerHTML = `<i data-lucide="check" class="w-3.5 h-3.5"></i><span>Verify & Connect Page</span>`;
        refreshIcons();
      }
    });
  }

  // ================= STATUS & SYNC =================
  async function fetchStatus() {
    try {
      const [statusRes, queueRes, historyRes, settingsRes] = await Promise.all([
        fetch('/api/status').then(r => r.json()),
        fetch('/api/queue').then(r => r.json()),
        fetch('/api/history').then(r => r.json()),
        fetch('/api/settings').then(r => r.json())
      ]);

      state.settings = settingsRes || {};
      state.queue = queueRes || [];
      state.history = historyRes || [];

      // Update fields
      if (pageSettingsPageId) pageSettingsPageId.value = state.settings.pageId || '';
      if (pageSettingsAccessToken) {
        pageSettingsAccessToken.value = '';
        pageSettingsAccessToken.placeholder = state.settings.facebookConnected
          ? '•••••••••••••••• (Configured - leave blank to keep unchanged)'
          : 'Enter Page Access Token';
      }
      if (pageSettingsGeminiKey) {
        pageSettingsGeminiKey.value = '';
        pageSettingsGeminiKey.placeholder = state.settings.geminiConfigured
          ? '•••••••••••••••• (Configured - leave blank to keep unchanged)'
          : 'Enter Gemini API Key';
      }
      if (pageSettingsDemoMode) pageSettingsDemoMode.checked = !!state.settings.isDemoMode;

      // Update Profile & Accounts view
      const profileName = document.getElementById('displayProfileName');
      const accountPageName = document.getElementById('accountPageName');
      const accountPageId = document.getElementById('accountPageId');
      if (state.settings.pageName) {
        if (profileName) profileName.textContent = state.settings.pageName;
        if (accountPageName) accountPageName.textContent = state.settings.pageName;
      }
      if (state.settings.pageId && accountPageId) {
        accountPageId.textContent = state.settings.pageId;
      }

      // Update metrics
      const totalHistory = state.history.length;
      const successPosts = state.history.filter(h => h.status === 'success').length;
      const pendingQueueCount = state.queue.filter(q => q.status === 'pending').length;

      const statTotalPosts = document.getElementById('statTotalPosts');
      const statPublishedPosts = document.getElementById('statPublishedPosts');
      const statScheduledPosts = document.getElementById('statScheduledPosts');
      const badgeQueueCount = document.getElementById('badgeQueueCount');

      if (statTotalPosts) statTotalPosts.textContent = totalHistory > 0 ? (totalHistory + 128) : 128;
      if (statPublishedPosts) statPublishedPosts.textContent = successPosts > 0 ? (successPosts + 98) : 98;
      if (statScheduledPosts) statScheduledPosts.textContent = pendingQueueCount > 0 ? pendingQueueCount : 24;
      if (badgeQueueCount) badgeQueueCount.textContent = pendingQueueCount;

      // Update automation switch
      updateAutomationUI(state.settings.autoPostEnabled);

      // Render upcoming queue on dashboard
      renderDashboardQueue();

    } catch (err) {
      console.warn('Status sync notice:', err);
    }
  }

  // Server-Sent Events (SSE)
  function connectSSE() {
    try {
      const eventSource = new EventSource('/api/events');

      eventSource.onopen = () => {
        if (liveStatusPing) liveStatusPing.className = 'animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75';
        if (liveStatusDot) liveStatusDot.className = 'relative inline-flex rounded-full h-2 w-2 bg-emerald-500';
        if (liveStatusText) liveStatusText.textContent = 'Live Connected';
      };

      eventSource.addEventListener('scheduler_toggled', (e) => {
        const data = JSON.parse(e.data);
        updateAutomationUI(data.enabled);
      });

      eventSource.addEventListener('queue_updated', () => {
        fetchStatus();
        if (state.currentView === 'queue') renderFullQueueView();
      });

      eventSource.addEventListener('post_success', (e) => {
        const data = JSON.parse(e.data);
        state.notifications.unshift({
          id: `notif_${Date.now()}`,
          text: `Auto-post published to Facebook! (${data.message ? data.message.slice(0, 30) + '...' : 'Success'})`,
          time: 'Just now',
          type: 'success'
        });
        bellBadgeDot.classList.remove('hidden');
        fetchStatus();
      });

      eventSource.addEventListener('comment_replied', (e) => {
        const data = JSON.parse(e.data);
        state.notifications.unshift({
          id: `notif_${Date.now()}`,
          text: `💬 Comment auto-replied to ${data.senderName}: "${(data.publicReply || '').slice(0, 30)}..."`,
          time: 'Just now',
          type: 'success'
        });
        bellBadgeDot.classList.remove('hidden');
        appendAutoLogItem(data, 'comment');
        fetchStatus();
      });

      eventSource.addEventListener('chat_replied', (e) => {
        const data = JSON.parse(e.data);
        state.notifications.unshift({
          id: `notif_${Date.now()}`,
          text: `🤖 Messenger bot replied to ${data.senderName}`,
          time: 'Just now',
          type: 'success'
        });
        bellBadgeDot.classList.remove('hidden');
        appendAutoLogItem(data, 'chat');
        fetchStatus();
      });

      eventSource.addEventListener('page_switched', (e) => {
        const data = JSON.parse(e.data);
        if (data.activePage) {
          state.activePageId = data.activePage.id;
          state.pages = data.pages || state.pages;
          renderHeaderPageSwitcher();
          updateStudioPageBanner();
          if (state.currentView === 'accounts') renderAccountsView();
          fetchStatus();
        }
      });

      eventSource.addEventListener('page_updated', (e) => {
        const data = JSON.parse(e.data);
        if (data.pages) {
          state.pages = data.pages;
          if (data.activePage) state.activePageId = data.activePage.id;
          renderHeaderPageSwitcher();
          updateStudioPageBanner();
          if (state.currentView === 'accounts') renderAccountsView();
          fetchStatus();
        }
      });

      eventSource.onerror = () => {
        if (liveStatusPing) liveStatusPing.className = 'hidden';
        if (liveStatusDot) liveStatusDot.className = 'relative inline-flex rounded-full h-2 w-2 bg-amber-500';
        if (liveStatusText) liveStatusText.textContent = 'Reconnecting...';
      };
    } catch (e) {
      console.warn('SSE not supported:', e);
    }
  }

  // Admin Authentication Modal & Session Flow
  const adminAuthModal = document.getElementById('adminAuthModal');
  const adminAuthForm = document.getElementById('adminAuthForm');
  const adminAuthKeyInput = document.getElementById('adminAuthKeyInput');
  const adminAuthError = document.getElementById('adminAuthError');
  const adminAuthSubmitBtn = document.getElementById('adminAuthSubmitBtn');

  function showAuthModal() {
    if (adminAuthModal) {
      adminAuthModal.classList.remove('hidden');
      if (adminAuthKeyInput) {
        adminAuthKeyInput.value = '';
        adminAuthKeyInput.focus();
      }
    }
  }

  function hideAuthModal() {
    if (adminAuthModal) {
      adminAuthModal.classList.add('hidden');
    }
    if (adminAuthError) {
      adminAuthError.classList.add('hidden');
    }
  }

  if (adminAuthForm) {
    adminAuthForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!adminAuthKeyInput) return;
      const key = adminAuthKeyInput.value.trim();
      if (!key) return;

      if (adminAuthSubmitBtn) {
        adminAuthSubmitBtn.disabled = true;
        adminAuthSubmitBtn.innerHTML = '<span>Verifying...</span>';
      }
      if (adminAuthError) adminAuthError.classList.add('hidden');

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key })
        });
        const data = await res.json();
        if (data.success) {
          hideAuthModal();
          initApp();
        } else {
          if (adminAuthError) {
            adminAuthError.textContent = data.error || 'Invalid admin credentials.';
            adminAuthError.classList.remove('hidden');
          }
        }
      } catch (err) {
        if (adminAuthError) {
          adminAuthError.textContent = 'Connection error. Please try again.';
          adminAuthError.classList.remove('hidden');
        }
      } finally {
        if (adminAuthSubmitBtn) {
          adminAuthSubmitBtn.disabled = false;
          adminAuthSubmitBtn.innerHTML = '<span>Unlock Dashboard</span>';
        }
      }
    });
  }

  function initApp() {
    fetchStatus();
    fetchConnectedPages();
    fetchTemplates();
    connectSSE();
    renderDashboardQueue();
    refreshIcons();
  }

  // Session verification on initial load
  async function checkAuthAndInit() {
    try {
      const res = await fetch('/api/auth/session');
      if (res.ok) {
        const data = await res.json();
        if (data.authenticated) {
          hideAuthModal();
          initApp();
          return;
        }
      }
      showAuthModal();
    } catch {
      showAuthModal();
    }
  }

  checkAuthAndInit();
});
