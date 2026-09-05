'use strict';

// Only errors constructed here may select a public response. Never publish a
// database/SDK message based on its text, name, or an attacker-controlled code.
const PUBLIC_ERRORS = Object.freeze({
  AUTH_REQUIRED: [401, 'AuthRequired', 'Authentication required.'],
  WORKSPACE_NOT_FOUND: [404, 'WorkspaceNotFound', 'Workspace not found or access denied.'],
  RESOURCE_NOT_FOUND: [404, 'ResourceNotFound', 'Requested resource not found or access denied.'],
  PERMISSION_DENIED: [403, 'PermissionDenied', 'You do not have permission to perform this action.'],
  VALIDATION_FAILED: [400, 'ValidationFailed', 'The supplied input is invalid.'],
  INVITATION_INVALID: [400, 'InvitationInvalid', 'The invitation is invalid or unavailable.'],
  OAUTH_STATE_INVALID: [400, 'OAuthStateInvalid', 'OAuth state is invalid, expired, or already consumed.'],
  OAUTH_EXCHANGE_FAILED: [502, 'OAuthExchangeFailed', 'Failed to exchange authorization code for access token.'],
  TOKEN_EXPIRED: [401, 'TokenExpired', 'The stored access token has expired or been revoked.'],
  META_API_ERROR: [502, 'MetaApiError', 'An error occurred communicating with the Meta Graph API.'],
  CONFLICT: [409, 'Conflict', 'A conflict occurred with an existing resource.']
});
class PublicError extends Error {
  constructor(code, diagnosticMessage) {
    if (!Object.hasOwn(PUBLIC_ERRORS, code)) throw new TypeError('Unknown public error code');
    super(diagnosticMessage || PUBLIC_ERRORS[code][2]);
    this.code = code;
  }
}
function publicError(code, diagnosticMessage) { return new PublicError(code, diagnosticMessage); }
function publicResponse(err) {
  const code = err instanceof PublicError ? err.code : err?.code === '23505' ? 'CONFLICT' : 'INTERNAL_ERROR';
  const [status, error, message] = PUBLIC_ERRORS[code] || [500, 'InternalError', 'An unexpected internal error occurred.'];
  return { status, error, message, code };
}
module.exports = { PublicError, publicError, publicResponse };
