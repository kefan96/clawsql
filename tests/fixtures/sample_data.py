"""Sample test data fixtures in JSON format."""

SAMPLE_ORCHESTRATOR_TOPOLOGY = {
    "Code": "OK",
    "Details": {
        "Alias": "mysql-primary:3306",
        "Key": {"Hostname": "mysql-primary", "Port": 3306},
        "ServerID": 1,
        "Version": "8.0.35",
        "ReadOnly": False,
        "IsLastCheckValid": 1,
        "IsUpToDate": 1,
        "IsRecentlyChecked": 1,
        "SecondsSinceLastSeen": 0,
        "CountReplicas": 3,
        "Replicas": [
            {
                "Alias": "mysql-replica-1:3306",
                "Key": {"Hostname": "mysql-replica-1", "Port": 3306},
                "ServerID": 2,
                "ReadOnly": True,
                "IsLastCheckValid": 1,
                "ReplicationLagSeconds": 0,
                "Replicas": [],
            },
            {
                "Alias": "mysql-replica-2:3306",
                "Key": {"Hostname": "mysql-replica-2", "Port": 3306},
                "ServerID": 3,
                "ReadOnly": True,
                "IsLastCheckValid": 1,
                "ReplicationLagSeconds": 1,
                "Replicas": [],
            },
            {
                "Alias": "mysql-replica-3:3306",
                "Key": {"Hostname": "mysql-replica-3", "Port": 3306},
                "ServerID": 4,
                "ReadOnly": True,
                "IsLastCheckValid": 0,
                "ReplicationLagSeconds": 30,
                "Replicas": [],
            },
        ],
    },
}

SAMPLE_PROMETHEUS_METRICS = """# HELP clawsql_instances_total Total number of MySQL instances
# TYPE clawsql_instances_total gauge
clawsql_instances_total{cluster="test-cluster"} 4.0

# HELP clawsql_instances_online Number of online instances
# TYPE clawsql_instances_online gauge
clawsql_instances_online{cluster="test-cluster"} 3.0

# HELP clawsql_replication_lag_seconds Replication lag in seconds
# TYPE clawsql_replication_lag_seconds gauge
clawsql_replication_lag_seconds{instance="mysql-replica-1:3306"} 0.5
clawsql_replication_lag_seconds{instance="mysql-replica-2:3306"} 1.2

# HELP clawsql_failovers_total Total number of failovers
# TYPE clawsql_failovers_total counter
clawsql_failovers_total{cluster="test-cluster",status="success"} 2.0
clawsql_failovers_total{cluster="test-cluster",status="failed"} 0.0
"""

SAMPLE_GRAFANA_DASHBOARD = {
    "dashboard": {
        "id": None,
        "title": "ClawSQL MySQL Cluster",
        "tags": ["mysql", "clawsql"],
        "panels": [
            {
                "title": "Instance Health",
                "type": "stat",
                "targets": [
                    {"expr": "clawsql_instances_online", "refId": "A"}
                ],
            },
            {
                "title": "Replication Lag",
                "type": "graph",
                "targets": [
                    {"expr": "clawsql_replication_lag_seconds", "refId": "A"}
                ],
            },
        ],
    },
    "overwrite": True,
}

SAMPLE_SYSBENCH_RESULT = {
    "sql_statistics": {
        "queries_per_second": 1250.5,
        "transactions_per_second": 625.25,
        "read_queries_per_second": 937.87,
        "write_queries_per_second": 312.62,
    },
    "latency": {
        "avg": 15.99,
        "min": 2.5,
        "max": 150.2,
        "p95": 45.5,
        "p99": 89.3,
    },
}
