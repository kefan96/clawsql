-- Orchestrator Complete Schema for MySQL 8.0
-- This file pre-creates all Orchestrator tables with the complete schema
-- (base tables + all patches merged) to avoid MySQL 8.0 compatibility issues
-- with the AFTER clause in ALTER TABLE statements.
--
-- Based on Orchestrator v3.2.x schema from:
-- - base.go: Base CREATE TABLE statements
-- - patches.go: ALTER TABLE patches (merged into CREATE TABLE)
--
-- Key changes for MySQL 8.0 compatibility:
-- 1. Removed AFTER clauses that cause circular dependencies
-- 2. Consolidated all columns in single CREATE TABLE statements
-- 3. Added all indexes at the end to avoid order issues

-- =============================================================================
-- database_instance - Main topology table (extensive patches merged)
-- =============================================================================
CREATE TABLE IF NOT EXISTS database_instance (
  hostname varchar(128) CHARACTER SET ascii NOT NULL,
  port smallint(5) unsigned NOT NULL,
  last_checked timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_attempted_check TIMESTAMP NOT NULL DEFAULT '1971-01-01 00:00:00',
  last_check_partial_success tinyint unsigned NOT NULL,
  last_seen timestamp NULL DEFAULT NULL,
  uptime INT UNSIGNED NOT NULL,
  server_id int(10) unsigned NOT NULL,
  server_uuid varchar(64) CHARACTER SET ascii NOT NULL,
  version varchar(128) CHARACTER SET ascii NOT NULL,
  version_comment varchar(128) NOT NULL DEFAULT '',
  major_version varchar(16) CHARACTER SET ascii NOT NULL,
  binlog_format varchar(16) CHARACTER SET ascii NOT NULL,
  binlog_row_image varchar(16) CHARACTER SET ascii NOT NULL,
  binlog_server TINYINT UNSIGNED NOT NULL,
  log_bin tinyint(3) unsigned NOT NULL,
  log_slave_updates tinyint(3) unsigned NOT NULL,
  binary_log_file varchar(128) CHARACTER SET ascii NOT NULL,
  binary_log_pos bigint(20) unsigned NOT NULL,
  master_host varchar(128) CHARACTER SET ascii NOT NULL,
  master_port smallint(5) unsigned NOT NULL,
  slave_sql_running tinyint(3) unsigned NOT NULL,
  slave_io_running tinyint(3) unsigned NOT NULL,
  has_replication_filters TINYINT UNSIGNED NOT NULL,
  replication_sql_thread_state tinyint signed not null default 0,
  replication_io_thread_state tinyint signed not null default 0,
  oracle_gtid TINYINT UNSIGNED NOT NULL,
  supports_oracle_gtid TINYINT UNSIGNED NOT NULL,
  executed_gtid_set text CHARACTER SET ascii NOT NULL,
  master_uuid varchar(64) CHARACTER SET ascii NOT NULL,
  ancestry_uuid text CHARACTER SET ascii NOT NULL,
  gtid_purged text CHARACTER SET ascii NOT NULL,
  gtid_errant text CHARACTER SET ascii NOT NULL,
  mariadb_gtid TINYINT UNSIGNED NOT NULL,
  pseudo_gtid TINYINT UNSIGNED NOT NULL,
  gtid_mode varchar(32) CHARACTER SET ascii NOT NULL,
  replication_group_name VARCHAR(64) CHARACTER SET ascii NOT NULL DEFAULT '',
  replication_group_is_single_primary_mode TINYINT UNSIGNED NOT NULL DEFAULT 1,
  replication_group_member_state VARCHAR(16) CHARACTER SET ascii NOT NULL DEFAULT '',
  replication_group_member_role VARCHAR(16) CHARACTER SET ascii NOT NULL DEFAULT '',
  replication_group_members text CHARACTER SET ascii NOT NULL,
  replication_group_primary_host varchar(128) CHARACTER SET ascii NOT NULL DEFAULT '',
  replication_group_primary_port smallint(5) unsigned NOT NULL DEFAULT 0,
  master_log_file varchar(128) CHARACTER SET ascii NOT NULL,
  read_master_log_pos bigint(20) unsigned NOT NULL,
  relay_master_log_file varchar(128) CHARACTER SET ascii NOT NULL,
  exec_master_log_pos bigint(20) unsigned NOT NULL,
  relay_log_file varchar(128) CHARACTER SET ascii NOT NULL,
  relay_log_pos bigint unsigned NOT NULL,
  last_sql_error TEXT NOT NULL,
  last_io_error TEXT NOT NULL,
  seconds_behind_master bigint(20) unsigned DEFAULT NULL,
  slave_lag_seconds bigint(20) unsigned DEFAULT NULL,
  sql_delay INT UNSIGNED NOT NULL,
  allow_tls TINYINT UNSIGNED NOT NULL,
  num_slave_hosts int(10) unsigned NOT NULL,
  slave_hosts text CHARACTER SET ascii NOT NULL,
  cluster_name varchar(128) CHARACTER SET ascii NOT NULL,
  suggested_cluster_alias varchar(128) CHARACTER SET ascii NOT NULL,
  data_center varchar(32) CHARACTER SET ascii NOT NULL,
  region varchar(32) CHARACTER SET ascii NOT NULL,
  physical_environment varchar(32) CHARACTER SET ascii NOT NULL,
  instance_alias varchar(128) CHARACTER SET ascii NOT NULL,
  semi_sync_enforced TINYINT UNSIGNED NOT NULL,
  semi_sync_available TINYINT UNSIGNED NOT NULL DEFAULT 0,
  semi_sync_master_enabled TINYINT UNSIGNED NOT NULL,
  semi_sync_master_timeout BIGINT UNSIGNED NOT NULL DEFAULT 0,
  semi_sync_master_wait_for_slave_count INT UNSIGNED NOT NULL DEFAULT 0,
  semi_sync_master_status TINYINT UNSIGNED NOT NULL DEFAULT 0,
  semi_sync_master_clients INT UNSIGNED NOT NULL DEFAULT 0,
  semi_sync_replica_enabled TINYINT UNSIGNED NOT NULL,
  semi_sync_replica_status TINYINT UNSIGNED NOT NULL DEFAULT 0,
  replication_depth TINYINT UNSIGNED NOT NULL,
  is_co_master TINYINT UNSIGNED NOT NULL,
  replication_credentials_available TINYINT UNSIGNED NOT NULL,
  has_replication_credentials TINYINT UNSIGNED NOT NULL,
  read_only TINYINT UNSIGNED NOT NULL,
  last_discovery_latency bigint not null,
  PRIMARY KEY (hostname,port)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

-- database_instance indexes
CREATE INDEX cluster_name_idx_database_instance ON database_instance(cluster_name);
CREATE INDEX last_checked_idx_database_instance ON database_instance(last_checked);
CREATE INDEX last_seen_idx_database_instance ON database_instance(last_seen);
CREATE INDEX master_host_port_idx_database_instance ON database_instance(master_host, master_port);
CREATE INDEX suggested_cluster_alias_idx_database_instance ON database_instance(suggested_cluster_alias);

-- =============================================================================
-- database_instance_maintenance
-- =============================================================================
CREATE TABLE IF NOT EXISTS database_instance_maintenance (
  database_instance_maintenance_id int(10) unsigned NOT NULL AUTO_INCREMENT,
  hostname varchar(128) NOT NULL,
  port smallint(5) unsigned NOT NULL,
  maintenance_active tinyint(4) DEFAULT NULL,
  begin_timestamp timestamp NULL DEFAULT NULL,
  end_timestamp timestamp NULL DEFAULT NULL,
  owner varchar(128) CHARACTER SET utf8 NOT NULL,
  reason text CHARACTER SET utf8 NOT NULL,
  processing_node_hostname varchar(128) CHARACTER SET ascii NOT NULL,
  processing_node_token varchar(128) NOT NULL,
  explicitly_bounded TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (database_instance_maintenance_id)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

-- database_instance_maintenance indexes
CREATE UNIQUE INDEX maintenance_uidx_database_instance_maintenance ON database_instance_maintenance (maintenance_active, hostname, port);
CREATE INDEX active_timestamp_idx_database_instance_maintenance ON database_instance_maintenance (maintenance_active, begin_timestamp);
CREATE INDEX active_end_timestamp_idx_database_instance_maintenance ON database_instance_maintenance (maintenance_active, end_timestamp);

-- =============================================================================
-- database_instance_long_running_queries
-- =============================================================================
CREATE TABLE IF NOT EXISTS database_instance_long_running_queries (
  hostname varchar(128) NOT NULL,
  port smallint(5) unsigned NOT NULL,
  process_id bigint(20) NOT NULL,
  process_started_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  process_user varchar(16) CHARACTER SET utf8 NOT NULL,
  process_host varchar(128) CHARACTER SET utf8 NOT NULL,
  process_db varchar(128) CHARACTER SET utf8 NOT NULL,
  process_command varchar(16) CHARACTER SET utf8 NOT NULL,
  process_time_seconds int(11) NOT NULL,
  process_state varchar(128) CHARACTER SET utf8 NOT NULL,
  process_info varchar(1024) CHARACTER SET utf8 NOT NULL,
  PRIMARY KEY (hostname,port,process_id)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

CREATE INDEX process_started_at_idx_database_instance_long_running_queries ON database_instance_long_running_queries (process_started_at);

-- =============================================================================
-- audit - with cluster_name patch
-- =============================================================================
CREATE TABLE IF NOT EXISTS audit (
  audit_id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  audit_timestamp timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  audit_type varchar(128) CHARACTER SET ascii NOT NULL,
  hostname varchar(128) CHARACTER SET ascii NOT NULL DEFAULT '',
  port smallint(5) unsigned NOT NULL,
  cluster_name varchar(128) CHARACTER SET ascii NOT NULL DEFAULT '',
  message text CHARACTER SET utf8 NOT NULL,
  PRIMARY KEY (audit_id)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- audit indexes
CREATE INDEX audit_timestamp_idx_audit ON audit (audit_timestamp);
CREATE INDEX host_port_idx_audit ON audit (hostname, port, audit_timestamp);

-- =============================================================================
-- host_agent
-- =============================================================================
CREATE TABLE IF NOT EXISTS host_agent (
  hostname varchar(128) NOT NULL,
  port smallint(5) unsigned NOT NULL,
  token varchar(128) NOT NULL,
  last_submitted timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_checked timestamp NULL DEFAULT NULL,
  last_seen timestamp NULL DEFAULT NULL,
  mysql_port smallint(5) unsigned DEFAULT NULL,
  count_mysql_snapshots smallint(5) unsigned NOT NULL,
  PRIMARY KEY (hostname)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

-- host_agent indexes
CREATE INDEX token_idx_host_agent ON host_agent (token);
CREATE INDEX last_submitted_idx_host_agent ON host_agent (last_submitted);
CREATE INDEX last_checked_idx_host_agent ON host_agent (last_checked);
CREATE INDEX last_seen_idx_host_agent ON host_agent (last_seen);

-- =============================================================================
-- agent_seed
-- =============================================================================
CREATE TABLE IF NOT EXISTS agent_seed (
  agent_seed_id int(10) unsigned NOT NULL AUTO_INCREMENT,
  target_hostname varchar(128) NOT NULL,
  source_hostname varchar(128) NOT NULL,
  start_timestamp timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  end_timestamp timestamp NOT NULL DEFAULT '1971-01-01 00:00:00',
  is_complete tinyint(3) unsigned NOT NULL DEFAULT '0',
  is_successful tinyint(3) unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (agent_seed_id)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

-- agent_seed indexes
CREATE INDEX target_hostname_idx_agent_seed ON agent_seed (target_hostname,is_complete);
CREATE INDEX source_hostname_idx_agent_seed ON agent_seed (source_hostname,is_complete);
CREATE INDEX start_timestamp_idx_agent_seed ON agent_seed (start_timestamp);
CREATE INDEX is_complete_idx_agent_seed ON agent_seed (is_complete,start_timestamp);
CREATE INDEX is_successful_idx_agent_seed ON agent_seed (is_successful, start_timestamp);

-- =============================================================================
-- agent_seed_state
-- =============================================================================
CREATE TABLE IF NOT EXISTS agent_seed_state (
  agent_seed_state_id int(10) unsigned NOT NULL AUTO_INCREMENT,
  agent_seed_id int(10) unsigned NOT NULL,
  state_timestamp timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  state_action varchar(127) NOT NULL,
  error_message varchar(255) NOT NULL,
  PRIMARY KEY (agent_seed_state_id)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

CREATE INDEX agent_seed_idx_agent_seed_state ON agent_seed_state (agent_seed_id, state_timestamp);

-- =============================================================================
-- host_attributes
-- =============================================================================
CREATE TABLE IF NOT EXISTS host_attributes (
  hostname varchar(128) NOT NULL,
  attribute_name varchar(128) NOT NULL,
  attribute_value varchar(128) NOT NULL,
  submit_timestamp timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expire_timestamp timestamp NULL DEFAULT NULL,
  PRIMARY KEY (hostname,attribute_name)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

-- host_attributes indexes
CREATE INDEX attribute_name_idx_host_attributes ON host_attributes (attribute_name);
CREATE INDEX attribute_value_idx_host_attributes ON host_attributes (attribute_value);
CREATE INDEX submit_timestamp_idx_host_attributes ON host_attributes (submit_timestamp);
CREATE INDEX expire_timestamp_idx_host_attributes ON host_attributes (expire_timestamp);

-- =============================================================================
-- hostname_resolve
-- =============================================================================
CREATE TABLE IF NOT EXISTS hostname_resolve (
  hostname varchar(128) NOT NULL,
  resolved_hostname varchar(128) NOT NULL,
  resolved_timestamp timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (hostname)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

CREATE INDEX resolved_timestamp_idx_hostname_resolve ON hostname_resolve (resolved_timestamp);

-- =============================================================================
-- cluster_alias - with last_registered patch
-- =============================================================================
CREATE TABLE IF NOT EXISTS cluster_alias (
  cluster_name varchar(128) CHARACTER SET ascii NOT NULL,
  alias varchar(128) NOT NULL,
  last_registered TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (cluster_name)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

-- cluster_alias indexes
CREATE UNIQUE INDEX alias_uidx_cluster_alias ON cluster_alias (alias);
CREATE INDEX last_registered_idx_cluster_alias ON cluster_alias (last_registered);

-- =============================================================================
-- active_node - with first_seen_active patch
-- =============================================================================
CREATE TABLE IF NOT EXISTS active_node (
  anchor tinyint unsigned NOT NULL,
  hostname varchar(128) CHARACTER SET ascii NOT NULL,
  token varchar(128) NOT NULL,
  last_seen_active timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  first_seen_active timestamp NOT NULL DEFAULT '1971-01-01 00:00:00',
  PRIMARY KEY (anchor)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

INSERT IGNORE INTO active_node (anchor, hostname, token, last_seen_active, first_seen_active)
  VALUES (1, '', '', NOW(), NOW());

-- =============================================================================
-- node_health - with all patches merged
-- =============================================================================
CREATE TABLE IF NOT EXISTS node_health (
  hostname varchar(128) CHARACTER SET ascii NOT NULL,
  token varchar(128) NOT NULL,
  last_seen_active timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  first_seen_active timestamp NOT NULL DEFAULT '1971-01-01 00:00:00',
  extra_info varchar(128) CHARACTER SET utf8 NOT NULL,
  command varchar(128) CHARACTER SET utf8 NOT NULL,
  app_version varchar(64) CHARACTER SET ascii NOT NULL DEFAULT '',
  db_backend varchar(255) CHARACTER SET ascii NOT NULL DEFAULT '',
  incrementing_indicator bigint not null default 0,
  PRIMARY KEY (hostname, token)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

-- node_health indexes
CREATE INDEX last_seen_active_idx_node_health ON node_health (last_seen_active);

-- =============================================================================
-- topology_recovery - with all patches merged
-- =============================================================================
CREATE TABLE IF NOT EXISTS topology_recovery (
  recovery_id bigint unsigned not null auto_increment,
  hostname varchar(128) NOT NULL,
  port smallint unsigned NOT NULL,
  in_active_period tinyint unsigned NOT NULL DEFAULT 0,
  start_active_period timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  end_active_period_unixtime int unsigned,
  end_recovery timestamp NULL DEFAULT NULL,
  processing_node_hostname varchar(128) CHARACTER SET ascii NOT NULL,
  processcing_node_token varchar(128) NOT NULL,
  successor_hostname varchar(128) DEFAULT NULL,
  successor_port smallint unsigned DEFAULT NULL,
  successor_alias varchar(128) DEFAULT NULL,
  is_successful TINYINT UNSIGNED NOT NULL DEFAULT 0,
  analysis varchar(128) CHARACTER SET ascii NOT NULL,
  cluster_name varchar(128) CHARACTER SET ascii NOT NULL,
  cluster_alias varchar(128) CHARACTER SET ascii NOT NULL,
  count_affected_slaves int unsigned NOT NULL,
  slave_hosts text CHARACTER SET ascii NOT NULL,
  participating_instances text CHARACTER SET ascii NOT NULL,
  lost_slaves text CHARACTER SET ascii NOT NULL,
  all_errors text CHARACTER SET ascii NOT NULL,
  acknowledged TINYINT UNSIGNED NOT NULL DEFAULT 0,
  acknowledged_at TIMESTAMP NULL,
  acknowledged_by varchar(128) CHARACTER SET utf8 NOT NULL,
  acknowledge_comment text CHARACTER SET utf8 NOT NULL,
  last_detection_id bigint unsigned NOT NULL,
  uid varchar(128) CHARACTER SET ascii NOT NULL,
  PRIMARY KEY (recovery_id)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

-- topology_recovery indexes
CREATE INDEX in_active_start_period_idx_topology_recovery ON topology_recovery (in_active_period, start_active_period);
CREATE INDEX start_active_period_idx_topology_recovery ON topology_recovery (start_active_period);
CREATE UNIQUE INDEX hostname_port_active_period_uidx_topology_recovery ON topology_recovery (hostname, port, in_active_period, end_active_period_unixtime);
CREATE INDEX cluster_name_in_active_idx_topology_recovery ON topology_recovery (cluster_name, in_active_period);
CREATE INDEX end_recovery_idx_topology_recovery ON topology_recovery (end_recovery);
CREATE INDEX acknowledged_idx_topology_recovery ON topology_recovery (acknowledged, acknowledged_at);
CREATE INDEX last_detection_idx_topology_recovery ON topology_recovery (last_detection_id);
CREATE INDEX uid_idx_topology_recovery ON topology_recovery(uid);

-- =============================================================================
-- hostname_unresolve - with last_registered patch
-- =============================================================================
CREATE TABLE IF NOT EXISTS hostname_unresolve (
  hostname varchar(128) NOT NULL,
  unresolved_hostname varchar(128) NOT NULL,
  last_registered TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (hostname)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

-- hostname_unresolve indexes
CREATE INDEX unresolved_hostname_idx_hostname_unresolve ON hostname_unresolve (unresolved_hostname);
CREATE INDEX last_registered_idx_hostname_unresolve ON hostname_unresolve (last_registered);

-- =============================================================================
-- database_instance_pool - with registered_at patch
-- =============================================================================
CREATE TABLE IF NOT EXISTS database_instance_pool (
  hostname varchar(128) CHARACTER SET ascii NOT NULL,
  port smallint(5) unsigned NOT NULL,
  pool varchar(128) NOT NULL,
  registered_at timestamp NOT NULL DEFAULT '1971-01-01 00:00:00',
  PRIMARY KEY (hostname, port, pool)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

CREATE INDEX pool_idx_database_instance_pool ON database_instance_pool (pool);

-- =============================================================================
-- database_instance_topology_history - with version patch
-- =============================================================================
CREATE TABLE IF NOT EXISTS database_instance_topology_history (
  snapshot_unix_timestamp INT UNSIGNED NOT NULL,
  hostname varchar(128) CHARACTER SET ascii NOT NULL,
  port smallint(5) unsigned NOT NULL,
  master_host varchar(128) CHARACTER SET ascii NOT NULL,
  master_port smallint(5) unsigned NOT NULL,
  cluster_name tinytext CHARACTER SET ascii NOT NULL,
  version varchar(128) CHARACTER SET ascii NOT NULL,
  PRIMARY KEY (snapshot_unix_timestamp, hostname, port)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

CREATE INDEX cluster_name_idx_database_instance_topology_history ON database_instance_topology_history (snapshot_unix_timestamp, cluster_name(128));

-- =============================================================================
-- candidate_database_instance - with priority and promotion_rule patches
-- =============================================================================
CREATE TABLE IF NOT EXISTS candidate_database_instance (
  hostname varchar(128) CHARACTER SET ascii NOT NULL,
  port smallint(5) unsigned NOT NULL,
  last_suggested TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  priority TINYINT SIGNED NOT NULL DEFAULT 1 COMMENT 'positive promote, negative unpromotes',
  promotion_rule enum('must', 'prefer', 'neutral', 'prefer_not', 'must_not') NOT NULL DEFAULT 'neutral',
  PRIMARY KEY (hostname, port)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

CREATE INDEX last_suggested_idx_candidate_database_instance ON candidate_database_instance (last_suggested);

-- =============================================================================
-- database_instance_downtime
-- =============================================================================
CREATE TABLE IF NOT EXISTS database_instance_downtime (
  hostname varchar(128) NOT NULL,
  port smallint(5) unsigned NOT NULL,
  downtime_active tinyint(4) DEFAULT NULL,
  begin_timestamp timestamp DEFAULT CURRENT_TIMESTAMP,
  end_timestamp timestamp NULL DEFAULT NULL,
  owner varchar(128) CHARACTER SET utf8 NOT NULL,
  reason text CHARACTER SET utf8 NOT NULL,
  PRIMARY KEY (hostname, port)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

CREATE INDEX end_timestamp_idx_database_instance_downtime ON database_instance_downtime(end_timestamp);

-- =============================================================================
-- topology_failure_detection - with is_actionable patch
-- =============================================================================
CREATE TABLE IF NOT EXISTS topology_failure_detection (
  detection_id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  hostname varchar(128) NOT NULL,
  port smallint unsigned NOT NULL,
  in_active_period tinyint unsigned NOT NULL DEFAULT '0',
  start_active_period timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  end_active_period_unixtime int unsigned NOT NULL,
  processing_node_hostname varchar(128) NOT NULL,
  processcing_node_token varchar(128) NOT NULL,
  analysis varchar(128) NOT NULL,
  cluster_name varchar(128) NOT NULL,
  cluster_alias varchar(128) NOT NULL,
  count_affected_slaves int unsigned NOT NULL,
  slave_hosts text NOT NULL,
  is_actionable tinyint not null default 0,
  PRIMARY KEY (detection_id)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

-- topology_failure_detection indexes
CREATE INDEX in_active_start_period_idx_topology_failure_detection ON topology_failure_detection (in_active_period, start_active_period);
CREATE UNIQUE INDEX host_port_active_recoverable_uidx_topology_failure_detection ON topology_failure_detection (hostname, port, in_active_period, end_active_period_unixtime, is_actionable);

-- =============================================================================
-- hostname_resolve_history
-- =============================================================================
CREATE TABLE IF NOT EXISTS hostname_resolve_history (
  resolved_hostname varchar(128) NOT NULL,
  hostname varchar(128) NOT NULL,
  resolved_timestamp timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (resolved_hostname)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

-- hostname_resolve_history indexes
CREATE INDEX hostname_idx_hostname_resolve_history ON hostname_resolve_history (hostname);
CREATE INDEX resolved_timestamp_idx_hostname_resolve_history ON hostname_resolve_history (resolved_timestamp);

-- =============================================================================
-- hostname_unresolve_history
-- =============================================================================
CREATE TABLE IF NOT EXISTS hostname_unresolve_history (
  unresolved_hostname varchar(128) NOT NULL,
  hostname varchar(128) NOT NULL,
  last_registered TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (unresolved_hostname)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

-- hostname_unresolve_history indexes
CREATE INDEX hostname_idx_hostname_unresolve_history ON hostname_unresolve_history (hostname);
CREATE INDEX last_registered_idx_hostname_unresolve_history ON hostname_unresolve_history (last_registered);

-- =============================================================================
-- cluster_domain_name - with last_registered patch
-- =============================================================================
CREATE TABLE IF NOT EXISTS cluster_domain_name (
  cluster_name varchar(128) CHARACTER SET ascii NOT NULL,
  domain_name varchar(128) NOT NULL,
  last_registered TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (cluster_name)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

-- cluster_domain_name indexes
CREATE INDEX domain_name_idx_cluster_domain_name ON cluster_domain_name (domain_name(32));
CREATE INDEX last_registered_idx_cluster_domain_name ON cluster_domain_name (last_registered);

-- =============================================================================
-- master_position_equivalence
-- =============================================================================
CREATE TABLE IF NOT EXISTS master_position_equivalence (
  equivalence_id bigint unsigned not null auto_increment,
  master1_hostname varchar(128) CHARACTER SET ascii NOT NULL,
  master1_port smallint(5) unsigned NOT NULL,
  master1_binary_log_file varchar(128) CHARACTER SET ascii NOT NULL,
  master1_binary_log_pos bigint(20) unsigned NOT NULL,
  master2_hostname varchar(128) CHARACTER SET ascii NOT NULL,
  master2_port smallint(5) unsigned NOT NULL,
  master2_binary_log_file varchar(128) CHARACTER SET ascii NOT NULL,
  master2_binary_log_pos bigint(20) unsigned NOT NULL,
  last_suggested TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (equivalence_id)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

-- master_position_equivalence indexes
CREATE UNIQUE INDEX equivalence_uidx_master_position_equivalence ON master_position_equivalence (master1_hostname, master1_port, master1_binary_log_file, master1_binary_log_pos, master2_hostname, master2_port);
CREATE INDEX master2_idx_master_position_equivalence ON master_position_equivalence (master2_hostname, master2_port, master2_binary_log_file, master2_binary_log_pos);
CREATE INDEX last_suggested_idx_master_position_equivalence ON master_position_equivalence (last_suggested);

-- =============================================================================
-- async_request
-- =============================================================================
CREATE TABLE IF NOT EXISTS async_request (
  request_id bigint unsigned NOT NULL AUTO_INCREMENT,
  command varchar(128) charset ascii not null,
  hostname varchar(128) NOT NULL,
  port smallint(5) unsigned NOT NULL,
  destination_hostname varchar(128) NOT NULL,
  destination_port smallint(5) unsigned NOT NULL,
  pattern text CHARACTER SET utf8 NOT NULL,
  gtid_hint varchar(32) charset ascii not null,
  begin_timestamp timestamp NULL DEFAULT NULL,
  end_timestamp timestamp NULL DEFAULT NULL,
  story text CHARACTER SET utf8 NOT NULL,
  PRIMARY KEY (request_id)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

-- async_request indexes
CREATE INDEX begin_timestamp_idx_async_request ON async_request (begin_timestamp);
CREATE INDEX end_timestamp_idx_async_request ON async_request (end_timestamp);

-- =============================================================================
-- blocked_topology_recovery
-- =============================================================================
CREATE TABLE IF NOT EXISTS blocked_topology_recovery (
  hostname varchar(128) NOT NULL,
  port smallint(5) unsigned NOT NULL,
  cluster_name varchar(128) NOT NULL,
  analysis varchar(128) NOT NULL,
  last_blocked_timestamp timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  blocking_recovery_id bigint unsigned,
  PRIMARY KEY (hostname, port)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

-- blocked_topology_recovery indexes
CREATE INDEX cluster_blocked_idx_blocked_topology_recovery ON blocked_topology_recovery (cluster_name, last_blocked_timestamp);
CREATE INDEX last_blocked_idx_blocked_topology_recovery ON blocked_topology_recovery (last_blocked_timestamp);

-- =============================================================================
-- database_instance_last_analysis
-- =============================================================================
CREATE TABLE IF NOT EXISTS database_instance_last_analysis (
  hostname varchar(128) NOT NULL,
  port smallint(5) unsigned NOT NULL,
  analysis_timestamp timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  analysis varchar(128) NOT NULL,
  PRIMARY KEY (hostname, port)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

CREATE INDEX analysis_timestamp_idx_database_instance_last_analysis ON database_instance_last_analysis (analysis_timestamp);

-- =============================================================================
-- database_instance_analysis_changelog
-- =============================================================================
CREATE TABLE IF NOT EXISTS database_instance_analysis_changelog (
  changelog_id bigint unsigned not null auto_increment,
  hostname varchar(128) NOT NULL,
  port smallint(5) unsigned NOT NULL,
  analysis_timestamp timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  analysis varchar(128) NOT NULL,
  PRIMARY KEY (changelog_id)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

-- database_instance_analysis_changelog indexes
CREATE INDEX analysis_timestamp_idx_database_instance_analysis_changelog ON database_instance_analysis_changelog (analysis_timestamp);
CREATE INDEX instance_timestamp_idx_database_instance_analysis_changelog ON database_instance_analysis_changelog (hostname, port, analysis_timestamp);

-- =============================================================================
-- node_health_history - with command and app_version patches
-- =============================================================================
CREATE TABLE IF NOT EXISTS node_health_history (
  history_id bigint unsigned not null auto_increment,
  hostname varchar(128) CHARACTER SET ascii NOT NULL,
  token varchar(128) NOT NULL,
  first_seen_active timestamp NOT NULL,
  extra_info varchar(128) CHARACTER SET utf8 NOT NULL,
  command varchar(128) CHARACTER SET utf8 NOT NULL,
  app_version varchar(64) CHARACTER SET ascii NOT NULL DEFAULT '',
  PRIMARY KEY (history_id)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

-- node_health_history indexes
CREATE INDEX first_seen_active_idx_node_health_history ON node_health_history (first_seen_active);
CREATE UNIQUE INDEX hostname_token_idx_node_health_history ON node_health_history (hostname, token);

-- =============================================================================
-- database_instance_coordinates_history - with last_seen patch
-- =============================================================================
CREATE TABLE IF NOT EXISTS database_instance_coordinates_history (
  history_id bigint unsigned not null auto_increment,
  hostname varchar(128) NOT NULL,
  port smallint(5) unsigned NOT NULL,
  recorded_timestamp timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen timestamp NOT NULL DEFAULT '1971-01-01 00:00:00',
  binary_log_file varchar(128) NOT NULL,
  binary_log_pos bigint(20) unsigned NOT NULL,
  relay_log_file varchar(128) NOT NULL,
  relay_log_pos bigint(20) unsigned NOT NULL,
  PRIMARY KEY (history_id)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

-- database_instance_coordinates_history indexes
CREATE INDEX hostname_port_recorded_idx_database_instance_coordinates_history ON database_instance_coordinates_history (hostname, port, recorded_timestamp);
CREATE INDEX recorded_timestmp_idx_database_instance_coordinates_history ON database_instance_coordinates_history (recorded_timestamp);

-- =============================================================================
-- database_instance_binlog_files_history
-- =============================================================================
CREATE TABLE IF NOT EXISTS database_instance_binlog_files_history (
  history_id bigint unsigned not null auto_increment,
  hostname varchar(128) NOT NULL,
  port smallint(5) unsigned NOT NULL,
  binary_log_file varchar(128) NOT NULL,
  binary_log_pos bigint(20) unsigned NOT NULL,
  first_seen timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen timestamp NOT NULL DEFAULT '1971-01-01 00:00:00',
  PRIMARY KEY (history_id)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

-- database_instance_binlog_files_history indexes
CREATE UNIQUE INDEX hostname_port_file_idx_database_instance_binlog_files_history ON database_instance_binlog_files_history (hostname, port, binary_log_file);
CREATE INDEX last_seen_idx_database_instance_binlog_files_history ON database_instance_binlog_files_history (last_seen);

-- =============================================================================
-- access_token - with is_reentrant and acquired_at patches
-- =============================================================================
CREATE TABLE IF NOT EXISTS access_token (
  access_token_id bigint unsigned not null auto_increment,
  public_token varchar(128) NOT NULL,
  secret_token varchar(128) NOT NULL,
  generated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  generated_by varchar(128) CHARACTER SET utf8 NOT NULL,
  is_acquired tinyint unsigned NOT NULL DEFAULT '0',
  is_reentrant TINYINT UNSIGNED NOT NULL DEFAULT 0,
  acquired_at timestamp NOT NULL DEFAULT '1971-01-01 00:00:00',
  PRIMARY KEY (access_token_id)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

-- access_token indexes
CREATE UNIQUE INDEX public_token_uidx_access_token ON access_token (public_token);
CREATE INDEX generated_at_idx_access_token ON access_token (generated_at);

-- =============================================================================
-- database_instance_recent_relaylog_history
-- =============================================================================
CREATE TABLE IF NOT EXISTS database_instance_recent_relaylog_history (
  hostname varchar(128) NOT NULL,
  port smallint(5) unsigned NOT NULL,
  current_relay_log_file varchar(128) NOT NULL,
  current_relay_log_pos bigint(20) unsigned NOT NULL,
  current_seen timestamp NOT NULL DEFAULT '1971-01-01 00:00:00',
  prev_relay_log_file varchar(128) NOT NULL,
  prev_relay_log_pos bigint(20) unsigned NOT NULL,
  prev_seen timestamp NOT NULL DEFAULT '1971-01-01 00:00:00',
  PRIMARY KEY (hostname, port)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

CREATE INDEX current_seen_idx_database_instance_recent_relaylog_history ON database_instance_recent_relaylog_history (current_seen);

-- =============================================================================
-- orchestrator_metadata
-- =============================================================================
CREATE TABLE IF NOT EXISTS orchestrator_metadata (
  anchor tinyint unsigned NOT NULL,
  last_deployed_version varchar(128) CHARACTER SET ascii NOT NULL,
  last_deployed_timestamp timestamp NOT NULL,
  PRIMARY KEY (anchor)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

-- =============================================================================
-- orchestrator_db_deployments
-- =============================================================================
CREATE TABLE IF NOT EXISTS orchestrator_db_deployments (
  deployed_version varchar(128) CHARACTER SET ascii NOT NULL,
  deployed_timestamp timestamp NOT NULL,
  PRIMARY KEY (deployed_version)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

-- =============================================================================
-- global_recovery_disable
-- =============================================================================
CREATE TABLE IF NOT EXISTS global_recovery_disable (
  disable_recovery tinyint unsigned NOT NULL COMMENT 'Insert 1 to disable recovery globally',
  PRIMARY KEY (disable_recovery)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

-- =============================================================================
-- cluster_alias_override
-- =============================================================================
CREATE TABLE IF NOT EXISTS cluster_alias_override (
  cluster_name varchar(128) CHARACTER SET ascii NOT NULL,
  alias varchar(128) NOT NULL,
  PRIMARY KEY (cluster_name)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

-- =============================================================================
-- topology_recovery_steps
-- =============================================================================
CREATE TABLE IF NOT EXISTS topology_recovery_steps (
  recovery_step_id bigint unsigned not null auto_increment,
  recovery_uid varchar(128) CHARACTER SET ascii NOT NULL,
  audit_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  message text CHARACTER SET utf8 NOT NULL,
  PRIMARY KEY (recovery_step_id)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

CREATE INDEX recovery_uid_idx_topology_recovery_steps ON topology_recovery_steps(recovery_uid);

-- =============================================================================
-- raft_store
-- =============================================================================
CREATE TABLE IF NOT EXISTS raft_store (
  store_id bigint unsigned not null auto_increment,
  store_key varbinary(512) not null,
  store_value blob not null,
  PRIMARY KEY (store_id)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

CREATE INDEX store_key_idx_raft_store ON raft_store (store_key);

-- =============================================================================
-- raft_log
-- =============================================================================
CREATE TABLE IF NOT EXISTS raft_log (
  log_index bigint unsigned not null auto_increment,
  term bigint not null,
  log_type int not null,
  data blob not null,
  PRIMARY KEY (log_index)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

-- =============================================================================
-- raft_snapshot - with created_at patch
-- =============================================================================
CREATE TABLE IF NOT EXISTS raft_snapshot (
  snapshot_id bigint unsigned not null auto_increment,
  snapshot_name varchar(128) CHARACTER SET utf8 NOT NULL,
  snapshot_meta varchar(4096) CHARACTER SET utf8 NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (snapshot_id)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

CREATE UNIQUE INDEX snapshot_name_uidx_raft_snapshot ON raft_snapshot (snapshot_name);

-- =============================================================================
-- database_instance_peer_analysis
-- =============================================================================
CREATE TABLE IF NOT EXISTS database_instance_peer_analysis (
  peer varchar(128) NOT NULL,
  hostname varchar(128) NOT NULL,
  port smallint(5) unsigned NOT NULL,
  analysis_timestamp timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  analysis varchar(128) NOT NULL,
  PRIMARY KEY (peer, hostname, port)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

-- =============================================================================
-- database_instance_tls
-- =============================================================================
CREATE TABLE IF NOT EXISTS database_instance_tls (
  hostname varchar(128) CHARACTER SET ascii NOT NULL,
  port smallint(5) unsigned NOT NULL,
  required tinyint unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY (hostname,port)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

-- =============================================================================
-- kv_store
-- =============================================================================
CREATE TABLE IF NOT EXISTS kv_store (
  store_key varchar(255) CHARACTER SET ascii NOT NULL,
  store_value text CHARACTER SET utf8 not null,
  last_updated timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (store_key)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

-- =============================================================================
-- cluster_injected_pseudo_gtid
-- =============================================================================
CREATE TABLE IF NOT EXISTS cluster_injected_pseudo_gtid (
  cluster_name varchar(128) NOT NULL,
  time_injected timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (cluster_name)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

-- =============================================================================
-- hostname_ips
-- =============================================================================
CREATE TABLE IF NOT EXISTS hostname_ips (
  hostname varchar(128) CHARACTER SET ascii NOT NULL,
  ipv4 varchar(128) CHARACTER SET ascii NOT NULL,
  ipv6 varchar(128) CHARACTER SET ascii NOT NULL,
  last_updated timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (hostname)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

-- =============================================================================
-- database_instance_tags
-- =============================================================================
CREATE TABLE IF NOT EXISTS database_instance_tags (
  hostname varchar(128) CHARACTER SET ascii NOT NULL,
  port smallint(5) unsigned NOT NULL,
  tag_name varchar(128) CHARACTER SET utf8 NOT NULL,
  tag_value varchar(128) CHARACTER SET utf8 NOT NULL,
  last_updated timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (hostname, port, tag_name)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

CREATE INDEX tag_name_idx_database_instance_tags ON database_instance_tags (tag_name);

-- =============================================================================
-- database_instance_stale_binlog_coordinates
-- =============================================================================
CREATE TABLE IF NOT EXISTS database_instance_stale_binlog_coordinates (
  hostname varchar(128) CHARACTER SET ascii NOT NULL,
  port smallint(5) unsigned NOT NULL,
  binary_log_file varchar(128) NOT NULL,
  binary_log_pos bigint(20) unsigned NOT NULL,
  first_seen timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (hostname, port)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

CREATE INDEX first_seen_idx_database_instance_stale_binlog_coordinates ON database_instance_stale_binlog_coordinates (first_seen);

-- =============================================================================
-- Mark schema as deployed (prevent Orchestrator from running broken patches)
-- =============================================================================
INSERT IGNORE INTO orchestrator_db_deployments (deployed_version, deployed_timestamp)
  VALUES ('3.2.0', NOW());