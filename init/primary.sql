-- Primary initialization script
-- Create replication user
CREATE USER IF NOT EXISTS 'repl'@'%' IDENTIFIED BY 'replpassword';
GRANT REPLICATION SLAVE ON *.* TO 'repl'@'%';

-- Create monitoring user
CREATE USER IF NOT EXISTS 'monitor'@'%' IDENTIFIED BY 'monitorpassword';
GRANT REPLICATION CLIENT, PROCESS ON *.* TO 'monitor'@'%';
GRANT SELECT ON mysql.* TO 'monitor'@'%';

-- Create application user
CREATE USER IF NOT EXISTS 'clawsql'@'%' IDENTIFIED BY 'clawsqlpassword';
GRANT ALL PRIVILEGES ON clawsql.* TO 'clawsql'@'%';

FLUSH PRIVILEGES;
