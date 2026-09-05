const { Temporal } = require('@js-temporal/polyfill');
const { CronExpressionParser } = require('cron-parser');
function invalid(message) {
  throw Object.assign(new Error(message), { statusCode: 400, expose: true });
}
function validateZone(zone = 'UTC') {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone }).format();
    return zone;
  } catch {
    invalid('Use a valid IANA timezone');
  }
}
function instant({ scheduledAt, scheduledLocal, timeZone = 'UTC' } = {}) {
  validateZone(timeZone);
  if (scheduledAt && scheduledLocal)
    invalid(
      'Use either scheduledAt with an offset or scheduledLocal, not both'
    );
  try {
    if (scheduledLocal)
      return Temporal.PlainDateTime.from(scheduledLocal)
        .toZonedDateTime(timeZone, { disambiguation: 'reject' })
        .toInstant()
        .toString();
    if (scheduledAt) {
      if (!/(Z|[+-]\d\d:\d\d)$/i.test(scheduledAt))
        invalid(
          'scheduledAt needs an explicit UTC offset; use scheduledLocal for a local time'
        );
      return Temporal.Instant.from(scheduledAt).toString();
    }
    return null;
  } catch (error) {
    if (error.expose) throw error;
    invalid(
      'Invalid, nonexistent or ambiguous local time. Choose another time or provide an explicit UTC offset.'
    );
  }
}
function nextCron(expression, zone = 'UTC', from = new Date()) {
  validateZone(zone);
  if (
    typeof expression !== 'string' ||
    expression.trim().split(/\s+/).length !== 5
  )
    invalid('Use a five-field cron expression');
  try {
    return CronExpressionParser.parse(expression, {
      tz: zone,
      currentDate: from
    })
      .next()
      .toDate();
  } catch {
    invalid('Invalid cron schedule');
  }
}
module.exports = { validateZone, instant, nextCron };
