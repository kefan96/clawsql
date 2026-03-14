"""
Database connection management for ClawSQL.
"""

import asyncio
from dataclasses import dataclass, field
from typing import Any, Optional

import aiomysql
import pymysql


@dataclass
class ConnectionConfig:
    """Database connection configuration."""

    host: str = "localhost"
    port: int = 3306
    user: str = "clawsql"
    password: str = ""
    database: str = "clawsql"
    charset: str = "utf8mb4"
    autocommit: bool = True
    connect_timeout: int = 10


class ConnectionPool:
    """
    Async connection pool for MySQL.

    Provides connection pooling with automatic management
    and health checking.
    """

    def __init__(
        self,
        config: ConnectionConfig,
        pool_size: int = 10,
        max_overflow: int = 5,
    ):
        """
        Initialize connection pool.

        Args:
            config: Connection configuration
            pool_size: Base pool size
            max_overflow: Additional connections allowed
        """
        self.config = config
        self.pool_size = pool_size
        self.max_overflow = max_overflow
        self._pool: Optional[aiomysql.Pool] = None

    async def initialize(self) -> None:
        """Initialize the connection pool."""
        self._pool = await aiomysql.create_pool(
            host=self.config.host,
            port=self.config.port,
            user=self.config.user,
            password=self.config.password,
            db=self.config.database,
            charset=self.config.charset,
            autocommit=self.config.autocommit,
            minsize=1,
            maxsize=self.pool_size + self.max_overflow,
            connect_timeout=self.config.connect_timeout,
        )

    async def close(self) -> None:
        """Close the connection pool."""
        if self._pool:
            self._pool.close()
            await self._pool.wait_closed()
            self._pool = None

    async def acquire(self) -> aiomysql.Connection:
        """
        Acquire a connection from the pool.

        Returns:
            Database connection
        """
        if not self._pool:
            await self.initialize()
        return self._pool.acquire()

    async def execute(
        self,
        query: str,
        params: Optional[tuple] = None,
    ) -> Any:
        """
        Execute a query and return results.

        Args:
            query: SQL query
            params: Query parameters

        Returns:
            Query result
        """
        async with self._pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(query, params)
                return await cursor.fetchall()

    async def execute_many(
        self,
        query: str,
        params_list: list[tuple],
    ) -> int:
        """
        Execute a query multiple times.

        Args:
            query: SQL query
            params_list: List of parameter tuples

        Returns:
            Number of rows affected
        """
        async with self._pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.executemany(query, params_list)
                return cursor.rowcount


class DatabaseManager:
    """
    Manages database connections and migrations.

    Provides high-level database operations and
    connection management for ClawSQL.
    """

    def __init__(self, pool: ConnectionPool):
        """
        Initialize database manager.

        Args:
            pool: Connection pool to use
        """
        self.pool = pool

    async def initialize_schema(self) -> None:
        """Initialize database schema."""
        schema_sql = """
        CREATE TABLE IF NOT EXISTS instances (
            instance_id VARCHAR(255) PRIMARY KEY,
            host VARCHAR(255) NOT NULL,
            port INT NOT NULL,
            server_id INT,
            role ENUM('primary', 'replica', 'unknown') DEFAULT 'unknown',
            state ENUM('online', 'offline', 'recovering', 'failed', 'maintenance') DEFAULT 'offline',
            version VARCHAR(50),
            cluster_id VARCHAR(255),
            labels JSON,
            last_seen TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY idx_host_port (host, port)
        );

        CREATE TABLE IF NOT EXISTS clusters (
            cluster_id VARCHAR(255) PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            primary_instance_id VARCHAR(255),
            settings JSON,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (primary_instance_id) REFERENCES instances(instance_id)
        );

        CREATE TABLE IF NOT EXISTS failover_history (
            operation_id VARCHAR(255) PRIMARY KEY,
            cluster_id VARCHAR(255) NOT NULL,
            old_primary_id VARCHAR(255),
            new_primary_id VARCHAR(255),
            state VARCHAR(50),
            started_at TIMESTAMP,
            completed_at TIMESTAMP,
            error TEXT,
            manual BOOLEAN DEFAULT FALSE,
            reason TEXT,
            steps JSON,
            FOREIGN KEY (cluster_id) REFERENCES clusters(cluster_id)
        );

        CREATE TABLE IF NOT EXISTS alert_history (
            alert_id VARCHAR(255) PRIMARY KEY,
            instance_id VARCHAR(255),
            check_name VARCHAR(100),
            severity ENUM('info', 'warning', 'critical'),
            message TEXT,
            value FLOAT,
            threshold FLOAT,
            triggered_at TIMESTAMP,
            resolved_at TIMESTAMP,
            acknowledged BOOLEAN DEFAULT FALSE,
            acknowledged_by VARCHAR(255),
            FOREIGN KEY (instance_id) REFERENCES instances(instance_id)
        );
        """

        statements = [s.strip() for s in schema_sql.split(";") if s.strip()]

        for statement in statements:
            await self.pool.execute(statement)

    async def save_instance(
        self,
        instance_id: str,
        host: str,
        port: int,
        **kwargs,
    ) -> None:
        """Save or update an instance."""
        query = """
        INSERT INTO instances (instance_id, host, port, server_id, role, state, version, cluster_id, labels, last_seen)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
        ON DUPLICATE KEY UPDATE
            server_id = VALUES(server_id),
            role = VALUES(role),
            state = VALUES(state),
            version = VALUES(version),
            cluster_id = VALUES(cluster_id),
            labels = VALUES(labels),
            last_seen = NOW()
        """
        params = (
            instance_id,
            host,
            port,
            kwargs.get("server_id"),
            kwargs.get("role", "unknown"),
            kwargs.get("state", "offline"),
            kwargs.get("version"),
            kwargs.get("cluster_id"),
            kwargs.get("labels"),
        )
        await self.pool.execute(query, params)

    async def get_instance(self, instance_id: str) -> Optional[dict]:
        """Get an instance by ID."""
        query = "SELECT * FROM instances WHERE instance_id = %s"
        results = await self.pool.execute(query, (instance_id,))
        if results:
            return self._row_to_dict(results[0])
        return None

    async def get_instances(
        self,
        cluster_id: Optional[str] = None,
        state: Optional[str] = None,
        role: Optional[str] = None,
    ) -> list[dict]:
        """Get instances with optional filters."""
        query = "SELECT * FROM instances WHERE 1=1"
        params: list = []

        if cluster_id:
            query += " AND cluster_id = %s"
            params.append(cluster_id)
        if state:
            query += " AND state = %s"
            params.append(state)
        if role:
            query += " AND role = %s"
            params.append(role)

        query += " ORDER BY cluster_id, role"

        results = await self.pool.execute(query, tuple(params) if params else None)
        return [self._row_to_dict(row) for row in results]

    async def delete_instance(self, instance_id: str) -> bool:
        """Delete an instance."""
        query = "DELETE FROM instances WHERE instance_id = %s"
        await self.pool.execute(query, (instance_id,))
        return True

    async def save_cluster(
        self,
        cluster_id: str,
        name: str,
        **kwargs,
    ) -> None:
        """Save or update a cluster."""
        query = """
        INSERT INTO clusters (cluster_id, name, description, primary_instance_id, settings)
        VALUES (%s, %s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE
            name = VALUES(name),
            description = VALUES(description),
            primary_instance_id = VALUES(primary_instance_id),
            settings = VALUES(settings)
        """
        params = (
            cluster_id,
            name,
            kwargs.get("description"),
            kwargs.get("primary_instance_id"),
            kwargs.get("settings"),
        )
        await self.pool.execute(query, params)

    async def get_cluster(self, cluster_id: str) -> Optional[dict]:
        """Get a cluster by ID."""
        query = "SELECT * FROM clusters WHERE cluster_id = %s"
        results = await self.pool.execute(query, (cluster_id,))
        if results:
            return self._row_to_dict(results[0])
        return None

    async def get_clusters(self) -> list[dict]:
        """Get all clusters."""
        query = "SELECT * FROM clusters ORDER BY name"
        results = await self.pool.execute(query)
        return [self._row_to_dict(row) for row in results]

    async def record_failover(
        self,
        operation_id: str,
        cluster_id: str,
        **kwargs,
    ) -> None:
        """Record a failover operation."""
        query = """
        INSERT INTO failover_history
        (operation_id, cluster_id, old_primary_id, new_primary_id, state, started_at, completed_at, error, manual, reason, steps)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """
        params = (
            operation_id,
            cluster_id,
            kwargs.get("old_primary_id"),
            kwargs.get("new_primary_id"),
            kwargs.get("state", "pending"),
            kwargs.get("started_at"),
            kwargs.get("completed_at"),
            kwargs.get("error"),
            kwargs.get("manual", False),
            kwargs.get("reason"),
            kwargs.get("steps"),
        )
        await self.pool.execute(query, params)

    def _row_to_dict(self, row: tuple) -> dict:
        """Convert a database row to dictionary."""
        # Simplified - real implementation would use cursor.description
        return {"data": row}


async def create_mysql_connection(
    host: str,
    port: int,
    user: str,
    password: str,
    database: str = "",
    timeout: float = 10.0,
) -> aiomysql.Connection:
    """
    Create a direct MySQL connection.

    Args:
        host: MySQL host
        port: MySQL port
        user: Username
        password: Password
        database: Database name
        timeout: Connection timeout

    Returns:
        MySQL connection
    """
    return await aiomysql.connect(
        host=host,
        port=port,
        user=user,
        password=password,
        db=database,
        connect_timeout=int(timeout),
        autocommit=True,
    )