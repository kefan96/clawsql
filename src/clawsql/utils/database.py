"""
Database connection management for ClawSQL.

Supports both SQLite and MySQL backends:
- SQLite (default): Zero-config, file-based storage
- MySQL: For centralized metadata or backup infrastructure
"""

import asyncio
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import aiomysql

# SQLite support (optional dependency)
try:
    import sqlite3

    import aiosqlite

    SQLITE_AVAILABLE = True
except ImportError:
    SQLITE_AVAILABLE = False


@dataclass
class ConnectionConfig:
    """Database connection configuration."""

    db_type: Literal["sqlite", "mysql"] = "sqlite"
    # SQLite settings
    sqlite_path: str = "/data/clawsql.db"
    # MySQL settings
    host: str = "localhost"
    port: int = 3306
    user: str = "clawsql"
    password: str = ""
    database: str = "clawsql"
    charset: str = "utf8mb4"
    autocommit: bool = True
    connect_timeout: int = 10
    pool_size: int = 10


class SQLiteConnectionPool:
    """
    Simple async SQLite connection manager.

    SQLite doesn't need connection pooling like MySQL,
    but we provide a similar interface for consistency.
    """

    def __init__(self, db_path: str):
        self.db_path = db_path
        self._connection: aiosqlite.Connection | None = None
        self._lock = asyncio.Lock()

    async def initialize(self) -> None:
        """Initialize SQLite database."""
        # Ensure directory exists
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)

        self._connection = await aiosqlite.connect(self.db_path)
        self._connection.row_factory = aiosqlite.Row

    async def close(self) -> None:
        """Close the connection."""
        if self._connection:
            await self._connection.close()
            self._connection = None

    async def acquire(self) -> "aiosqlite.Connection":
        """Acquire connection (returns the same connection for SQLite)."""
        if not self._connection:
            await self.initialize()
        return self._connection

    async def execute(
        self,
        query: str,
        params: tuple | None = None,
    ) -> list[dict]:
        """
        Execute a query and return results.

        Args:
            query: SQL query
            params: Query parameters

        Returns:
            List of result rows as dictionaries
        """
        async with self._lock:
            if not self._connection:
                await self.initialize()

            cursor = await self._connection.execute(query, params or ())
            rows = await cursor.fetchall()
            await self._connection.commit()

            return [dict(row) for row in rows]

    async def execute_many(
        self,
        query: str,
        params_list: list[tuple],
    ) -> int:
        """Execute a query multiple times."""
        async with self._lock:
            if not self._connection:
                await self.initialize()

            cursor = await self._connection.executemany(query, params_list)
            await self._connection.commit()
            return cursor.rowcount


class MySQLConnectionPool:
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
        self.config = config
        self.pool_size = pool_size
        self.max_overflow = max_overflow
        self._pool: aiomysql.Pool | None = None

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
        """Acquire a connection from the pool."""
        if not self._pool:
            await self.initialize()
        return self._pool.acquire()

    async def execute(
        self,
        query: str,
        params: tuple | None = None,
    ) -> list[dict]:
        """Execute a query and return results as list of dicts."""
        async with self._pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute(query, params)
                return await cursor.fetchall()

    async def execute_many(
        self,
        query: str,
        params_list: list[tuple],
    ) -> int:
        """Execute a query multiple times."""
        async with self._pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.executemany(query, params_list)
                return cursor.rowcount


class ConnectionPool:
    """
    Unified connection pool that supports both SQLite and MySQL.

    Automatically selects the appropriate backend based on configuration.
    """

    def __init__(self, config: ConnectionConfig):
        self.config = config
        self._pool: SQLiteConnectionPool | MySQLConnectionPool

        if config.db_type == "sqlite":
            if not SQLITE_AVAILABLE:
                raise RuntimeError(
                    "SQLite support not available. Install aiosqlite: pip install aiosqlite"
                )
            self._pool = SQLiteConnectionPool(config.sqlite_path)
        else:
            self._pool = MySQLConnectionPool(config)

    async def initialize(self) -> None:
        """Initialize the connection pool."""
        await self._pool.initialize()

    async def close(self) -> None:
        """Close the connection pool."""
        await self._pool.close()

    async def acquire(self) -> Any:
        """Acquire a connection."""
        return await self._pool.acquire()

    async def execute(
        self,
        query: str,
        params: tuple | None = None,
    ) -> list[dict]:
        """Execute a query and return results."""
        return await self._pool.execute(query, params)

    async def execute_many(
        self,
        query: str,
        params_list: list[tuple],
    ) -> int:
        """Execute a query multiple times."""
        return await self._pool.execute_many(query, params_list)


class DatabaseManager:
    """
    Manages database connections and migrations.

    Provides high-level database operations and
    connection management for ClawSQL.
    """

    def __init__(self, pool: ConnectionPool):
        self.pool = pool
        self._db_type = pool.config.db_type

    async def initialize_schema(self) -> None:
        """Initialize database schema (works for both SQLite and MySQL)."""
        if self._db_type == "sqlite":
            await self._initialize_sqlite_schema()
        else:
            await self._initialize_mysql_schema()

    async def _initialize_sqlite_schema(self) -> None:
        """Initialize SQLite schema."""
        schema_sql = """
        CREATE TABLE IF NOT EXISTS instances (
            instance_id TEXT PRIMARY KEY,
            host TEXT NOT NULL,
            port INTEGER NOT NULL,
            server_id INTEGER,
            role TEXT DEFAULT 'unknown',
            state TEXT DEFAULT 'offline',
            version TEXT,
            cluster_id TEXT,
            labels TEXT,
            last_seen TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS clusters (
            cluster_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            primary_instance_id TEXT,
            settings TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS failover_history (
            operation_id TEXT PRIMARY KEY,
            cluster_id TEXT NOT NULL,
            old_primary_id TEXT,
            new_primary_id TEXT,
            state TEXT,
            started_at TIMESTAMP,
            completed_at TIMESTAMP,
            error TEXT,
            manual INTEGER DEFAULT 0,
            reason TEXT,
            steps TEXT
        );

        CREATE TABLE IF NOT EXISTS alert_history (
            alert_id TEXT PRIMARY KEY,
            instance_id TEXT,
            check_name TEXT,
            severity TEXT,
            message TEXT,
            value REAL,
            threshold REAL,
            triggered_at TIMESTAMP,
            resolved_at TIMESTAMP,
            acknowledged INTEGER DEFAULT 0,
            acknowledged_by TEXT
        );

        CREATE TABLE IF NOT EXISTS config_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            config_path TEXT NOT NULL,
            old_value TEXT,
            new_value TEXT,
            reason TEXT,
            changed_by TEXT,
            changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
        statements = [s.strip() for s in schema_sql.split(";") if s.strip()]
        for statement in statements:
            await self.pool.execute(statement)

    async def _initialize_mysql_schema(self) -> None:
        """Initialize MySQL schema."""
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

        CREATE TABLE IF NOT EXISTS config_history (
            id INT AUTO_INCREMENT PRIMARY KEY,
            config_path VARCHAR(255) NOT NULL,
            old_value TEXT,
            new_value TEXT,
            reason TEXT,
            changed_by VARCHAR(255),
            changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
        labels = kwargs.get("labels")
        labels_json = json.dumps(labels) if labels else None

        if self._db_type == "sqlite":
            query = """
            INSERT INTO instances (instance_id, host, port, server_id, role, state, version, cluster_id, labels, last_seen)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(instance_id) DO UPDATE SET
                server_id = excluded.server_id,
                role = excluded.role,
                state = excluded.state,
                version = excluded.version,
                cluster_id = excluded.cluster_id,
                labels = excluded.labels,
                last_seen = datetime('now'),
                updated_at = datetime('now')
            """
        else:
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
            labels_json,
        )
        await self.pool.execute(query, params)

    async def get_instance(self, instance_id: str) -> dict | None:
        """Get an instance by ID."""
        if self._db_type == "sqlite":
            query = "SELECT * FROM instances WHERE instance_id = ?"
        else:
            query = "SELECT * FROM instances WHERE instance_id = %s"

        results = await self.pool.execute(query, (instance_id,))
        if results:
            return self._process_row(results[0])
        return None

    async def get_instances(
        self,
        cluster_id: str | None = None,
        state: str | None = None,
        role: str | None = None,
    ) -> list[dict]:
        """Get instances with optional filters."""
        query = "SELECT * FROM instances WHERE 1=1"
        params: list = []

        if cluster_id:
            query += f" AND cluster_id = {'?' if self._db_type == 'sqlite' else '%s'}"
            params.append(cluster_id)
        if state:
            query += f" AND state = {'?' if self._db_type == 'sqlite' else '%s'}"
            params.append(state)
        if role:
            query += f" AND role = {'?' if self._db_type == 'sqlite' else '%s'}"
            params.append(role)

        query += " ORDER BY cluster_id, role"

        results = await self.pool.execute(query, tuple(params) if params else None)
        return [self._process_row(row) for row in results]

    async def delete_instance(self, instance_id: str) -> bool:
        """Delete an instance."""
        if self._db_type == "sqlite":
            query = "DELETE FROM instances WHERE instance_id = ?"
        else:
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
        settings = kwargs.get("settings")
        settings_json = json.dumps(settings) if settings else None

        if self._db_type == "sqlite":
            query = """
            INSERT INTO clusters (cluster_id, name, description, primary_instance_id, settings)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(cluster_id) DO UPDATE SET
                name = excluded.name,
                description = excluded.description,
                primary_instance_id = excluded.primary_instance_id,
                settings = excluded.settings,
                updated_at = datetime('now')
            """
        else:
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
            settings_json,
        )
        await self.pool.execute(query, params)

    async def get_cluster(self, cluster_id: str) -> dict | None:
        """Get a cluster by ID."""
        if self._db_type == "sqlite":
            query = "SELECT * FROM clusters WHERE cluster_id = ?"
        else:
            query = "SELECT * FROM clusters WHERE cluster_id = %s"

        results = await self.pool.execute(query, (cluster_id,))
        if results:
            return self._process_row(results[0])
        return None

    async def get_clusters(self) -> list[dict]:
        """Get all clusters."""
        query = "SELECT * FROM clusters ORDER BY name"
        results = await self.pool.execute(query)
        return [self._process_row(row) for row in results]

    async def record_failover(
        self,
        operation_id: str,
        cluster_id: str,
        **kwargs,
    ) -> None:
        """Record a failover operation."""
        steps = kwargs.get("steps")
        steps_json = json.dumps(steps) if steps else None

        if self._db_type == "sqlite":
            query = """
            INSERT INTO failover_history
            (operation_id, cluster_id, old_primary_id, new_primary_id, state, started_at, completed_at, error, manual, reason, steps)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """
        else:
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
            steps_json,
        )
        await self.pool.execute(query, params)

    def _process_row(self, row: dict) -> dict:
        """Process a database row, handling JSON fields."""
        result = dict(row)
        # Parse JSON fields if they're strings
        for field in ["labels", "settings", "steps"]:
            if field in result and isinstance(result[field], str):
                try:
                    result[field] = json.loads(result[field])
                except (json.JSONDecodeError, TypeError):
                    pass
        return result


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
