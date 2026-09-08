-- Gate 5: Rollback durable publishing pipeline tables

DROP TABLE IF EXISTS workspace_publish_idempotency CASCADE;
DROP TABLE IF EXISTS workspace_publish_attempts CASCADE;
DROP TABLE IF EXISTS workspace_publish_jobs CASCADE;
