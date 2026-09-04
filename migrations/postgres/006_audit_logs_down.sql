-- Migration 006 Down: Audit Logs Rollback

DROP TABLE IF EXISTS audit_logs CASCADE;
