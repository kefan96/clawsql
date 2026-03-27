-- Primary initialization script
-- Create replication user with mysql_native_password for compatibility
CREATE USER IF NOT EXISTS 'repl'@'%' IDENTIFIED WITH mysql_native_password BY 'repl_password';
GRANT REPLICATION SLAVE ON *.* TO 'repl'@'%';

-- Create monitoring user
CREATE USER IF NOT EXISTS 'monitor'@'%' IDENTIFIED WITH mysql_native_password BY 'monitorpassword';
GRANT REPLICATION CLIENT, PROCESS ON *.* TO 'monitor'@'%';
GRANT SELECT ON mysql.* TO 'monitor'@'%';

-- Create Orchestrator user (needs SUPER for topology management)
-- Uses mysql_native_password for compatibility with Orchestrator
CREATE USER IF NOT EXISTS 'clawsql'@'%' IDENTIFIED WITH mysql_native_password BY 'clawsql_password';
GRANT ALL PRIVILEGES ON *.* TO 'clawsql'@'%' WITH GRANT OPTION;

-- Create demo database
CREATE DATABASE IF NOT EXISTS clawsql;

-- Create application user for demo database
CREATE USER IF NOT EXISTS 'app'@'%' IDENTIFIED WITH mysql_native_password BY 'apppassword';
GRANT ALL PRIVILEGES ON clawsql.* TO 'app'@'%';

FLUSH PRIVILEGES;
