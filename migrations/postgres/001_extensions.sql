-- Migration 001: Extensions
-- Enables pgcrypto for cryptographic utility functions if needed.
-- Application primary keys are generated as UUIDv7 in application code.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
