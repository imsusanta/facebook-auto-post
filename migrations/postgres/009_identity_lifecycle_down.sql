-- Explicit rollback invalidates all sessions so old software cannot resurrect
-- cookies whose auth_version was revoked. Never run rollback against real data
-- without independent approval and a reviewed recovery plan.
DELETE FROM auth_sessions;
DROP TABLE auth_rate_buckets;
DROP TABLE account_security_events;
DROP TABLE auth_mail_outbox;
DROP TABLE auth_action_tokens;
ALTER TABLE auth_sessions DROP COLUMN auth_version;
ALTER TABLE users DROP COLUMN auth_version;
