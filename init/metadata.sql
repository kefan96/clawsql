-- Metadata MySQL initialization script
-- Recreate clawsql user with mysql_native_password for Orchestrator compatibility

-- Drop the user created by MYSQL_USER env var (which uses caching_sha2_password)
DROP USER IF EXISTS 'clawsql'@'%';

-- Recreate with mysql_native_password
CREATE USER 'clawsql'@'%' IDENTIFIED WITH mysql_native_password BY 'clawsql_password';
GRANT ALL PRIVILEGES ON *.* TO 'clawsql'@'%' WITH GRANT OPTION;

FLUSH PRIVILEGES;
