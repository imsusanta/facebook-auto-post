const { z } = require('zod');
const storage = require('../services/storage');
const media = require('./media');
const text = z.string().max(20000),
  short = z.string().max(200),
  secret = z.string().max(4096);
const image = z
  .string()
  .max(3000)
  .refine(
    (v) =>
      v === '' ||
      /^\/uploads\/[a-f\d-]+\.jpg$/.test(v) ||
      /^https:\/\//.test(v),
    'Image must be owned media or an HTTPS URL'
  );
const bool = z.boolean();
const settings = z
  .object({
    pageId: short.optional(),
    pageName: short.optional(),
    accessToken: secret.optional(),
    geminiApiKey: secret.optional(),
    customSystemPrompt: text.optional(),
    autoPostEnabled: bool.optional(),
    autoPilotEnabled: bool.optional(),
    isDemoMode: bool.optional(),
    cronSchedule: z.string().max(100).optional(),
    timeZone: short.optional(),
    autoPilotPageId: short.optional(),
    cronLabel: short.optional(),
    intervalMinutes: z.number().int().min(1).max(1440).optional(),
    selectedCategories: z.array(short).max(30).optional(),
    includeAiImage: bool.optional()
  })
  .strict();
const template = z
  .object({
    title: short.optional(),
    badge: short.optional(),
    category: short.optional(),
    imageUrl: image.optional(),
    desc: text.optional(),
    sample: text.optional(),
    learnedStyle: z
      .object({
        visualStructure: text.optional(),
        primaryColor: short.optional(),
        headlineFormat: text.optional(),
        writingVoice: text.optional(),
        summary: text.optional()
      })
      .strict()
      .nullable()
      .optional()
  })
  .strict();
const rule = z
  .object({
    name: short.optional(),
    keywords: z.union([z.array(short).max(100), text]).optional(),
    publicReply: text.optional(),
    privateDm: text.optional(),
    sendPrivateDm: bool.optional(),
    autoLike: bool.optional(),
    isActive: bool.optional(),
    id: short.optional()
  })
  .strict();
const rules = z
  .object({
    commentAutomationEnabled: bool.optional(),
    chatAutomationEnabled: bool.optional(),
    aiCommentFallbackEnabled: bool.optional(),
    commentRules: z.array(rule).max(100).optional(),
    chatSettings: z
      .object({
        enabled: bool.optional(),
        welcomeMessage: text.optional(),
        personaPrompt: text.optional(),
        quickReplies: z.array(short).max(20).optional()
      })
      .strict()
      .optional()
  })
  .strict();
const generic = z
  .object({
    message: text.optional(),
    topic: text.optional(),
    categoryId: short.optional(),
    category: short.optional(),
    keyword: short.optional(),
    count: z.number().int().min(1).max(20).optional(),
    pageId: z
      .string()
      .regex(/^\d{1,40}$/)
      .optional(),
    templateId: short.optional(),
    templateImage: image.nullable().optional(),
    imageUrl: image.optional(),
    imageBase64: z.string().max(100000).optional(),
    sampleText: text.optional(),
    includeImage: bool.optional(),
    generateImage: bool.optional(),
    variation: z.number().int().min(0).max(100).optional(),
    currentMessage: text.optional(),
    customPrompt: text.optional(),
    styleMode: short.optional(),
    cardData: z
      .object({
        badge: short.optional(),
        line1_red: short.optional(),
        line1_white: short.optional(),
        line2_white: short.optional(),
        line2_yellow: short.optional(),
        search_term: text.optional()
      })
      .strict()
      .nullable()
      .optional(),
    senderName: short.optional(),
    name: short.optional(),
    title: short.optional(),
    promptContext: text.optional(),
    icon: short.optional(),
    badge: short.optional(),
    accessToken: secret.optional(),
    apiKey: secret.optional(),
    systemPrompt: text.optional(),
    pictureUrl: image.optional(),
    setAsActive: bool.optional()
  })
  .strict();
async function validateReferences(body) {
  for (const key of ['imageUrl', 'templateImage', 'pictureUrl'])
    if (body[key]?.startsWith('/uploads/')) await media.resolve(body[key]);
  if (body.templateId && !(await storage.getTemplateById(body.templateId)))
    throw Object.assign(new Error('Template not found'), {
      statusCode: 404,
      expose: true
    });
}
async function validate(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (
    req.path === '/queue' ||
    req.path === '/post' ||
    req.path === '/facebook/post' ||
    req.is('multipart/form-data')
  )
    return next(); // Validated after multer in publishing routes.
  const path = req.path;
  if (path.startsWith('/workspace/')) return next();
  const schema =
    path === '/settings'
      ? settings
      : path.startsWith('/templates')
        ? template
        : path === '/automation/rules'
          ? rules
          : path === '/automation/rules/comment'
            ? rule
            : generic;
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success)
    return res.status(400).json({ error: 'Invalid request fields or values' });
  req.body = parsed.data;
  if (req.body.timeZone)
    require('../services/scheduling').validateZone(req.body.timeZone);
  if (
    req.body.autoPilotPageId &&
    !(await storage.getPageById(req.body.autoPilotPageId))
  )
    return res.status(404).json({ error: 'Autopilot page not found' });
  if (path === '/settings' && (req.body.cronSchedule || req.body.timeZone)) {
    const current = await storage.getSettings();
    require('../services/scheduling').nextCron(
      req.body.cronSchedule || current.cronSchedule || '0 9,14,20 * * *',
      req.body.timeZone || current.timeZone || 'UTC'
    );
  }
  if (req.body.isDemoMode && process.env.NODE_ENV === 'production')
    return res
      .status(400)
      .json({ error: 'Demo mode is disabled in production' });
  if (
    req.path.startsWith('/ai/') &&
    req.body.pageId &&
    !(await storage.getPageById(req.body.pageId))
  )
    return res.status(404).json({ error: 'Page not found' });
  await validateReferences(req.body);
  next();
}
const post = z
  .object({
    message: text.optional(),
    imageUrl: image.nullable().optional(),
    isDemo: z.union([bool, z.enum(['true', 'false'])]).optional(),
    scheduledAt: z.string().max(64).nullable().optional(),
    scheduledLocal: z.string().max(64).optional(),
    timeZone: short.optional(),
    facebookPageId: z
      .string()
      .regex(/^\d{1,40}$/)
      .optional()
  })
  .strict();
async function validatePost(req, res, next) {
  const p = post.safeParse(req.body || {});
  if (!p.success) return res.status(400).json({ error: 'Invalid post fields' });
  if (p.data.scheduledAt && !Number.isFinite(Date.parse(p.data.scheduledAt)))
    return res.status(400).json({ error: 'Invalid scheduled time' });
  if (
    process.env.NODE_ENV === 'production' &&
    (p.data.isDemo === true || p.data.isDemo === 'true')
  )
    return res.status(400).json({ error: 'Demo mode is disabled' });
  req.body = p.data;
  require('../services/scheduling').instant(req.body);
  await validateReferences(req.body);
  next();
}
module.exports = { validate, validatePost };
