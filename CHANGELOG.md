# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.2.2]: https://github.com/clawsql/clawsql/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/clawsql/clawsql/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/clawsql/clawsql/compare/v0.1.9...v0.2.0
[0.1.9]: https://github.com/clawsql/clawsql/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/clawsql/clawsql/releases/tag/v0.1.8