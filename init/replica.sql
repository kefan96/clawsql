-- Replica initialization script
-- Create users for Orchestrator access
CREATE USER IF NOT EXISTS 'clawsql'@'%' IDENTIFIED WITH mysql_native_password BY 'clawsql_password';
GRANT ALL PRIVILEGES ON *.* TO 'clawsql'@'%' WITH GRANT OPTION;

-- Create monitoring user
CREATE USER IF NOT EXISTS 'monitor'@'%' IDENTIFIED WITH mysql_native_password BY 'monitorpassword';
GRANT REPLICATION CLIENT, PROCESS ON *.* TO 'monitor'@'%';

FLUSH PRIVILEGES;

-- Configure replication to primary
STOP SLAVE;

CHANGE REPLICATION SOURCE TO
    SOURCE_HOST='mysql-primary',
    SOURCE_PORT=3306,
    SOURCE_USER='repl',
    SOURCE_PASSWORD='repl_password',
    SOURCE_AUTO_POSITION=1,
    GET_SOURCE_PUBLIC_KEY=1;

START SLAVE;