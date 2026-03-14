"""
Network scanner for MySQL instance discovery.
"""

import asyncio
import ipaddress
import socket
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Optional

import pymysql

from .models import InstanceState, MySQLInstance


class NetworkScanner:
    """
    Scans network segments for MySQL instances.

    Performs async network scanning to discover MySQL servers
    within specified network segments.
    """

    def __init__(
        self,
        network_segments: list[str],
        mysql_port_range: tuple[int, int] = (3306, 3306),
        scan_timeout: float = 2.0,
        max_concurrent: int = 100,
        credentials: Optional[dict[str, str]] = None,
    ):
        """
        Initialize the network scanner.

        Args:
            network_segments: List of CIDR notation network segments to scan
            mysql_port_range: Range of ports to scan (start, end)
            scan_timeout: Timeout in seconds for each connection attempt
            max_concurrent: Maximum concurrent scan operations
            credentials: MySQL credentials for probing (user, password)
        """
        self.network_segments = network_segments
        self.mysql_port_range = mysql_port_range
        self.scan_timeout = scan_timeout
        self.max_concurrent = max_concurrent
        self.credentials = credentials or {}
        self._semaphore: Optional[asyncio.Semaphore] = None

    async def scan_network(
        self,
        progress_callback: Optional[Callable[[int, int], None]] = None,
    ) -> list[str]:
        """
        Scan all network segments for potential MySQL hosts.

        Args:
            progress_callback: Optional callback for progress updates

        Returns:
            List of IP addresses that respond on MySQL ports
        """
        # Expand network segments to individual IPs
        all_ips = self._expand_networks()
        total = len(all_ips)
        responsive_hosts: list[str] = []

        self._semaphore = asyncio.Semaphore(self.max_concurrent)

        async def check_host(ip: str) -> Optional[str]:
            async with self._semaphore:
                for port in range(
                    self.mysql_port_range[0], self.mysql_port_range[1] + 1
                ):
                    if await self._check_port(ip, port):
                        return ip
            return None

        tasks = [check_host(ip) for ip in all_ips]
        completed = 0

        for coro in asyncio.as_completed(tasks):
            result = await coro
            if result:
                responsive_hosts.append(result)
            completed += 1
            if progress_callback:
                progress_callback(completed, total)

        return responsive_hosts

    async def probe_instance(
        self,
        host: str,
        port: int = 3306,
    ) -> Optional[MySQLInstance]:
        """
        Probe a single host:port for MySQL presence and gather info.

        Args:
            host: Host IP address
            port: MySQL port

        Returns:
            MySQLInstance if MySQL detected, None otherwise
        """
        try:
            # Try to connect and get MySQL info
            loop = asyncio.get_event_loop()
            with ThreadPoolExecutor(max_workers=1) as executor:
                result = await loop.run_in_executor(
                    executor,
                    self._connect_and_probe,
                    host,
                    port,
                )

            if result:
                # Convert role_hint to role for MySQLInstance
                if "role_hint" in result:
                    hint = result.pop("role_hint")
                    if hint == "primary":
                        result["role"] = InstanceRole.PRIMARY
                    elif hint == "replica":
                        result["role"] = InstanceRole.REPLICA

                instance = MySQLInstance(
                    host=host,
                    port=port,
                    state=InstanceState.ONLINE,
                    **result,
                )
                return instance

        except Exception:
            pass

        return None

    async def discover_instances(
        self,
        progress_callback: Optional[Callable[[int, int], None]] = None,
    ) -> list[MySQLInstance]:
        """
        Full discovery pipeline: scan + probe.

        Args:
            progress_callback: Optional callback for progress updates

        Returns:
            List of discovered MySQL instances
        """
        # Phase 1: Scan network for responsive hosts
        hosts = await self.scan_network()
        instances: list[MySQLInstance] = []

        # Phase 2: Probe each responsive host
        self._semaphore = asyncio.Semaphore(self.max_concurrent)
        total = len(hosts)
        completed = 0

        async def probe_all_ports(host: str) -> list[MySQLInstance]:
            results = []
            for port in range(
                self.mysql_port_range[0], self.mysql_port_range[1] + 1
            ):
                instance = await self.probe_instance(host, port)
                if instance:
                    results.append(instance)
            return results

        tasks = [probe_all_ports(host) for host in hosts]

        for coro in asyncio.as_completed(tasks):
            results = await coro
            instances.extend(results)
            completed += 1
            if progress_callback:
                progress_callback(completed, total)

        return instances

    def _expand_networks(self) -> list[str]:
        """Expand CIDR network segments to individual IP addresses."""
        ips: list[str] = []

        for segment in self.network_segments:
            try:
                network = ipaddress.ip_network(segment, strict=False)
                # Limit scan size for /16 or larger networks
                if network.num_addresses > 65536:
                    # Use only first 65536 addresses
                    for ip in list(network.hosts())[:65536]:
                        ips.append(str(ip))
                else:
                    for ip in network.hosts():
                        ips.append(str(ip))
            except ValueError:
                # If not valid CIDR, treat as single IP
                ips.append(segment)

        return ips

    async def _check_port(self, host: str, port: int) -> bool:
        """Check if a port is open on a host."""
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(host, port),
                timeout=self.scan_timeout,
            )
            writer.close()
            await writer.wait_closed()
            return True
        except Exception:
            return False

    def _connect_and_probe(
        self,
        host: str,
        port: int,
    ) -> Optional[dict[str, Any]]:
        """
        Connect to MySQL and probe for information.

        Runs in thread pool due to blocking pymysql.
        """
        try:
            connection = pymysql.connect(
                host=host,
                port=port,
                user=self.credentials.get("user", "monitor"),
                password=self.credentials.get("password", ""),
                connect_timeout=int(self.scan_timeout),
                read_timeout=int(self.scan_timeout),
            )

            result: dict[str, Any] = {}

            with connection.cursor() as cursor:
                # Get version
                cursor.execute("SELECT VERSION()")
                row = cursor.fetchone()
                if row:
                    result["version"] = row[0]

                # Get server_id
                cursor.execute("SELECT @@server_id")
                row = cursor.fetchone()
                if row:
                    result["server_id"] = row[0]

                # Check if replica
                cursor.execute("SHOW SLAVE STATUS")
                slave_status = cursor.fetchone()
                if slave_status:
                    result["role_hint"] = "replica"
                    # Get replication lag
                    cursor.execute("SHOW SLAVE STATUS")
                    status = cursor.dictfetchone()
                    if status:
                        result["replication_lag"] = status.get("Seconds_Behind_Master")
                else:
                    # Check if primary by looking for binlog
                    cursor.execute("SHOW MASTER STATUS")
                    if cursor.fetchone():
                        result["role_hint"] = "primary"

            connection.close()
            return result

        except Exception:
            return None


class InstanceRegistry:
    """
    Registry for managing discovered instances.

    Provides in-memory storage and lookup for MySQL instances.
    """

    def __init__(self) -> None:
        """Initialize the instance registry."""
        self._instances: dict[str, MySQLInstance] = {}
        self._clusters: dict[str, list[str]] = {}

    def register(self, instance: MySQLInstance) -> None:
        """Register an instance."""
        self._instances[instance.instance_id] = instance

        if instance.cluster_id:
            if instance.cluster_id not in self._clusters:
                self._clusters[instance.cluster_id] = []
            if instance.instance_id not in self._clusters[instance.cluster_id]:
                self._clusters[instance.cluster_id].append(instance.instance_id)

    def unregister(self, instance_id: str) -> bool:
        """Unregister an instance."""
        if instance_id in self._instances:
            instance = self._instances[instance_id]
            if instance.cluster_id and instance.cluster_id in self._clusters:
                try:
                    self._clusters[instance.cluster_id].remove(instance_id)
                except ValueError:
                    pass
            del self._instances[instance_id]
            return True
        return False

    def get(self, instance_id: str) -> Optional[MySQLInstance]:
        """Get an instance by ID."""
        return self._instances.get(instance_id)

    def get_all(self) -> list[MySQLInstance]:
        """Get all registered instances."""
        return list(self._instances.values())

    def get_by_cluster(self, cluster_id: str) -> list[MySQLInstance]:
        """Get all instances in a cluster."""
        instance_ids = self._clusters.get(cluster_id, [])
        return [
            self._instances[iid]
            for iid in instance_ids
            if iid in self._instances
        ]

    def get_by_state(self, state: InstanceState) -> list[MySQLInstance]:
        """Get all instances with a specific state."""
        return [i for i in self._instances.values() if i.state == state]

    def count(self) -> int:
        """Get total number of registered instances."""
        return len(self._instances)

    def clear(self) -> None:
        """Clear all registered instances."""
        self._instances.clear()
        self._clusters.clear()