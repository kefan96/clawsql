/**
 * Tests for Prometheus Exporter
 */

import { PrometheusExporter, getPrometheusExporter } from '../../../core/monitoring/exporters.js';

describe('PrometheusExporter', () => {
  let exporter: PrometheusExporter;

  beforeEach(() => {
    exporter = new PrometheusExporter();
  });

  describe('getMetrics', () => {
    it('should return metrics in Prometheus format', async () => {
      const metrics = await exporter.getMetrics();

      expect(typeof metrics).toBe('string');
      expect(metrics.length).toBeGreaterThan(0);
    });
  });

  describe('getContentType', () => {
    it('should return correct content type', () => {
      const contentType = exporter.getContentType();

      expect(contentType).toContain('text/plain');
    });
  });

  describe('recordFailover', () => {
    it('should record failover metrics', () => {
      expect(() => {
        exporter.recordFailover('cluster-1', true, 15.5);
      }).not.toThrow();
    });

    it('should record failed failover', () => {
      expect(() => {
        exporter.recordFailover('cluster-1', false, 30);
      }).not.toThrow();
    });
  });

  describe('setFailoverInProgress', () => {
    it('should set failover in progress', () => {
      expect(() => {
        exporter.setFailoverInProgress('cluster-1', true);
      }).not.toThrow();
    });

    it('should clear failover in progress', () => {
      expect(() => {
        exporter.setFailoverInProgress('cluster-1', false);
      }).not.toThrow();
    });
  });

  describe('updateInstanceHealth', () => {
    it('should update instance health metric for healthy instance', () => {
      expect(() => {
        exporter.updateInstanceHealth('mysql-primary:3306', 'cluster-1', 'primary', true);
      }).not.toThrow();
    });

    it('should update instance health metric for unhealthy instance', () => {
      expect(() => {
        exporter.updateInstanceHealth('mysql-replica:3306', 'cluster-1', 'replica', false);
      }).not.toThrow();
    });
  });

  describe('updateReplicationLag', () => {
    it('should update replication lag metric', () => {
      expect(() => {
        exporter.updateReplicationLag('mysql-replica:3306', 'cluster-1', 5);
      }).not.toThrow();
    });
  });

  describe('updateConnections', () => {
    it('should update connections metric', () => {
      expect(() => {
        exporter.updateConnections('mysql-primary:3306', 'cluster-1', 100);
      }).not.toThrow();
    });
  });

  describe('updateQPS', () => {
    it('should update QPS metric', () => {
      expect(() => {
        exporter.updateQPS('mysql-primary:3306', 'cluster-1', 1500);
      }).not.toThrow();
    });
  });
});

describe('getPrometheusExporter', () => {
  it('should return singleton instance', () => {
    const e1 = getPrometheusExporter();
    const e2 = getPrometheusExporter();

    expect(e1).toBe(e2);
  });
});