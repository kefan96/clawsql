"""
Orchestrator client for topology management.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Any

import aiohttp

from .models import InstanceRole, InstanceState, MySQLCluster, MySQLInstance


@dataclass
class OrchestratorConfig:
    """Configuration for Orchestrator connection."""

    url: str = "http://orchestrator:3000"
    timeout: float = 30.0
    tls_enabled: bool = False
    tls_cert: str | None = None
    tls_key: str | None = None


class OrchestratorError(Exception):
    """Exception raised for Orchestrator errors."""

    pass


class OrchestratorClient:
    """
    Client for interacting with Orchestrator API.

    Provides methods for topology discovery, failover management,
    and instance control via the Orchestrator REST API.
    """

    def __init__(self, config: OrchestratorConfig | None = None):
        """
        Initialize the Orchestrator client.

        Args:
            config: Orchestrator connection configuration
        """
        self.config = config or OrchestratorConfig()
        self.base_url = self.config.url.rstrip("/")
        self._session: aiohttp.ClientSession | None = None

    async def connect(self) -> None:
        """Initialize HTTP session."""
        if self._session is None or self._session.closed:
            timeout = aiohttp.ClientTimeout(total=self.config.timeout)
            connector = None

            if self.config.tls_enabled:
                connector = aiohttp.TCPConnector(
                    ssl=self._create_ssl_context()
                )

            self._session = aiohttp.ClientSession(
                timeout=timeout,
                connector=connector,
            )

    async def close(self) -> None:
        """Close HTTP session."""
        if self._session and not self._session.closed:
            await self._session.close()

    async def __aenter__(self) -> "OrchestratorClient":
        """Async context manager entry."""
        await self.connect()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """Async context manager exit."""
        await self.close()

    async def health_check(self) -> bool:
        """
        Check if Orchestrator is healthy.

        Returns:
            True if Orchestrator is responding
        """
        try:
            await self._ensure_session()
            async with self._session.get(f"{self.base_url}/api/health") as response:
                return response.status == 200
        except Exception:
            return False

    async def get_clusters(self) -> list[str]:
        """
        Get all known cluster names from Orchestrator.

        Returns:
            List of cluster names
        """
        data = await self._get("/api/clusters")
        return [c["cluster_name"] if isinstance(c, dict) else c for c in data]

    async def get_topology(self, cluster_name: str) -> MySQLCluster | None:
        """
        Get topology for a specific cluster.

        Args:
            cluster_name: Name of the cluster

        Returns:
            MySQLCluster with topology information
        """
        try:
            data = await self._get(f"/api/cluster/{cluster_name}")
            return self._parse_topology(data, cluster_name)
        except OrchestratorError:
            return None

    async def get_instance(
        self,
        host: str,
        port: int = 3306,
    ) -> MySQLInstance | None:
        """
        Get instance details from Orchestrator.

        Args:
            host: Instance hostname
            port: Instance port

        Returns:
            MySQLInstance if found
        """
        try:
            data = await self._get(f"/api/instance/{host}/{port}")
            return self._parse_instance(data)
        except OrchestratorError:
            return None

    async def discover_instance(self, host: str, port: int = 3306) -> bool:
        """
        Force Orchestrator to discover an instance.

        Args:
            host: Instance hostname
            port: Instance port

        Returns:
            True if discovery succeeded
        """
        try:
            await self._post(f"/api/discover/{host}/{port}")
            return True
        except OrchestratorError:
            return False

    async def forget_instance(self, host: str, port: int = 3306) -> bool:
        """
        Remove instance from Orchestrator's memory.

        Args:
            host: Instance hostname
            port: Instance port

        Returns:
            True if forget succeeded
        """
        try:
            await self._post(f"/api/forget/{host}/{port}")
            return True
        except OrchestratorError:
            return False

    async def begin_maintenance(
        self,
        host: str,
        port: int,
        reason: str,
        duration_minutes: int = 60,
    ) -> bool:
        """
        Put instance in maintenance mode.

        Args:
            host: Instance hostname
            port: Instance port
            reason: Reason for maintenance
            duration_minutes: Maintenance duration

        Returns:
            True if maintenance mode started
        """
        try:
            await self._post(
                f"/api/maintenance-begin/{host}/{port}",
                json={
                    "reason": reason,
                    "duration": f"{duration_minutes}m",
                },
            )
            return True
        except OrchestratorError:
            return False

    async def end_maintenance(self, host: str, port: int) -> bool:
        """
        Remove instance from maintenance mode.

        Args:
            host: Instance hostname
            port: Instance port

        Returns:
            True if maintenance mode ended
        """
        try:
            await self._post(f"/api/maintenance-end/{host}/{port}")
            return True
        except OrchestratorError:
            return False

    async def get_replication_analysis(self) -> list[dict[str, Any]]:
        """
        Get replication analysis from Orchestrator.

        Returns:
            List of replication issues detected
        """
        return await self._get("/api/replication-analysis")

    async def request_failover(
        self,
        host: str,
        port: int,
        destination: str | None = None,
    ) -> dict[str, Any]:
        """
        Request Orchestrator to perform failover.

        Args:
            host: Current primary hostname
            port: Current primary port
            destination: Optional destination hostname

        Returns:
            Failover result
        """
        if destination:
            return await self._post(
                f"/api/graceful-promote-to/{host}/{port}",
                json={"destination": destination},
            )
        else:
            return await self._post(f"/api/graceful-promote-to/{host}/{port}")

    async def relocate_replicas(
        self,
        host: str,
        port: int,
        destination_host: str,
        destination_port: int,
    ) -> bool:
        """
        Relocate replicas to follow a new primary.

        Args:
            host: Current primary
            port: Current primary port
            destination_host: New primary host
            destination_port: New primary port

        Returns:
            True if relocation succeeded
        """
        try:
            await self._post(
                f"/api/relocate/{host}/{port}/{destination_host}/{destination_port}"
            )
            return True
        except OrchestratorError:
            return False

    async def _ensure_session(self) -> None:
        """Ensure session is connected."""
        if self._session is None or self._session.closed:
            await self.connect()

    async def _get(self, path: str) -> Any:
        """Make GET request to Orchestrator API."""
        await self._ensure_session()
        async with self._session.get(f"{self.base_url}{path}") as response:
            if response.status != 200:
                raise OrchestratorError(f"API error: {response.status}")
            return await response.json()

    async def _post(self, path: str, json: dict | None = None) -> Any:
        """Make POST request to Orchestrator API."""
        await self._ensure_session()
        async with self._session.post(
            f"{self.base_url}{path}",
            json=json,
        ) as response:
            if response.status not in (200, 201):
                raise OrchestratorError(f"API error: {response.status}")
            return await response.json()

    def _create_ssl_context(self) -> Any:
        """Create SSL context for TLS connections."""
        import ssl

        context = ssl.create_default_context()
        if self.config.tls_cert and self.config.tls_key:
            context.load_cert_chain(
                self.config.tls_cert,
                self.config.tls_key,
            )
        return context

    def _parse_topology(
        self,
        data: dict[str, Any],
        cluster_name: str,
    ) -> MySQLCluster:
        """Parse Orchestrator topology response into MySQLCluster."""
        cluster = MySQLCluster(
            cluster_id=cluster_name,
            name=cluster_name,
        )

        # Orchestrator returns a tree structure
        if "Alias" in data:
            # This is an instance node
            instance = self._parse_instance(data)
            if instance and instance.role == InstanceRole.PRIMARY:
                cluster.set_primary(instance)
            elif instance:
                cluster.add_replica(instance)

        # Parse children/replicas
        if "Child" in data:
            for child in data["Child"]:
                instance = self._parse_instance(child)
                if instance:
                    cluster.add_replica(instance)

        # Parse replicas if in different format
        if "replicas" in data:
            for replica_data in data["replicas"]:
                instance = self._parse_instance(replica_data)
                if instance:
                    cluster.add_replica(instance)

        return cluster

    def _parse_instance(self, data: dict[str, Any]) -> MySQLInstance | None:
        """Parse Orchestrator instance data into MySQLInstance."""
        if not data:
            return None

        # Determine role from Orchestrator data
        role = InstanceRole.UNKNOWN
        if data.get("IsPrimary") or data.get("IsCoPrimary"):
            role = InstanceRole.PRIMARY
        elif data.get("IsReplica"):
            role = InstanceRole.REPLICA

        # Determine state
        state = InstanceState.OFFLINE
        if data.get("IsLastCheckValid"):
            state = InstanceState.ONLINE
        elif data.get("IsUpToDate"):
            state = InstanceState.ONLINE

        # Handle maintenance mode
        in_maintenance = data.get("in_maintenance", False)
        if in_maintenance:
            state = InstanceState.MAINTENANCE

        return MySQLInstance(
            host=data.get("Hostname", data.get("Key", {}).get("Hostname", "")),
            port=data.get("Port", data.get("Key", {}).get("Port", 3306)),
            server_id=data.get("ServerID"),
            role=role,
            state=state,
            version=data.get("Version"),
            replication_lag=data.get("ReplicationLagSeconds"),
            last_seen=datetime.utcnow() if state == InstanceState.ONLINE else None,
            cluster_id=data.get("ClusterName"),
            labels={
                "alias": data.get("Alias", ""),
                "data_center": data.get("DataCenter", ""),
                "environment": data.get("Environment", ""),
            },
            extra={
                "is_co_primary": data.get("IsCoPrimary", False),
                "is_detached_primary": data.get("IsDetachedPrimary", False),
                "replication_depth": data.get("ReplicationDepth", 0),
            },
        )
