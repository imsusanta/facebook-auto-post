const storage = require('./storage');
const jobs = require('./jobs');
const media = require('../security/media');
const context = require('../security/context');
const { PublishingError } = require('./publishing-errors');
const { broadcastSSE } = require('../middleware/sse');
async function enqueue(input, options = {}) {
  return storage.addToQueue({ ...input, ...options });
}
async function processJob(id, { forceDue = false } = {}) {
  const claimed = await jobs.claim(id, { forceDue });
  if (!claimed) return jobs.get(id);
  return context.run(
    context.current().workspaceId,
    async () => {
      let leaseLost = false,
        dispatchStarted = false,
        beating = false;
      const heartbeat = setInterval(async () => {
        if (beating) return;
        beating = true;
        try {
          if (!(await jobs.heartbeat(claimed))) leaseLost = true;
        } catch {
          leaseLost = true;
        } finally {
          beating = false;
        }
      }, 30000);
      heartbeat.unref();
      try {
        const settings = await storage.getSettings();
        if (settings.pageId !== claimed.facebookPageId || !settings.accessToken)
          throw new PublishingError(
            'MISSING_CREDENTIALS',
            'Configure this page’s Facebook credentials before publishing'
          );
        if (settings.isDemoMode || claimed.isDemo)
          throw new PublishingError(
            'DEMO_DISABLED',
            'Demo posts are never reported as real publications. Disable demo mode to publish.'
          );
        let message = claimed.message || '',
          imageUrl = claimed.imageUrl || null;
        if (claimed.kind === 'autopilot' && !claimed.generated) {
          if (!settings.geminiApiKey)
            throw new PublishingError(
              'MISSING_GEMINI_KEY',
              'Configure Gemini before enabling AI auto-publishing'
            );
          let bundle;
          try {
            bundle = await require('./ai').generateFullPostBundle({
              topic: claimed.topic || '',
              categoryId: claimed.categoryId || '',
              pageId: claimed.facebookPageId,
              includeImage: claimed.includeImage !== false
            });
          } catch (error) {
            throw new PublishingError(
              'AI_GENERATION_FAILED',
              'AI generation failed; no Facebook request was made',
              {
                retryable: !(error.statusCode >= 400 && error.statusCode < 500)
              }
            );
          }
          if (!bundle?.message?.trim() || bundle.fallback || bundle.demo)
            throw new PublishingError(
              'AI_INVALID_OUTPUT',
              'AI did not return valid publishable content',
              { retryable: true }
            );
          if (claimed.includeImage !== false && !bundle.image?.url)
            throw new PublishingError(
              'AI_IMAGE_FAILED',
              'Requested image generation failed; nothing was published',
              { retryable: true }
            );
          message = bundle.message;
          imageUrl = bundle.image?.url || null;
          if (
            !(await jobs.checkpoint(claimed, {
              message,
              imageUrl,
              generated: true
            }))
          )
            return jobs.get(id);
        }
        let imagePath = null;
        if (imageUrl) {
          if (imageUrl.startsWith('/uploads/'))
            imagePath = await media.resolve(imageUrl);
          else {
            try {
              const asset = await media.store(await media.load(imageUrl));
              imageUrl = asset.url;
              imagePath = asset.localPath;
            } catch (error) {
              throw new PublishingError(
                'IMAGE_PREPARATION_FAILED',
                'Image preparation failed before publishing',
                {
                  retryable: !(
                    error.statusCode >= 400 && error.statusCode < 500
                  )
                }
              );
            }
          }
        }
        if (!message.trim() && !imagePath)
          throw new PublishingError('EMPTY_POST', 'Message or image required');
        if (!(await jobs.checkpoint(claimed, { message, imageUrl })))
          return jobs.get(id);
        if (leaseLost || !(await jobs.dispatch(claimed))) return jobs.get(id);
        dispatchStarted = true;
        const result = await require('./facebook').publishPost({
          message,
          imagePath,
          source: claimed.source || claimed.kind
        });
        if (!result?.success || result.demo || !result.postId)
          throw new PublishingError(
            'DELIVERY_UNKNOWN',
            'Facebook did not confirm a real post ID',
            { delivery: 'unknown' }
          );
        const committed = await jobs.finish(claimed, result);
        if (committed)
          await broadcastSSE('post_success', { jobId: id, result });
        return jobs.get(id);
      } catch (error) {
        const safe =
          error instanceof PublishingError
            ? error
            : new PublishingError(
                dispatchStarted ? 'DELIVERY_UNKNOWN' : 'PREPARATION_FAILED',
                dispatchStarted
                  ? 'Delivery is uncertain; check Facebook before retrying.'
                  : 'Preparation failed; no Facebook request was made.',
                {
                  delivery: dispatchStarted ? 'unknown' : 'not_sent',
                  retryable:
                    !dispatchStarted &&
                    !(error.statusCode >= 400 && error.statusCode < 500)
                }
              );
        const result = await jobs.fail(claimed, safe);
        await broadcastSSE('post_failed', {
          jobId: id,
          status: result?.status,
          error: safe.message
        });
        return result;
      } finally {
        clearInterval(heartbeat);
        await broadcastSSE('queue_updated', await storage.getQueue());
        await broadcastSSE('history_updated', await storage.getHistory());
      }
    },
    { targetPageId: claimed.facebookPageId }
  );
}
function respond(res, job) {
  const receipt = job?.receipt;
  if (
    job?.status === 'completed' &&
    (!(job.postId || receipt?.postId) || job.isDemo || job.demo)
  )
    return res
      .status(409)
      .json({
        success: false,
        published: false,
        jobId: job.id,
        error:
          'Historical completion has no confirmed real post receipt. Review Facebook before creating another publication.',
        item: job
      });
  if (job?.status === 'completed')
    return res.json({
      success: true,
      published: true,
      jobId: job.id,
      replayed: !!job.replayed,
      postId: job.postId || receipt?.postId,
      fbUrl: job.fbUrl || receipt?.fbUrl,
      item: job
    });
  if (['pending', 'processing', 'retry_wait'].includes(job?.status))
    return res.status(202).json({
      success: true,
      published: false,
      queued: true,
      jobId: job.id,
      item: job,
      message: 'Saved durably. Check the queue for delivery status.'
    });
  return res.status(job?.status === 'removed' ? 410 : 409).json({
    success: false,
    published: false,
    jobId: job?.id,
    item: job,
    error: job?.error || 'Job requires review or cannot be published again.'
  });
}
module.exports = { enqueue, processJob, respond };
