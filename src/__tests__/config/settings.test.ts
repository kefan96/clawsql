/**
 * Tests for ClawSQL configuration settings
 */

// Store original env
const originalEnv = { ...process.env };

// Mock dotenv to prevent loading .env
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

import { getSettings, resetSettings } from '../../config/settings';

describe('Settings', () => {
  beforeEach(() => {
    // Clear all env vars that affect settings
    delete process.env.API_PORT;
    delete process.env.METADATA_DB_HOST;
    delete process.env.AUTO_FAILOVER_ENABLED;
    delete process.env.PROXYSQL_ADMIN_USER;
    delete process.env.PROXYSQL_ADMIN_PASSWORD;
    delete process.env.API_TOKEN_SECRET;
    delete process.env.MYSQL_MONITOR_PASSWORD;

    // Reset settings cache before each test
    resetSettings();
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
    resetSettings();
  });

  describe('getSettings', () => {
    it('should return default settings when no env vars set', () => {
      const settings = getSettings();

      expect(settings.appName).toBe('ClawSQL');
      expect(settings.appVersion).toBe('0.1.3');
      expect(settings.debug).toBe(false);
    });

    it('should return cached settings on subsequent calls', () => {
      const settings1 = getSettings();
      const settings2 = getSettings();

      expect(settings1).toBe(settings2);
    });

    it('should load new settings after reset', () => {
      const settings1 = getSettings();
      resetSettings();
      const settings2 = getSettings();

      // Different object references but same values
      expect(settings1).not.toBe(settings2);
      expect(settings1.appName).toBe(settings2.appName);
    });
  });

  describe('MetadataDbSettings', () => {
    it('should have correct defaults', () => {
      const settings = getSettings();

      expect(settings.metadataDb.host).toBeUndefined();
      expect(settings.metadataDb.port).toBe(3306);
      expect(settings.metadataDb.name).toBe('clawsql_meta');
      expect(settings.metadataDb.user).toBe('clawsql');
      expect(settings.metadataDb.password).toBe('clawsql_password');
      expect(settings.metadataDb.poolSize).toBe(10);
    });
  });

  describe('OrchestratorSettings', () => {
    it('should have correct defaults', () => {
      const settings = getSettings();

      expect(settings.orchestrator.url).toBe('http://localhost:3000');
      expect(settings.orchestrator.timeout).toBe(30);
      expect(settings.orchestrator.tlsEnabled).toBe(false);
    });
  });

  describe('ProxySQLSettings', () => {
    it('should have correct defaults', () => {
      const settings = getSettings();

      expect(settings.proxysql.host).toBe('localhost');
      expect(settings.proxysql.adminPort).toBe(6032);
      expect(settings.proxysql.mysqlPort).toBe(6033);
      expect(settings.proxysql.adminUser).toBe('clawsql');
      expect(settings.proxysql.adminPassword).toBe('clawsql');
    });
  });

  describe('PrometheusSettings', () => {
    it('should have correct defaults', () => {
      const settings = getSettings();

      expect(settings.prometheus.url).toBe('http://localhost:9090');
      expect(settings.prometheus.retentionDays).toBe(15);
    });
  });

  describe('MonitoringSettings', () => {
    it('should have correct defaults', () => {
      const settings = getSettings();

      expect(settings.monitoring.collectionInterval).toBe(15);
      expect(settings.monitoring.healthCheckInterval).toBe(10);
      expect(settings.monitoring.alertCooldownMinutes).toBe(5);
    });
  });

  describe('FailoverSettings', () => {
    it('should have correct defaults', () => {
      const settings = getSettings();

      expect(settings.failover.autoFailoverEnabled).toBe(true);
      expect(settings.failover.timeoutSeconds).toBe(30);
      expect(settings.failover.minReplicasForFailover).toBe(2);
      expect(settings.failover.confirmationChecks).toBe(3);
    });
  });

  describe('DiscoverySettings', () => {
    it('should have correct defaults', () => {
      const settings = getSettings();

      expect(settings.discovery.networkSegments).toBe('172.18.0.0/24');
      expect(settings.discovery.portRangeStart).toBe(3306);
      expect(settings.discovery.portRangeEnd).toBe(3306);
      expect(settings.discovery.timeout).toBe(2);
      expect(settings.discovery.maxConcurrent).toBe(100);
    });
  });

  describe('APISettings', () => {
    it('should have correct defaults', () => {
      const settings = getSettings();

      expect(settings.api.host).toBe('0.0.0.0');
      expect(settings.api.port).toBe(8080);
      expect(settings.api.tokenSecret).toBe('change-me-in-production');
      expect(settings.api.tokenExpiryHours).toBe(24);
    });
  });

  describe('MySQLCredentials', () => {
    it('should have correct defaults', () => {
      const settings = getSettings();

      expect(settings.mysql.adminUser).toBe('clawsql');
      expect(settings.mysql.adminPassword).toBe('');
      expect(settings.mysql.replicationUser).toBe('repl');
      expect(settings.mysql.replicationPassword).toBe('');
    });
  });

  describe('LogSettings', () => {
    it('should have correct defaults', () => {
      const settings = getSettings();

      expect(settings.logging.level).toBe('ERROR');
      expect(settings.logging.format).toBe('json');
    });
  });

  describe('Environment variable loading', () => {
    it('should load settings from environment variables', () => {
      process.env.API_PORT = '9090';
      process.env.METADATA_DB_HOST = 'custom-mysql';
      process.env.AUTO_FAILOVER_ENABLED = 'false';

      resetSettings();
      const settings = getSettings();

      expect(settings.api.port).toBe(9090);
      expect(settings.metadataDb.host).toBe('custom-mysql');
      expect(settings.failover.autoFailoverEnabled).toBe(false);
    });
  });
});