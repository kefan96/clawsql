# ClawSQL AI Integration

ClawSQL integrates with [OpenClaw](https://github.com/openclaw/openclaw) for AI-powered database operations.

## Overview

OpenClaw provides an AI gateway that enables natural language interaction with ClawSQL. It can help you:

- Query cluster topology and status
- Explain replication concepts
- Guide through setup procedures
- Troubleshoot common issues
- Automate routine operations

## Setup

### Automatic (Recommended)

OpenClaw starts automatically as a Docker container when you run `/start`. No manual installation required.

```bash
clawsql> /start
```

The gateway will be available at:
- **Gateway**: `ws://localhost:18789`
- **Control UI**: http://localhost:18790

### Using Local OpenClaw

If you have OpenClaw installed locally and running, ClawSQL will detect it and skip the Docker container. This is useful for:

- Custom AI provider configurations
- Development and testing
- Shared OpenClaw instance across multiple projects

To use a local installation:

```bash
# Start OpenClaw gateway locally
openclaw gateway

# ClawSQL will detect and use it
clawsql> /start
```

## Usage

### Natural Language Commands

Interact with the CLI using natural language:

```
clawsql> show me the cluster topology
clawsql> what's the replication lag on replica-1?
clawsql> help me set up a new replica
clawsql> explain the failover process
clawsql> why is my replica not replicating?
```

### Supported Operations

| Category | Examples |
|----------|----------|
| Topology queries | "show me the cluster", "what's the primary?" |
| Status checks | "check replication status", "is the cluster healthy?" |
| Guided operations | "how do I add a replica?", "help me set up failover" |
| Troubleshooting | "why is replication lag high?", "diagnose connection issues" |
| Explanations | "explain read/write splitting", "how does failover work?" |

### Stopping AI Operations

During AI processing, press **ESC twice** (within 500ms) to stop the current operation.

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCLAW_GATEWAY_URL` | `ws://localhost:18789` | Gateway WebSocket URL |
| `OPENCLAW_GATEWAY_TOKEN` | `clawsql-openclaw-token` | Authentication token |
| `OPENCLAW_MODEL_PROVIDER` | (bundled) | AI provider (anthropic, openai, etc.) |
| `OPENCLAW_MODEL_API_KEY` | - | API key for external providers |

### Docker Compose

OpenClaw is configured in `docker-compose.yml`:

```yaml
openclaw:
  image: ghcr.io/openclaw/openclaw:latest
  ports:
    - "18789:18789"  # Gateway WebSocket
    - "18790:18790"  # Control UI
  environment:
    - OPENCLAW_GATEWAY_PORT=18789
    - OPENCLAW_GATEWAY_TOKEN=${OPENCLAW_GATEWAY_TOKEN:-clawsql-openclaw-token}
    - OPENCLAW_GATEWAY_BIND=lan
```

## Detection Logic

ClawSQL automatically detects OpenClaw availability:

1. **Docker container check**: Looks for running `openclaw` container
2. **Local gateway check**: Checks if gateway is reachable at `ws://localhost:18789`
3. **CLI status check**: Verifies local OpenClaw CLI gateway status

If a local OpenClaw is detected, the Docker container is skipped with `--scale openclaw=0`.

## Health Checks

### CLI Commands

```bash
# Check service status
/status

# Run diagnostics
/doctor
```

Both commands report OpenClaw health status and mode (Docker/local).

### Manual Checks

```bash
# Check gateway health
curl http://localhost:18789/health

# Check container status
docker ps | grep openclaw

# View logs
docker logs openclaw
```

## Troubleshooting

### Gateway Not Available

**Symptom**: `/status` shows OpenClaw as "not available"

**Solutions**:
1. Start the platform: `/start`
2. Check container logs: `docker logs openclaw`
3. Verify port is not blocked: `ss -tlnp | grep 18789`

### Container Running but Gateway Unhealthy

**Symptom**: Container shows "running" but health check fails

**Solutions**:
1. Wait for startup (can take 30+ seconds)
2. Check logs: `docker logs openclaw`
3. Verify configuration: `docker exec openclaw cat /data/.openclaw/openclaw.json`

### Local OpenClaw Not Detected

**Symptom**: Local gateway running but ClawSQL starts Docker container

**Solutions**:
1. Verify gateway is accessible: `curl http://localhost:18789/health`
2. Check CLI status: `openclaw status`
3. Ensure `OPENCLAW_GATEWAY_URL` matches local gateway

## API Integration

### Programmatic Usage

```typescript
import { sendToOpenClaw, isOpenClawAvailable } from 'clawsql/dist/cli/agent/index.js';

async function queryAI(message: string) {
  if (await isOpenClawAvailable()) {
    return await sendToOpenClaw(message);
  }
  throw new Error('OpenClaw not available');
}
```

### Cron Scheduling

```typescript
import { scheduleCron } from 'clawsql/dist/cli/agent/index.js';

// Schedule hourly health check
await scheduleCron(
  'clawsql-health',
  '0 * * * *',
  'Check MySQL cluster health and report any issues'
);
```

### Notifications

```typescript
import { sendNotification } from 'clawsql/dist/cli/agent/index.js';

// Send alert
await sendNotification('slack', 'Primary failover detected in cluster-1');
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        ClawSQL CLI                           │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                   User Input                         │    │
│  └───────────────────────┬─────────────────────────────┘    │
│                          │                                   │
│                          ▼                                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              OpenClaw Integration                    │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │    │
│  │  │ Detection   │  │   Agent     │  │   Cron &    │  │    │
│  │  │ Functions   │  │  Functions  │  │ Notifications│  │    │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  │    │
│  └───────────────────────┬─────────────────────────────┘    │
└──────────────────────────┼──────────────────────────────────┘
                           │
                           ▼
           ┌───────────────────────────────┐
           │      OpenClaw Gateway          │
           │    ws://localhost:18789        │
           └───────────────────────────────┘
```

## Related Documentation

- [Getting Started](GET_STARTED.md) - Step-by-step tutorial
- [Demo Guide](DEMO.md) - Testing with demo cluster
- [API Documentation](API.md) - REST API reference