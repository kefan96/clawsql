-- Primary initialization script
-- Create universal admin user for ClawSQL (used by Orchestrator, monitoring, and management)
CREATE USER IF NOT EXISTS 'clawsql'@'%' IDENTIFIED WITH mysql_native_password BY 'clawsql_password';
GRANT ALL PRIVILEGES ON *.* TO 'clawsql'@'%' WITH GRANT OPTION;

-- Create demo database
CREATE DATABASE IF NOT EXISTS clawsql;

-- Create application user for demo database
CREATE USER IF NOT EXISTS 'app'@'%' IDENTIFIED WITH mysql_native_password BY 'apppassword';
GRANT ALL PRIVILEGES ON clawsql.* TO 'app'@'%';

FLUSH PRIVILEGES;