-- Rollback Gate 4: Facebook/Meta OAuth integration tables
-- Drop in reverse foreign key dependency order.

DROP TABLE IF EXISTS workspace_webhook_events;
DROP TABLE IF EXISTS workspace_webhook_subscriptions;
DROP TABLE IF EXISTS workspace_oauth_states;
DROP TABLE IF EXISTS workspace_page_tokens;
