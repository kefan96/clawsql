-- ClawSQL ProxySQL Initialization Script
-- Configures MySQL servers and users for the demo cluster

-- Add MySQL servers
-- Hostgroup 0 = writers (primary)
-- Hostgroup 1 = readers (replicas)
INSERT OR REPLACE INTO mysql_servers (hostname, port, hostgroup_id, status, weight) VALUES
    ('mysql-primary', 3306, 0, 'ONLINE', 1),
    ('mysql-replica-1', 3306, 1, 'ONLINE', 1),
    ('mysql-replica-2', 3306, 1, 'ONLINE', 1);

-- Add MySQL users for connections through ProxySQL
INSERT OR REPLACE INTO mysql_users (username, password, default_hostgroup, transaction_persistent) VALUES
    ('root', 'rootpassword', 0, 1),
    ('clawsql', 'clawsqlpassword', 0, 1);

-- Add query rules for read/write splitting
-- Route SELECT queries to readers (hostgroup 1)
INSERT OR REPLACE INTO mysql_query_rules (rule_id, active, match_pattern, destination_hostgroup, apply) VALUES
    (1, 1, '^SELECT', 1, 1);

-- Load configuration to runtime
LOAD MYSQL SERVERS TO RUNTIME;
LOAD MYSQL USERS TO RUNTIME;
LOAD MYSQL QUERY RULES TO RUNTIME;

-- Save configuration to disk
SAVE MYSQL SERVERS TO DISK;
SAVE MYSQL USERS TO DISK;
SAVE MYSQL QUERY RULES TO DISK;