const { test } = require('node:test');
const assert = require('node:assert/strict');
const { instant, nextCron, validateZone } = require('../services/scheduling');
const { fromFacebook, backoff } = require('../services/publishing-errors');
test('IANA scheduling preserves instants and rejects DST gaps and overlaps', () => {
  assert.equal(
    instant({ scheduledLocal: '2026-09-05T13:47', timeZone: 'Asia/Kolkata' }),
    '2026-09-05T08:17:00Z'
  );
  assert.equal(
    instant({ scheduledAt: '2026-11-01T01:30:00-04:00' }),
    '2026-11-01T05:30:00Z'
  );
  for (const local of ['2026-03-08T02:30', '2026-11-01T01:30'])
    assert.throws(
      () => instant({ scheduledLocal: local, timeZone: 'America/New_York' }),
      { statusCode: 400 }
    );
  assert.throws(() => instant({ scheduledAt: '2026-09-05T13:45' }));
  assert.throws(() => validateZone('Fake/Zone'));
  assert.equal(
    nextCron(
      '0 9 * * *',
      'Asia/Kolkata',
      new Date('2026-09-05T04:00:00Z')
    ).toISOString(),
    '2026-09-06T03:30:00.000Z'
  );
});
test('retry classifier is conservative and backoff is bounded with Retry-After support', () => {
  assert.equal(fromFacebook({ code: 'ECONNREFUSED' }).retryable, true);
  assert.equal(fromFacebook({ code: 'ECONNRESET' }).delivery, 'unknown');
  assert.equal(
    fromFacebook({
      response: { status: 500, data: { error: { is_transient: true } } }
    }).delivery,
    'unknown'
  );
  assert.equal(
    fromFacebook({ response: { status: 400, data: { error: { code: 190 } } } })
      .retryable,
    false
  );
  assert.equal(
    backoff(1, 0, () => 0),
    30000
  );
  assert.equal(
    backoff(2, 0, () => 0),
    60000
  );
  assert.equal(
    backoff(1, 90, () => 0),
    90000
  );
  assert.equal(
    backoff(20, 0, () => 0),
    3600000
  );
});
