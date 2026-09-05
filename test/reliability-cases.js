// Invoked inside the existing authenticated integration fixture. Upstreams are mocked.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
module.exports = async function (
  t,
  { account, request, db, storage, context }
) {
  const a = await account('Reliability');
  const b = await account('ReliabilityOther');
  const jobs = require('../services/jobs'),
    publishing = require('../services/publishing'),
    scheduler = require('../services/scheduler'),
    axios = require('axios'),
    ai = require('../services/ai');
  const page = '333333333',
    otherPage = '333333334';
  const scoped = (fn) => context.run(a.workspace, fn);
  await scoped(async () => {
    await storage.addConnectedPage({
      id: page,
      name: 'Original',
      accessToken: 'mock-original',
      setAsActive: true
    });
    await storage.addConnectedPage({
      id: otherPage,
      name: 'Other',
      accessToken: 'mock-other'
    });
    await storage.setActivePage(page);
  });
  const auth = { cookie: a.cookie, csrf: a.csrf };
  const make = (extra = {}) =>
    scoped(() =>
      publishing.enqueue({
        facebookPageId: page,
        message: 'test ' + randomUUID(),
        ...extra
      })
    );
  const processJob = (id) =>
    scoped(() => publishing.processJob(id, { forceDue: true }));
  const expire = (id) =>
    db.query(
      "UPDATE scheduled_posts SET lease_expires_at=now()-interval '1 second' WHERE workspace_id=$1 AND id=$2",
      [a.workspace, id]
    );
  const due = (id) =>
    db.query(
      "UPDATE scheduled_posts SET next_attempt_at=now()-interval '1 second' WHERE workspace_id=$1 AND id=$2",
      [a.workspace, id]
    );
  const originalPost = axios.post;
  try {
    await t.test(
      'manual and queue publishing share fenced idempotent delivery with fixed page',
      async () => {
        let calls = [];
        axios.post = async (url, body) => {
          calls.push({ url, body });
          await new Promise((r) => setTimeout(r, 20));
          return { data: { id: page + '_ok' } };
        };
        const key = randomUUID(),
          body = {
            message: 'Manual idempotency',
            facebookPageId: page,
            isDemo: 'false'
          };
        const results = await Promise.all(
          Array.from({ length: 5 }, () =>
            request('/api/post', {
              ...auth,
              method: 'POST',
              body,
              headers: { 'Idempotency-Key': key }
            })
          )
        );
        assert.equal(calls.length, 1);
        assert.ok(results.every((r) => [200, 202].includes(r.status)));
        assert.ok(results.some((r) => r.data.published === true));
        const replay = await request('/api/post', {
          ...auth,
          method: 'POST',
          body,
          headers: { 'Idempotency-Key': key }
        });
        assert.equal(replay.data.published, true);
        assert.equal(calls.length, 1);
        const conflict = await request('/api/post', {
          ...auth,
          method: 'POST',
          body: { ...body, message: 'changed' },
          headers: { 'Idempotency-Key': key }
        });
        assert.equal(conflict.status, 409);
        const missing = await request('/api/post', {
          ...auth,
          method: 'POST',
          body,
          headers: { 'Idempotency-Key': '' }
        });
        assert.equal(missing.status, 400);
        const job = await make({
          message: 'Frozen page',
          scheduledAt: '2099-01-01T00:00:00Z'
        });
        await scoped(() => storage.setActivePage(otherPage));
        const result = await request(`/api/queue/${job.id}/publish-now`, {
          ...auth,
          method: 'POST'
        });
        assert.equal(result.data.published, true);
        assert.match(calls.at(-1).url, new RegExp('/' + page + '/feed$'));
        assert.equal(calls.at(-1).body.access_token, 'mock-original');
        const rows = await db.query(
          'SELECT * FROM post_history WHERE workspace_id=$1 AND job_id=$2',
          [a.workspace, job.id]
        );
        assert.equal(rows.rowCount, 1);
        assert.equal(rows.rows[0].facebook_page_id, page);
        const cross = await request(`/api/queue/${job.id}`, {
          cookie: b.cookie
        });
        assert.equal(cross.status, 404);
        await scoped(() => storage.setActivePage(page));
        // A deleted job leaves an operation receipt, not permission to send again.
        await request(`/api/queue/${replay.data.jobId}`, {
          ...auth,
          method: 'DELETE'
        });
        const removedReplay = await request('/api/post', {
          ...auth,
          method: 'POST',
          body,
          headers: { 'Idempotency-Key': key }
        });
        assert.equal(removedReplay.data.published, true);
        assert.equal(calls.length, 2);
      }
    );
    await t.test(
      'legacy completed rows without receipts cannot claim publication success',
      async () => {
        const job = await make();
        await scoped(() =>
          storage.updateQueueItem(job.id, { status: 'completed' })
        );
        let calls = 0;
        axios.post = async () => {
          calls++;
          throw new Error('Unexpected dispatch');
        };
        const response = await request(`/api/queue/${job.id}/publish-now`, {
          ...auth,
          method: 'POST'
        });
        assert.equal(response.status, 409);
        assert.equal(response.data.published, false);
        assert.equal(calls, 0);
      }
    );
    await t.test(
      'concurrent inserts and same-key enqueue preserve all intended jobs',
      async () => {
        const created = await Promise.all(
          Array.from({ length: 16 }, (_, i) =>
            make({ message: 'Concurrent ' + i })
          )
        );
        assert.equal(new Set(created.map((j) => j.id)).size, 16);
        const listed = await scoped(() => storage.getQueue());
        assert.ok(created.every((j) => listed.some((r) => r.id === j.id)));
        const key = randomUUID(),
          same = await Promise.all(
            Array.from({ length: 8 }, () =>
              make({ message: 'one intent', operationKey: key })
            )
          );
        assert.equal(new Set(same.map((j) => j.id)).size, 1);
        await scoped(() => storage.removeFromQueue(same[0].id));
        const deleted = await make({
          message: 'one intent',
          operationKey: key
        });
        assert.equal(deleted.status, 'removed');
        assert.equal(deleted.id, null);
      }
    );
    await t.test(
      'explicit rejection retries with backoff and one final history receipt',
      async () => {
        let calls = 0;
        axios.post = async () => {
          calls++;
          if (calls === 1)
            throw {
              response: {
                status: 429,
                headers: { 'retry-after': '90' },
                data: { error: { code: 4 } }
              }
            };
          return { data: { id: 'retry_ok' } };
        };
        const job = await make();
        const result = await processJob(job.id);
        assert.equal(result.status, 'retry_wait');
        assert.ok(Date.parse(result.nextAttemptAt) - Date.now() > 85000);
        await processJob(job.id);
        assert.equal(calls, 1);
        await due(job.id);
        const success = await processJob(job.id);
        assert.equal(success.status, 'completed');
        assert.equal(success.attemptCount, 2);
        assert.equal(calls, 2);
        assert.equal(
          (
            await db.query(
              'SELECT * FROM post_history WHERE workspace_id=$1 AND job_id=$2',
              [a.workspace, job.id]
            )
          ).rowCount,
          1
        );
      }
    );
    await t.test(
      'Publish Now retries ignore original future time without bypassing backoff',
      async () => {
        let calls = 0;
        axios.post = async () => {
          calls++;
          if (calls === 1)
            throw { response: { status: 429, data: { error: { code: 4 } } } };
          return { data: { id: 'future_forced_retry' } };
        };
        const job = await make({ scheduledAt: '2099-01-01T00:00:00Z' });
        assert.equal((await processJob(job.id)).status, 'retry_wait');
        await scoped(() => publishing.processJob(job.id));
        assert.equal(calls, 1);
        await due(job.id);
        assert.equal(
          (await scoped(() => publishing.processJob(job.id))).status,
          'completed'
        );
        assert.equal(calls, 2);
      }
    );
    await t.test(
      'photo rejection never falls back to publishing a text-only post',
      async () => {
        const media = require('../security/media');
        const buffer = await require('sharp')({
          create: { width: 4, height: 4, channels: 3, background: '#ffffff' }
        })
          .jpeg()
          .toBuffer();
        const asset = await scoped(() => media.store(buffer));
        let calls = [];
        axios.post = async (url, body) => {
          calls.push(url);
          body.resume?.();
          throw { response: { status: 400, data: { error: { code: 190 } } } };
        };
        const job = await make({ imageUrl: asset.url });
        const result = await processJob(job.id);
        assert.equal(result.status, 'failed');
        assert.equal(calls.length, 1);
        assert.match(calls[0], /\/photos$/);
      }
    );
    await t.test(
      'timeouts, resets, malformed successes and 5xx require review without blind retry',
      async () => {
        for (const error of [
          { code: 'ETIMEDOUT' },
          { code: 'ECONNRESET' },
          {
            response: { status: 503, data: { error: { is_transient: true } } }
          },
          null
        ]) {
          let calls = 0;
          axios.post = async () => {
            calls++;
            if (error) throw error;
            return { data: { success: true } };
          };
          const job = await make();
          const result = await processJob(job.id);
          assert.equal(result.status, 'needs_review');
          assert.equal(result.errorCode, 'DELIVERY_UNKNOWN');
          await processJob(job.id);
          assert.equal(calls, 1);
          await assert.rejects(
            scoped(() => jobs.retry(job.id)),
            { statusCode: 409 }
          );
          assert.equal(
            (
              await db.query(
                'SELECT * FROM post_history WHERE workspace_id=$1 AND job_id=$2',
                [a.workspace, job.id]
              )
            ).rowCount,
            0
          );
        }
      }
    );
    await t.test(
      'missing credentials and demo mode never produce fake publication success',
      async () => {
        let calls = 0;
        axios.post = async () => {
          calls++;
          return { data: { id: 'must-not-publish' } };
        };
        await scoped(() =>
          storage.addConnectedPage({
            id: '333333335',
            name: 'No token',
            accessToken: ''
          })
        );
        const missing = await make({ facebookPageId: '333333335' });
        assert.equal(
          (await processJob(missing.id)).errorCode,
          'MISSING_CREDENTIALS'
        );
        const demo = await make({ isDemo: true });
        assert.equal((await processJob(demo.id)).errorCode, 'DEMO_DISABLED');
        assert.equal(calls, 0);
        await scoped(() => storage.saveSettings({ isDemoMode: false }));
      }
    );
    await t.test(
      'finite retry budget and safe manual recovery after credential correction',
      async () => {
        axios.post = async () => {
          throw { response: { status: 400, data: { error: { code: 190 } } } };
        };
        const job = await make();
        assert.equal(
          (await processJob(job.id)).errorCode,
          'META_TOKEN_INVALID'
        );
        await scoped(() => jobs.retry(job.id));
        axios.post = async () => ({ data: { id: 'fixed-token' } });
        assert.equal((await processJob(job.id)).status, 'completed');
        const exhausted = await make();
        await db.query(
          'UPDATE scheduled_posts SET max_attempts=1 WHERE workspace_id=$1 AND id=$2',
          [a.workspace, exhausted.id]
        );
        axios.post = async () => {
          throw { code: 'ECONNREFUSED' };
        };
        assert.equal((await processJob(exhausted.id)).status, 'failed');
        await assert.rejects(
          scoped(() => jobs.retry(exhausted.id)),
          /budget exhausted/
        );
      }
    );
    await t.test(
      'restart recovery fences expired workers and quarantines dispatched requests',
      async () => {
        const { execFile } = require('node:child_process'),
          { promisify } = require('node:util');
        const run = promisify(execFile);
        const safe = await make(),
          uncertain = await make();
        const code = `const c=require('./security/context'),j=require('./services/jobs'),db=require('./services/db');c.run(${JSON.stringify(a.workspace)},async()=>{const safe=await j.claim(${JSON.stringify(safe.id)});const unsafe=await j.claim(${JSON.stringify(uncertain.id)});await j.dispatch(unsafe);console.log(JSON.stringify({safe,unsafe}));await db.pool.end();}).then(()=>process.exit(0),()=>process.exit(1));`;
        const child = await run(process.execPath, ['-e', code], {
          cwd: process.cwd(),
          env: process.env
        });
        const previous = JSON.parse(child.stdout.trim());
        await expire(safe.id);
        await expire(uncertain.id);
        await jobs.recover();
        await scoped(async () => {
          assert.equal((await jobs.get(safe.id)).status, 'retry_wait');
          assert.equal((await jobs.get(uncertain.id)).status, 'needs_review');
          assert.equal(await jobs.heartbeat(previous.safe), false);
          assert.equal(
            await jobs.checkpoint(previous.safe, {
              message: 'stale overwrite'
            }),
            false
          );
          assert.equal(await jobs.dispatch(previous.safe), false);
          assert.equal(
            await jobs.finish(previous.unsafe, {
              postId: 'late_remote_success'
            }),
            false
          );
        });
        const audit = await db.query(
          'SELECT outcome,provider_result FROM publication_attempts WHERE workspace_id=$1 AND job_id=$2',
          [a.workspace, uncertain.id]
        );
        assert.equal(audit.rows[0].outcome, 'late_success');
        assert.equal(
          audit.rows[0].provider_result.postId,
          'late_remote_success'
        );
        await due(safe.id);
        axios.post = async () => ({ data: { id: 'recovered' } });
        assert.equal((await processJob(safe.id)).status, 'completed');
      }
    );
    await t.test(
      'AI failures never use canned topics/captions or publish unrelated content',
      async () => {
        let meta = 0;
        axios.post = async (url) => {
          if (url.includes('graph.facebook.com')) meta++;
          throw { response: { status: 503 } };
        };
        await scoped(() =>
          storage.saveSettings({
            geminiApiKey: 'mock-gemini',
            includeAiImage: false
          })
        );
        process.env.ALLOW_EXTERNAL_AI_FALLBACK = 'true';
        await scoped(async () => {
          await assert.rejects(
            ai.generateFullPostBundle({
              topic: 'My exact topic',
              pageId: page,
              includeImage: false
            }),
            /generation failed/
          );
          await assert.rejects(
            ai.generateFullPostBundle({
              topic: '',
              pageId: page,
              includeImage: false
            }),
            /topic generation failed/
          );
          await assert.rejects(
            ai.regenerateCaptionOnly({
              topic: 'Specific topic',
              currentMessage: 'Old caption'
            }),
            /generation failed/
          );
          await assert.rejects(
            ai.generateTopicIdeas({ keyword: 'Specific topic' }),
            /generation failed/
          );
        });
        const job = await make({
          kind: 'autopilot',
          topic: 'Specific topic',
          includeImage: false
        });
        const result = await processJob(job.id);
        assert.equal(result.status, 'retry_wait');
        assert.equal(result.errorCode, 'AI_GENERATION_FAILED');
        assert.equal(meta, 0);
        delete process.env.ALLOW_EXTERNAL_AI_FALLBACK;
      }
    );
    await t.test(
      'generated AI content checkpoints persist across safe publishing retries',
      async () => {
        const original = ai.generateFullPostBundle;
        let generated = 0,
          calls = 0;
        ai.generateFullPostBundle = async () => {
          generated++;
          return { message: 'Generated exact content' };
        };
        axios.post = async (url, body) => {
          assert.equal(body.message, 'Generated exact content');
          calls++;
          if (calls === 1)
            throw { response: { status: 429, data: { error: { code: 4 } } } };
          return { data: { id: 'ai_retried' } };
        };
        try {
          const job = await make({
            kind: 'autopilot',
            topic: 'A topic',
            includeImage: false
          });
          assert.equal((await processJob(job.id)).status, 'retry_wait');
          await due(job.id);
          assert.equal((await processJob(job.id)).status, 'completed');
          assert.equal(generated, 1);
          assert.equal(calls, 2);
        } finally {
          ai.generateFullPostBundle = original;
        }
      }
    );
    await t.test(
      'autopilot schedule is durable, timezone-aware, coalesced and page-frozen',
      async () => {
        await scoped(async () => {
          await storage.setActivePage(page);
          await storage.saveSettings({
            autoPilotEnabled: true,
            autoPilotPageId: page,
            timeZone: 'Asia/Kolkata',
            cronSchedule: '0 9 * * *'
          });
          await scheduler.sync();
        });
        let row = (
          await db.query(
            'SELECT * FROM autopilot_schedules WHERE workspace_id=$1',
            [a.workspace]
          )
        ).rows[0];
        assert.equal(row.next_run_at.toISOString().slice(11, 16), '03:30');
        const revision = row.revision;
        await scoped(async () => {
          await storage.setActivePage(otherPage);
          await scheduler.sync();
        });
        row = (
          await db.query(
            'SELECT * FROM autopilot_schedules WHERE workspace_id=$1',
            [a.workspace]
          )
        ).rows[0];
        assert.equal(row.facebook_page_id, page);
        assert.equal(row.revision, revision);
        await db.query(
          "UPDATE autopilot_schedules SET next_run_at=now()-interval '7 days' WHERE workspace_id=$1",
          [a.workspace]
        );
        const results = await Promise.all(
          Array.from({ length: 5 }, () =>
            scoped(() => scheduler.materializeDue())
          )
        );
        assert.equal(results.filter(Boolean).length, 1);
        assert.equal(results.find(Boolean).facebookPageId, page);
        row = (
          await db.query(
            'SELECT * FROM autopilot_schedules WHERE workspace_id=$1',
            [a.workspace]
          )
        ).rows[0];
        assert.ok(row.next_run_at.getTime() > Date.now());
        await scoped(() => storage.saveSettings({ autoPilotEnabled: false }));
      }
    );
    await t.test(
      'duplicate image uploads use content identity without duplicate delivery',
      async () => {
        const media = require('../security/media');
        const buffer = await require('sharp')({
          create: { width: 8, height: 8, channels: 3, background: '#123456' }
        })
          .jpeg()
          .toBuffer();
        const first = await scoped(() => media.store(buffer)),
          second = await scoped(() => media.store(buffer)),
          key = randomUUID();
        let calls = 0;
        axios.post = async (url, body) => {
          calls++;
          body.resume?.();
          return { data: { post_id: 'photo_once' } };
        };
        const one = await make({
          message: 'Photo intent',
          imageUrl: first.url,
          operationKey: key
        });
        assert.equal((await processJob(one.id)).status, 'completed');
        const two = await make({
          message: 'Photo intent',
          imageUrl: second.url,
          operationKey: key
        });
        assert.equal(two.id, one.id);
        await processJob(two.id);
        assert.equal(calls, 1);
      }
    );
    await t.test(
      '002 to 003 upgrade preserves pending posts and quarantines old in-flight work',
      async () => {
        const fs = require('node:fs/promises'),
          path = require('node:path');
        const schema = 'upgrade_' + randomUUID().replaceAll('-', '');
        await assert.rejects(
          db.transaction(async () => {
            await db.query(`CREATE SCHEMA "${schema}"`);
            await db.query(`SET LOCAL search_path TO "${schema}",public`);
            for (const file of [
              '001_security_foundation.sql',
              '002_backend_integrity.sql'
            ])
              await db.query(
                await fs.readFile(
                  path.join(__dirname, '../db/migrations', file),
                  'utf8'
                )
              );
            await db.query('INSERT INTO workspaces(id,name) VALUES($1,$2)', [
              a.workspace,
              'Upgrade'
            ]);
            await db.query(
              'INSERT INTO facebook_pages(workspace_id,id,data) VALUES($1,$2,$3)',
              [a.workspace, page, { id: page }]
            );
            for (const status of ['pending', 'processing'])
              await db.query(
                'INSERT INTO scheduled_posts(workspace_id,id,facebook_page_id,status,scheduled_at,data) VALUES($1,$2,$3,$4,$5,$6)',
                [
                  a.workspace,
                  status,
                  page,
                  status,
                  '2030-01-01T00:00:00Z',
                  {
                    id: status,
                    facebookPageId: page,
                    status,
                    message: 'Keep original'
                  }
                ]
              );
            await db.query(
              await fs.readFile(
                path.join(
                  __dirname,
                  '../db/migrations/003_publishing_reliability.sql'
                ),
                'utf8'
              )
            );
            const rows = (
              await db.query('SELECT * FROM scheduled_posts ORDER BY id')
            ).rows;
            assert.equal(rows[0].status, 'pending');
            assert.equal(rows[0].data.message, 'Keep original');
            assert.equal(
              rows[0].scheduled_at.toISOString(),
              '2030-01-01T00:00:00.000Z'
            );
            assert.equal(rows[1].status, 'needs_review');
            assert.equal(rows[1].last_error_code, 'LEGACY_IN_FLIGHT');
            throw new Error('rollback-reliability-upgrade');
          }),
          /rollback-reliability-upgrade/
        );
      }
    );
    await t.test(
      'standalone worker starts and shuts down using persistent PostgreSQL state',
      async () => {
        const { promisify } = require('node:util'),
          { execFile } = require('node:child_process');
        const code =
          "process.env.ENABLE_AUTOMATION='true';const axios=require('axios');axios.get=axios.post=async()=>{throw new Error('Upstream blocked by worker smoke test')};require('./worker').start().then(()=>process.kill(process.pid,'SIGTERM'),()=>process.exit(1));";
        const result = await promisify(execFile)(
          process.execPath,
          ['-e', code],
          { cwd: process.cwd(), env: process.env, timeout: 15000 }
        );
        assert.match(result.stdout, /Durable publishing worker started/);
      }
    );
    await t.test(
      'API scheduling rejects ambiguous local times and freezes the chosen instant',
      async () => {
        const bad = await request('/api/queue', {
          ...auth,
          method: 'POST',
          body: {
            message: 'DST',
            facebookPageId: page,
            scheduledLocal: '2026-11-01T01:30',
            timeZone: 'America/New_York'
          }
        });
        assert.equal(bad.status, 400);
        const good = await request('/api/queue', {
          ...auth,
          method: 'POST',
          body: {
            message: 'Kolkata time',
            facebookPageId: page,
            scheduledLocal: '2030-09-05T13:45',
            timeZone: 'Asia/Kolkata'
          }
        });
        assert.equal(good.status, 200);
        assert.equal(good.data.item.scheduledAt, '2030-09-05T08:15:00Z');
        await scoped(() => storage.saveSettings({ timeZone: 'UTC' }));
        const read = await request(`/api/queue/${good.data.item.id}`, auth);
        assert.equal(read.data.item.timeZone, 'Asia/Kolkata');
        assert.equal(read.data.item.scheduledAt, good.data.item.scheduledAt);
        const badCron = await request('/api/settings', {
          ...auth,
          method: 'POST',
          body: { cronSchedule: '* * * * * *' }
        });
        assert.equal(badCron.status, 400);
      }
    );
  } finally {
    axios.post = originalPost;
    delete process.env.ALLOW_EXTERNAL_AI_FALLBACK;
  }
};
