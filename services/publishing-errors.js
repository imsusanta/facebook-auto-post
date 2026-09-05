class PublishingError extends Error {
  constructor(
    code,
    message,
    { retryable = false, delivery = 'not_sent', retryAfter = 0 } = {}
  ) {
    super(message);
    Object.assign(this, {
      code,
      retryable,
      delivery,
      retryAfter,
      expose: true,
      statusCode: retryable ? 503 : 400
    });
  }
}
function fromFacebook(error) {
  if (error instanceof PublishingError) return error;
  const status = error.response?.status,
    graph = error.response?.data?.error;
  const header = error.response?.headers?.['retry-after'];
  let retryAfter = Number(header);
  if (!Number.isFinite(retryAfter) && header)
    retryAfter = Math.max(0, (Date.parse(header) - Date.now()) / 1000);
  retryAfter = Number.isFinite(retryAfter)
    ? Math.min(86400, Math.max(0, retryAfter))
    : 0;
  if (
    ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ENETUNREACH'].includes(
      error.code
    )
  )
    return new PublishingError(
      'CONNECTION_NOT_SENT',
      'Connection failed before Facebook received the request',
      { retryable: true }
    );
  if (status >= 400 && status < 500) {
    if (
      status === 429 ||
      [4, 17, 32, 613].includes(graph?.code) ||
      graph?.is_transient === true
    )
      return new PublishingError(
        'META_REJECTED_TRANSIENT',
        'Facebook rejected the request temporarily',
        { retryable: true, delivery: 'rejected', retryAfter }
      );
    return new PublishingError(
      [190, 102].includes(graph?.code) ? 'META_TOKEN_INVALID' : 'META_REJECTED',
      'Facebook rejected the request. Check page permissions and credentials.',
      { delivery: 'rejected' }
    );
  }
  return new PublishingError(
    'DELIVERY_UNKNOWN',
    'Facebook delivery is uncertain. Check the page before posting again.',
    { delivery: 'unknown' }
  );
}
function backoff(attempt, retryAfter = 0, random = Math.random) {
  const seconds = Math.min(3600, 30 * 2 ** Math.max(0, attempt - 1));
  return Math.ceil(Math.max(seconds * (1 + 0.2 * random()), retryAfter) * 1000);
}
module.exports = { PublishingError, fromFacebook, backoff };
