"""
ProxySQL manager for MySQL routing configuration.
"""

import asyncio
from dataclasses import dataclass, field
from typing import Any, Optional

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
    comment: Optional[str] = None

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
    comment: Optional[str] = None


class ProxySQLManager:
    """
    Manages ProxySQL configuration and routing.

    Provides methods for managing hostgroups, servers, and
    query routing rules via the ProxySQL admin interface.
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

        self._connection: Any = None
        self._hostgroups: dict[int, ProxySQLHostGroup] = {}
        self._servers: dict[str, ProxySQLServer] = {}
        self._rules: list[ProxySQLRule] = []

    async def connect(self) -> None:
        """Establish connection to ProxySQL admin interface."""
        # In real implementation, would connect via MySQL protocol
        # to admin interface
        pass

    async def close(self) -> None:
        """Close connection to ProxySQL."""
        if self._connection:
            self._connection = None

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

        # In real implementation, execute:
        # INSERT INTO mysql_servers (hostgroup_id, hostname, port, weight, max_connections, comment)
        # VALUES (?, ?, ?, ?, ?, ?)

        return True

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
        hostgroup_id: Optional[int] = None,
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
        writer_id: Optional[int] = None,
        reader_id: Optional[int] = None,
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
            # Route SELECT queries to reader hostgroup
            ProxySQLRule(
                rule_id=1,
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

        return True

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
        hostgroup_id: Optional[int] = None,
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
        # In real implementation:
        # LOAD MYSQL SERVERS TO RUNTIME;
        # LOAD MYSQL QUERY RULES TO RUNTIME;
        return True

    async def save_config_to_disk(self) -> bool:
        """
        Save current configuration to disk.

        Returns:
            True if saved successfully
        """
        # In real implementation:
        # SAVE MYSQL SERVERS TO DISK;
        # SAVE MYSQL QUERY RULES TO DISK;
        return True

    async def update_server_weight(
        self,
        instance: MySQLInstance,
        weight: int,
        hostgroup_id: Optional[int] = None,
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