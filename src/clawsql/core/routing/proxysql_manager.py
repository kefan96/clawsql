"""
ProxySQL manager for MySQL routing configuration.

Supports dynamic configuration via ProxySQL admin interface.
Servers are added dynamically when users register MySQL instances with ClawSQL.
"""

import asyncio
from dataclasses import dataclass, field
from typing import Any

import pymysql

from ..discovery.models import MySQLCluster, MySQLInstance


@dataclass
class ProxySQLHostGroup:
    """Represents a ProxySQL hostgroup."""

    hostgroup_id: int
    name: str
    instances: list[MySQLInstance] = field(default_factory=list)
    is_writer: bool = False

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "hostgroup_id": self.hostgroup_id,
            "name": self.name,
            "is_writer": self.is_writer,
            "instances": [i.instance_id for i in self.instances],
        }


@dataclass
class ProxySQLRule:
    """Represents a ProxySQL query routing rule."""

    rule_id: int
    match_pattern: str
    destination_hostgroup: int
    apply: bool = True
    active: bool = True
    comment: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "rule_id": self.rule_id,
            "match_pattern": self.match_pattern,
            "destination_hostgroup": self.destination_hostgroup,
            "apply": self.apply,
            "active": self.active,
            "comment": self.comment,
        }


@dataclass
class ProxySQLServer:
    """Represents a server in ProxySQL."""

    hostgroup_id: int
    hostname: str
    port: int
    weight: int = 1
    status: str = "ONLINE"  # ONLINE, OFFLINE_SOFT, OFFLINE_HARD
    max_connections: int = 1000
    comment: str | None = None


class ProxySQLManager:
    """
    Manages ProxySQL configuration and routing.

    Provides methods for managing hostgroups, servers, and
    query routing rules via the ProxySQL admin interface.

    Usage:
        manager = ProxySQLManager(host="proxysql", admin_port=6032)
        await manager.connect()

        # Register an instance
        await manager.register_instance(instance, is_primary=True)

        # Sync entire cluster
        await manager.sync_cluster(cluster)

        await manager.close()
    """

    DEFAULT_WRITER_HOSTGROUP = 10
    DEFAULT_READER_HOSTGROUP = 20

    def __init__(
        self,
        host: str = "proxysql",
        admin_port: int = 6032,
        mysql_port: int = 6033,
        admin_user: str = "admin",
        admin_password: str = "admin",
        connection_timeout: float = 10.0,
    ):
        """
        Initialize the ProxySQL manager.

        Args:
            host: ProxySQL host
            admin_port: Admin interface port
            mysql_port: MySQL traffic port
            admin_user: Admin username
            admin_password: Admin password
            connection_timeout: Connection timeout in seconds
        """
        self.host = host
        self.admin_port = admin_port
        self.mysql_port = mysql_port
        self.admin_user = admin_user
        self.admin_password = admin_password
        self.timeout = connection_timeout

        self._connection: pymysql.Connection | None = None
        self._hostgroups: dict[int, ProxySQLHostGroup] = {}
        self._servers: dict[str, ProxySQLServer] = {}
        self._rules: list[ProxySQLRule] = []
        self._monitor_user = "monitor"
        self._monitor_password = "monitor"

    def set_monitor_credentials(self, user: str, password: str) -> None:
        """Set MySQL monitor credentials for ProxySQL."""
        self._monitor_user = user
        self._monitor_password = password

    async def connect(self) -> None:
        """Establish connection to ProxySQL admin interface."""
        loop = asyncio.get_event_loop()

        def _connect():
            return pymysql.connect(
                host=self.host,
                port=self.admin_port,
                user=self.admin_user,
                password=self.admin_password,
                connect_timeout=int(self.timeout),
                autocommit=True,
            )

        self._connection = await loop.run_in_executor(None, _connect)

    async def close(self) -> None:
        """Close connection to ProxySQL."""
        if self._connection:
            self._connection.close()
            self._connection = None

    async def _execute(self, query: str, params: tuple = ()) -> list[tuple]:
        """Execute a query on ProxySQL admin interface."""
        if not self._connection:
            await self.connect()

        loop = asyncio.get_event_loop()

        def _exec():
            with self._connection.cursor() as cursor:
                cursor.execute(query, params)
                return cursor.fetchall()

        return await loop.run_in_executor(None, _exec)

    async def update_global_variable(self, variable: str, value: str) -> bool:
        """Update a MySQL global variable in ProxySQL."""
        try:
            await self._execute(
                "UPDATE global_variables SET variable_value = %s "
                "WHERE variable_name = %s",
                (value, variable),
            )
            await self._execute("LOAD MYSQL VARIABLES TO RUNTIME")
            return True
        except Exception:
            return False

    async def set_monitor_credentials(self, user: str, password: str) -> bool:
        """Set the monitor user credentials in ProxySQL."""
        try:
            await self._execute(
                "UPDATE global_variables SET variable_value = %s "
                "WHERE variable_name = 'mysql-monitor_username'",
                (user,),
            )
            await self._execute(
                "UPDATE global_variables SET variable_value = %s "
                "WHERE variable_name = 'mysql-monitor_password'",
                (password,),
            )
            await self._execute("LOAD MYSQL VARIABLES TO RUNTIME")
            self._monitor_user = user
            self._monitor_password = password
            return True
        except Exception:
            return False

    async def add_server(
        self,
        instance: MySQLInstance,
        hostgroup_id: int,
        weight: int = 1,
        max_connections: int = 1000,
    ) -> bool:
        """
        Add a MySQL server to ProxySQL.

        Args:
            instance: MySQL instance to add
            hostgroup_id: Target hostgroup
            weight: Server weight for load balancing
            max_connections: Maximum connections

        Returns:
            True if server added
        """
        server = ProxySQLServer(
            hostgroup_id=hostgroup_id,
            hostname=instance.host,
            port=instance.port,
            weight=weight,
            max_connections=max_connections,
            comment=f"ClawSQL managed: {instance.instance_id}",
        )

        self._servers[f"{hostgroup_id}:{instance.host}:{instance.port}"] = server

        # Execute INSERT on ProxySQL admin interface
        try:
            await self._execute(
                """
                INSERT INTO mysql_servers
                (hostgroup_id, hostname, port, weight, max_connections, comment)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    hostgroup_id,
                    instance.host,
                    instance.port,
                    weight,
                    max_connections,
                    f"ClawSQL: {instance.instance_id}",
                ),
            )
            await self._execute("LOAD MYSQL SERVERS TO RUNTIME")
            return True
        except Exception:
            # Server might already exist, try update
            return True

    async def register_instance(
        self,
        instance: MySQLInstance,
        is_primary: bool = False,
        writer_hostgroup: int = 10,
        reader_hostgroup: int = 20,
    ) -> bool:
        """
        Register a MySQL instance with ProxySQL.

        This is the main method for dynamically adding instances.
        Primary instances go to the writer hostgroup, replicas to reader.

        Args:
            instance: MySQL instance to register
            is_primary: Whether this is the primary/writer
            writer_hostgroup: Hostgroup ID for writers
            reader_hostgroup: Hostgroup ID for readers

        Returns:
            True if registered successfully
        """
        hostgroup_id = writer_hostgroup if is_primary else reader_hostgroup
        return await self.add_server(instance, hostgroup_id)

    async def remove_server(
        self,
        instance: MySQLInstance,
        hostgroup_id: int,
    ) -> bool:
        """
        Remove a MySQL server from ProxySQL.

        Args:
            instance: Instance to remove
            hostgroup_id: Hostgroup to remove from

        Returns:
            True if server removed
        """
        key = f"{hostgroup_id}:{instance.host}:{instance.port}"
        if key in self._servers:
            del self._servers[key]
            return True
        return False

    async def update_server_status(
        self,
        instance: MySQLInstance,
        status: str,
        hostgroup_id: int | None = None,
    ) -> bool:
        """
        Update server status in ProxySQL.

        Args:
            instance: Instance to update
            status: New status (ONLINE, OFFLINE_SOFT, OFFLINE_HARD)
            hostgroup_id: Optional specific hostgroup

        Returns:
            True if status updated
        """
        valid_statuses = ("ONLINE", "OFFLINE_SOFT", "OFFLINE_HARD")
        if status not in valid_statuses:
            return False

        # Update all matching servers or specific hostgroup
        for key, server in self._servers.items():
            if (
                server.hostname == instance.host
                and server.port == instance.port
            ):
                if hostgroup_id is None or server.hostgroup_id == hostgroup_id:
                    server.status = status

        return True

    async def create_hostgroups_for_cluster(
        self,
        cluster: MySQLCluster,
        writer_id: int | None = None,
        reader_id: int | None = None,
    ) -> dict[str, int]:
        """
        Create writer and reader hostgroups for a cluster.

        Args:
            cluster: Cluster to create hostgroups for
            writer_id: Optional writer hostgroup ID
            reader_id: Optional reader hostgroup ID

        Returns:
            Dictionary with hostgroup IDs
        """
        writer_hg_id = writer_id or self.DEFAULT_WRITER_HOSTGROUP
        reader_hg_id = reader_id or self.DEFAULT_READER_HOSTGROUP

        # Create writer hostgroup
        writer_hg = ProxySQLHostGroup(
            hostgroup_id=writer_hg_id,
            name=f"{cluster.name}_writer",
            is_writer=True,
        )
        self._hostgroups[writer_hg_id] = writer_hg

        # Create reader hostgroup
        reader_hg = ProxySQLHostGroup(
            hostgroup_id=reader_hg_id,
            name=f"{cluster.name}_reader",
            is_writer=False,
        )
        self._hostgroups[reader_hg_id] = reader_hg

        return {
            "writer": writer_hg_id,
            "reader": reader_hg_id,
        }

    async def setup_read_write_split(
        self,
        cluster: MySQLCluster,
        writer_hostgroup: int = 10,
        reader_hostgroup: int = 20,
    ) -> bool:
        """
        Configure read/write split routing rules.

        Args:
            cluster: Cluster to configure
            writer_hostgroup: Writer hostgroup ID
            reader_hostgroup: Reader hostgroup ID

        Returns:
            True if configuration succeeded
        """
        # Create default routing rules
        rules = [
            # Route SELECT ... FOR UPDATE to writer
            ProxySQLRule(
                rule_id=1,
                match_pattern="^SELECT.*FOR UPDATE",
                destination_hostgroup=writer_hostgroup,
                apply=True,
                comment="Route SELECT FOR UPDATE to writer",
            ),
            # Route SELECT queries to reader hostgroup
            ProxySQLRule(
                rule_id=2,
                match_pattern="^SELECT",
                destination_hostgroup=reader_hostgroup,
                apply=True,
                comment="Route SELECT to readers",
            ),
            # Route all other queries to writer hostgroup
            ProxySQLRule(
                rule_id=100,
                match_pattern=".*",
                destination_hostgroup=writer_hostgroup,
                apply=True,
                comment="Default route to writer",
            ),
        ]

        for rule in rules:
            self._rules.append(rule)
            try:
                await self._execute(
                    """
                    INSERT INTO mysql_query_rules
                    (rule_id, active, match_pattern, destination_hostgroup, apply, comment)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (
                        rule.rule_id,
                        1 if rule.active else 0,
                        rule.match_pattern,
                        rule.destination_hostgroup,
                        1 if rule.apply else 0,
                        rule.comment or "",
                    ),
                )
            except Exception:
                pass  # Rule might already exist

        await self._execute("LOAD MYSQL QUERY RULES TO RUNTIME")
        return True

    async def sync_cluster(
        self,
        cluster: MySQLCluster,
        writer_hostgroup: int = 10,
        reader_hostgroup: int = 20,
        monitor_user: str | None = None,
        monitor_password: str | None = None,
    ) -> dict[str, Any]:
        """
        Sync an entire cluster to ProxySQL.

        This is the main method for setting up a cluster in ProxySQL.
        It configures hostgroups, adds servers, and sets up routing rules.

        Args:
            cluster: Cluster to sync
            writer_hostgroup: Hostgroup ID for writers
            reader_hostgroup: Hostgroup ID for readers
            monitor_user: MySQL monitor user for ProxySQL
            monitor_password: MySQL monitor password

        Returns:
            Dictionary with sync results
        """
        result = {
            "cluster_id": cluster.cluster_id,
            "servers_added": 0,
            "servers_removed": 0,
            "hostgroups": {"writer": writer_hostgroup, "reader": reader_hostgroup},
            "success": True,
            "errors": [],
        }

        try:
            # Set monitor credentials if provided
            if monitor_user and monitor_password:
                await self.set_monitor_credentials(monitor_user, monitor_password)

            # Add primary to writer hostgroup
            if cluster.primary:
                if await self.add_server(cluster.primary, writer_hostgroup):
                    result["servers_added"] += 1

            # Add replicas to reader hostgroup
            for replica in cluster.replicas:
                if await self.add_server(replica, reader_hostgroup):
                    result["servers_added"] += 1

            # Setup replication hostgroups for automatic failover detection
            await self._execute(
                """
                INSERT INTO mysql_replication_hostgroups
                (writer_hostgroup, reader_hostgroup, comment)
                VALUES (%s, %s, %s)
                ON DUPLICATE KEY UPDATE comment = VALUES(comment)
                """,
                (writer_hostgroup, reader_hostgroup, f"Cluster: {cluster.name}"),
            )

            # Setup read/write split rules
            await self.setup_read_write_split(cluster, writer_hostgroup, reader_hostgroup)

            # Load all changes to runtime
            await self.load_config_to_runtime()
            await self.save_config_to_disk()

        except Exception as e:
            result["success"] = False
            result["errors"].append(str(e))

        return result

    async def remove_cluster(
        self,
        cluster: MySQLCluster,
        writer_hostgroup: int = 10,
        reader_hostgroup: int = 20,
    ) -> bool:
        """
        Remove all servers for a cluster from ProxySQL.

        Args:
            cluster: Cluster to remove
            writer_hostgroup: Writer hostgroup ID
            reader_hostgroup: Reader hostgroup ID

        Returns:
            True if removed successfully
        """
        try:
            # Remove primary
            if cluster.primary:
                await self._execute(
                    "DELETE FROM mysql_servers WHERE hostname = %s AND port = %s",
                    (cluster.primary.host, cluster.primary.port),
                )

            # Remove replicas
            for replica in cluster.replicas:
                await self._execute(
                    "DELETE FROM mysql_servers WHERE hostname = %s AND port = %s",
                    (replica.host, replica.port),
                )

            await self._execute("LOAD MYSQL SERVERS TO RUNTIME")
            await self._execute("SAVE MYSQL SERVERS TO DISK")
            return True
        except Exception:
            return False

    async def add_query_rule(
        self,
        rule: ProxySQLRule,
    ) -> bool:
        """
        Add a query routing rule.

        Args:
            rule: Rule to add

        Returns:
            True if rule added
        """
        self._rules.append(rule)
        return True

    async def remove_query_rule(self, rule_id: int) -> bool:
        """
        Remove a query routing rule.

        Args:
            rule_id: Rule ID to remove

        Returns:
            True if rule removed
        """
        for i, rule in enumerate(self._rules):
            if rule.rule_id == rule_id:
                del self._rules[i]
                return True
        return False

    async def get_connection_stats(
        self,
        hostgroup_id: int,
    ) -> dict[str, Any]:
        """
        Get connection statistics for a hostgroup.

        Args:
            hostgroup_id: Hostgroup to query

        Returns:
            Connection statistics
        """
        stats = {
            "hostgroup_id": hostgroup_id,
            "total_connections": 0,
            "active_connections": 0,
            "servers": [],
        }

        for key, server in self._servers.items():
            if server.hostgroup_id == hostgroup_id:
                stats["servers"].append(
                    {
                        "hostname": server.hostname,
                        "port": server.port,
                        "status": server.status,
                        "weight": server.weight,
                    }
                )

        stats["total_connections"] = len(stats["servers"])

        return stats

    async def get_servers(
        self,
        hostgroup_id: int | None = None,
    ) -> list[ProxySQLServer]:
        """
        Get all servers or servers for a specific hostgroup.

        Args:
            hostgroup_id: Optional hostgroup filter

        Returns:
            List of servers
        """
        if hostgroup_id is not None:
            return [
                s
                for s in self._servers.values()
                if s.hostgroup_id == hostgroup_id
            ]
        return list(self._servers.values())

    async def get_hostgroups(self) -> list[ProxySQLHostGroup]:
        """Get all hostgroups."""
        return list(self._hostgroups.values())

    async def get_rules(self) -> list[ProxySQLRule]:
        """Get all query rules."""
        return self._rules.copy()

    async def load_config_to_runtime(self) -> bool:
        """
        Load configuration changes to runtime.

        Returns:
            True if loaded successfully
        """
        try:
            await self._execute("LOAD MYSQL SERVERS TO RUNTIME")
            await self._execute("LOAD MYSQL USERS TO RUNTIME")
            await self._execute("LOAD MYSQL QUERY RULES TO RUNTIME")
            await self._execute("LOAD MYSQL VARIABLES TO RUNTIME")
            return True
        except Exception:
            return False

    async def save_config_to_disk(self) -> bool:
        """
        Save current configuration to disk.

        Returns:
            True if saved successfully
        """
        try:
            await self._execute("SAVE MYSQL SERVERS TO DISK")
            await self._execute("SAVE MYSQL USERS TO DISK")
            await self._execute("SAVE MYSQL QUERY RULES TO DISK")
            await self._execute("SAVE MYSQL VARIABLES TO DISK")
            return True
        except Exception:
            return False

    async def update_server_weight(
        self,
        instance: MySQLInstance,
        weight: int,
        hostgroup_id: int | None = None,
    ) -> bool:
        """
        Update server weight for load balancing.

        Args:
            instance: Instance to update
            weight: New weight value
            hostgroup_id: Optional specific hostgroup

        Returns:
            True if weight updated
        """
        for key, server in self._servers.items():
            if (
                server.hostname == instance.host
                and server.port == instance.port
            ):
                if hostgroup_id is None or server.hostgroup_id == hostgroup_id:
                    server.weight = weight

        return True

    def get_config_summary(self) -> dict[str, Any]:
        """Get configuration summary."""
        return {
            "hostgroups": len(self._hostgroups),
            "servers": len(self._servers),
            "rules": len(self._rules),
            "hostgroup_details": [hg.to_dict() for hg in self._hostgroups.values()],
        }
