-- Primary initialization script
-- Create replication user
CREATE USER IF NOT EXISTS 'repl'@'%' IDENTIFIED BY 'replpassword';
GRANT REPLICATION SLAVE ON *.* TO 'repl'@'%';

-- Create monitoring user
CREATE USER IF NOT EXISTS 'monitor'@'%' IDENTIFIED BY 'monitorpassword';
GRANT REPLICATION CLIENT, PROCESS ON *.* TO 'monitor'@'%';
GRANT SELECT ON mysql.* TO 'monitor'@'%';

-- Create Orchestrator user (needs SUPER for topology management)
CREATE USER IF NOT EXISTS 'clawsql'@'%' IDENTIFIED BY 'clawsql_password';
GRANT ALL PRIVILEGES ON *.* TO 'clawsql'@'%' WITH GRANT OPTION;

-- Create application user for demo database
CREATE USER IF NOT EXISTS 'app'@'%' IDENTIFIED BY 'apppassword';
GRANT ALL PRIVILEGES ON clawsql.* TO 'app'@'%';

FLUSH PRIVILEGES;
