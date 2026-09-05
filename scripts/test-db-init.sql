-- Disposable Docker test cluster only. Never run against an existing database.
CREATE ROLE app_test LOGIN PASSWORD 'test_password_only'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE DATABASE facebook_auto_poster_test OWNER app_test;
REVOKE ALL ON DATABASE postgres FROM app_test;
