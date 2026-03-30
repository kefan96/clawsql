-- Metadata MySQL initialization script
-- Creates database and user for ClawSQL
-- Orchestrator creates its own schema during startup
-- ClawSQL tables are created after Orchestrator is ready

-- =============================================================================
-- User Setup (mysql_native_password for Orchestrator compatibility)
-- =============================================================================

-- Drop the user created by MYSQL_USER env var (which uses caching_sha2_password)
DROP USER IF EXISTS 'clawsql'@'%';

-- Recreate with mysql_native_password for Orchestrator compatibility
CREATE USER 'clawsql'@'%' IDENTIFIED WITH mysql_native_password BY 'clawsql_password';
GRANT ALL PRIVILEGES ON *.* TO 'clawsql'@'%' WITH GRANT OPTION;

-- Create database for Orchestrator and ClawSQL
CREATE DATABASE IF NOT EXISTS clawsql_meta;

FLUSH PRIVILEGES;

-- Note: Orchestrator creates its own tables during startup
-- ClawSQL application tables are created by the start command after Orchestrator is healthy