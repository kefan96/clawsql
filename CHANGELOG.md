# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.6] - 2026-03-31

### Added
- **Predefined Templates**: 7 benchmarking templates for common MySQL cluster scenarios
  - `dev-single`, `dev-replica`, `standard`, `ha-semisync`, `read-heavy`, `production-ha`, `geo-distributed`
  - Templates auto-initialize on platform startup
- **Quick Provisioning**: `/clusters quick <template> <cluster> <hosts>` for fast cluster creation
- **Interactive Provisioning**: `/clusters provision` without args shows template selection
- **`predefinedTemplatesTable()` formatter method** for consistent template display

### Changed
- **Provisioning-First Approach**: Template-based provisioning is now the primary cluster creation method
  - `/clusters provision` and `/clusters quick` are the recommended commands
  - Manual operations moved under `/clusters manual create|import|sync|promote|add-replica|remove-replica`
  - Legacy commands show deprecation warnings but still work
- **Efficiency**: Batched database queries in `initializePredefinedTemplates()` 
- **Efficiency**: Added `initialized` flag to skip redundant template initialization
- **Efficiency**: Optimized `getOrCreate()` to create only the needed template
- Updated documentation (CLAUDE.md, README.md, GET_STARTED.md, DEMO.md) for new command structure

### Fixed
- Code reuse: Consolidated duplicate template table logic into shared formatter method

## [0.2.5] - 2026-03-31

### Added
- **Template-Based Cluster Provisioning**: Define topology templates for standardized cluster deployment
  - `/templates list|create|show|delete` commands for template management
  - Templates define primary/replica count, replication mode, and settings
- **Per-Cluster ProxySQL Ports**: Each cluster gets its own dedicated port for traffic isolation
  - Automatic port allocation from configurable range (default: 6033-6050)
  - Dynamic port configuration in ProxySQL at runtime
- **Per-Cluster Hostgroup Blocks**: Automatic hostgroup allocation (writer=N, reader=N+10)
  - Clear isolation between clusters
  - Configurable hostgroup range (default: 10-200)
- **Cluster Provisioning CLI**:
  - `/clusters provision --template <name> --cluster <name> --hosts <h:p,...>` - Provision from template
  - `/clusters deprovision <cluster> --force` - Remove provisioned cluster
- **Automatic Replication Setup**: GTID-based replication configuration during provisioning
- **Shared CLI Utilities**: New `src/cli/utils/args.ts` with common argument parsing functions

### Changed
- Refactored host:port parsing to use shared `parseHostPort()` utility
- Added SQL escaping for replication credentials using `mysql.escape()`
- Named constants for orchestrator and replication delays

### Fixed
- SQL injection vulnerability in replication setup (credentials now properly escaped)
- JSON parse error handling in template manager

## [0.2.4] - 2026-03-31

### Changed
- **Node.js Requirement**: Minimum version increased to v22.22.0 (required by OpenClaw CLI)
- **ProxySQL Sync**: Changed from delete-all-then-insert to upsert logic - syncing one cluster no longer removes servers from other clusters sharing the same hostgroups

### Fixed
- **OpenClaw Detection**: Added "unknown gateway" status when gateway is healthy but source cannot be determined (no CLI installed, no Docker container). Shows clear guidance to resolve.
- **metadata-mysql Cluster**: Automatically filtered from topology views - Orchestrator's backend database no longer appears as a user cluster
- **Cluster Sync**: Fixed issue where not all replicas were synced to ProxySQL after topology changes

### Added
- `INTERNAL_CLUSTER_PREFIXES` and `INTERNAL_CLUSTER_NAMES` constants for filtering internal clusters
- `printUnknownGatewayGuidance()` helper for consistent unknown gateway messaging

## [0.2.3] - 2026-03-31

### Fixed
- **OpenClaw Gateway Readiness**: Increased timeout from 30s to 120s with clearer progress messaging during startup
- **Natural Language AI**: Fixed "clawsql binary not found" error by using HTTP API instead of CLI binary in OpenClaw context
- **Platform Status Commands**: `/status` and `/doctor` now show only platform-level info (use `/topology` or `/clusters` for MySQL details)

### Changed
- `/doctor` AI test now uses fast HTTP health check instead of slow AI ping query (~100ms vs 22s)
- `isOpenClawAvailable()` optimized to check gateway health via HTTP first (faster detection)
- Removed MySQL container/cluster details from `/status` output
- Removed MySQL instance checks from `/doctor` output
- `OPENCLAW_CONTEXT` now uses correct API endpoints at `/api/v1/...`

## [0.2.2] - 2026-03-30

### Fixed
- **Orchestrator MySQL 8.0 Compatibility**: Added complete schema SQL (`docker/orchestrator/orchestrator-schema.sql`) that pre-creates all Orchestrator tables with patches merged. This fixes MySQL 8.0 compatibility issues where the `AFTER` clause in `ALTER TABLE` statements caused circular dependency errors.
- **Orchestrator Config Mount Path**: Fixed mount path from `/etc/orchestrator.conf.json` to `/etc/orchestrator/orchestrator.conf.json` for Percona orchestrator image.
- **Unit Tests**: Fixed `start.test.ts` timeouts using fake timers and proper mocks. Fixed `openclaw-integration.test.ts` assertions to match actual implementation.

### Added
- `docker/orchestrator/orchestrator-schema.sql`: Complete Orchestrator schema for MySQL 8.0
- `src/cli/utils/ai-config.ts`: Utility for AI provider detection from environment
- `src/cli/commands/openclaw.ts`: OpenClaw management command module
- `docker/openclaw/entrypoint.sh`: OpenClaw container entrypoint script

### Changed
- Orchestrator now uses MySQL backend instead of SQLite for metadata storage
- Improved error messages in OpenClaw integration to match actual implementation

## [0.2.1] - 2026-03-28

### Added
- Split `/install` command to separate image pulling from platform start
- `/install` command now handles Docker image pulling before first run
- `/start` command no longer pulls images (use `/install` first)
- `--detail` flag on `/install` for verbose output

### Changed
- Improved `/status` command with better image and container reporting
- Enhanced `/doctor` diagnostics for image and configuration checks

## [0.2.0] - 2026-03-27

### Added
- **OpenClaw Integration**: AI-powered database operations via OpenClaw gateway
  - Natural language interaction for cluster management
  - Control UI at http://localhost:18790
  - Gateway WebSocket at ws://localhost:18789
  - `/openclaw status`, `/openclaw test` commands
- Centralized version management from `package.json`
- AI provider auto-detection from environment variables

### Changed
- Architecture now includes OpenClaw AI gateway component
- Enhanced REPL with AI integration capabilities

## [0.1.9] - 2026-03-25

### Fixed
- ProxySQL configuration issues
- Instance discovery reliability improvements

### Added
- `/instances setup-replication` command for automatic replication setup
- Support for GTID-based replication

## [0.1.8] - 2026-03-20

### Added
- Initial public release
- Core platform with Orchestrator, ProxySQL, Prometheus, Grafana
- MySQL cluster discovery and topology management
- Automatic failover support
- Read/write splitting via ProxySQL
- Interactive CLI with REPL interface
- REST API with OpenAPI documentation

[0.2.6]: https://github.com/clawsql/clawsql/compare/v0.2.5...v0.2.6
[0.2.5]: https://github.com/clawsql/clawsql/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/clawsql/clawsql/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/clawsql/clawsql/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/clawsql/clawsql/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/clawsql/clawsql/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/clawsql/clawsql/compare/v0.1.9...v0.2.0
[0.1.9]: https://github.com/clawsql/clawsql/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/clawsql/clawsql/releases/tag/v0.1.8