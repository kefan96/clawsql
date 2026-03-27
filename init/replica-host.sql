-- Replica initialization script for host-networked demo
-- Create universal admin user for ClawSQL (used by Orchestrator, monitoring, and management)
CREATE USER IF NOT EXISTS 'clawsql'@'%' IDENTIFIED WITH mysql_native_password BY 'clawsql_password';
GRANT ALL PRIVILEGES ON *.* TO 'clawsql'@'%' WITH GRANT OPTION;

FLUSH PRIVILEGES;
-- Note: Replication is configured via ClawSQL CLI: /instances setup-replication