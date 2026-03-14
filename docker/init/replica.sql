-- MySQL Replica Initialization Script
-- This script runs on replica MySQL instances startup

-- Stop any existing replication
STOP SLAVE;

-- Configure replication to primary
CHANGE MASTER TO
    MASTER_HOST='mysql-primary',
    MASTER_PORT=3306,
    MASTER_USER='repl',
    MASTER_PASSWORD='replpassword',
    MASTER_AUTO_POSITION=1;

-- Start replication
START SLAVE;