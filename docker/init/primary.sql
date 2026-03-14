-- MySQL Primary Initialization Script
-- This script runs on the primary MySQL instance startup

-- Create replication user
CREATE USER IF NOT EXISTS 'repl'@'%' IDENTIFIED BY 'replpassword';
GRANT REPLICATION SLAVE ON *.* TO 'repl'@'%';

-- Create monitoring user for Orchestrator
CREATE USER IF NOT EXISTS 'orchestrator'@'%' IDENTIFIED BY 'orchestratorpassword';
GRANT SUPER, PROCESS, REPLICATION SLAVE, RELOAD ON *.* TO 'orchestrator'@'%';
GRANT SELECT ON mysql.slave_master_info TO 'orchestrator'@'%';

-- Create monitoring user for ClawSQL
CREATE USER IF NOT EXISTS 'clawsql_monitor'@'%' IDENTIFIED BY 'monitorpassword';
GRANT SELECT, PROCESS, REPLICATION CLIENT ON *.* TO 'clawsql_monitor'@'%';

-- Create application database
CREATE DATABASE IF NOT EXISTS clawsql;
CREATE DATABASE IF NOT EXISTS sbtest;

-- Create application user
CREATE USER IF NOT EXISTS 'app'@'%' IDENTIFIED BY 'apppassword';
GRANT ALL PRIVILEGES ON clawsql.* TO 'app'@'%';
GRANT ALL PRIVILEGES ON sbtest.* TO 'app'@'%';

FLUSH PRIVILEGES;