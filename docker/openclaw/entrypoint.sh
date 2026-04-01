#!/bin/bash
# OpenClaw entrypoint for ClawSQL
# Auto-configures the gateway on first run using environment variables

set -e

# Determine state directory - use OPENCLAW_STATE_DIR or default
STATE_DIR="${OPENCLAW_STATE_DIR:-/data/state}"
WORKSPACE_DIR="${OPENCLAW_WORKSPACE_DIR:-/data/workspace}"
CONFIG_FILE="${STATE_DIR}/openclaw.json"

# Ensure directories exist with proper error handling
# Docker volumes may have root ownership when first created,
# but containers often run as non-root users
ensure_dir() {
    local dir="$1"
    if [ ! -d "$dir" ]; then
        mkdir -p "$dir" 2>/dev/null || {
            echo "[openclaw-entrypoint] Warning: Cannot create $dir (permission denied)"

            local home_state="${HOME:-/tmp}/.openclaw/state"
            local home_workspace="${HOME:-/tmp}/.openclaw/workspace"

            if [ "$dir" = "$STATE_DIR" ]; then
                echo "[openclaw-entrypoint] Using fallback state directory: $home_state"
                STATE_DIR="$home_state"
                CONFIG_FILE="$STATE_DIR/openclaw.json"
                mkdir -p "$STATE_DIR"
            elif [ "$dir" = "$WORKSPACE_DIR" ]; then
                echo "[openclaw-entrypoint] Using fallback workspace directory: $home_workspace"
                WORKSPACE_DIR="$home_workspace"
                mkdir -p "$WORKSPACE_DIR"
            fi
        }
    fi
}

ensure_dir "$STATE_DIR"
ensure_dir "$WORKSPACE_DIR"

# Export updated directories in case fallback was used
# This ensures openclaw.mjs uses the correct paths
export OPENCLAW_STATE_DIR="$STATE_DIR"
export OPENCLAW_WORKSPACE_DIR="$WORKSPACE_DIR"

# Check if we need to run initial configuration
if [ ! -f "$CONFIG_FILE" ]; then
    echo "[openclaw-entrypoint] First run - configuring gateway..."

    # Determine provider configuration from environment
    if [ -n "$ANTHROPIC_API_KEY" ] && [ -n "$ANTHROPIC_BASE_URL" ]; then
        echo "[openclaw-entrypoint] Configuring custom Anthropic-compatible provider..."

        # Use onboard to configure custom provider
        node openclaw.mjs onboard \
            --non-interactive \
            --accept-risk \
            --auth-choice custom-api-key \
            --custom-api-key "$ANTHROPIC_API_KEY" \
            --custom-base-url "$ANTHROPIC_BASE_URL" \
            --custom-model-id "${ANTHROPIC_MODEL:-claude-3-5-sonnet-20241022}" \
            --custom-compatibility anthropic \
            --gateway-port "${OPENCLAW_GATEWAY_PORT:-18789}" \
            --gateway-token "${OPENCLAW_GATEWAY_TOKEN:-clawsql-openclaw-token}" \
            --gateway-bind lan \
            2>&1 || echo "[openclaw-entrypoint] Warning: onboard returned non-zero"

        # Ensure LAN binding and control UI settings
        node openclaw.mjs config set gateway.bind lan 2>&1 || true
        node openclaw.mjs config set gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback true 2>&1 || true

    elif [ -n "$ANTHROPIC_API_KEY" ]; then
        echo "[openclaw-entrypoint] Configuring Anthropic provider..."

        node openclaw.mjs onboard \
            --non-interactive \
            --accept-risk \
            --auth-choice anthropic-api-key \
            --anthropic-api-key "$ANTHROPIC_API_KEY" \
            --gateway-port "${OPENCLAW_GATEWAY_PORT:-18789}" \
            --gateway-token "${OPENCLAW_GATEWAY_TOKEN:-clawsql-openclaw-token}" \
            --gateway-bind lan \
            2>&1 || true

        node openclaw.mjs config set gateway.bind lan 2>&1 || true
        node openclaw.mjs config set gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback true 2>&1 || true

    elif [ -n "$OPENAI_API_KEY" ]; then
        echo "[openclaw-entrypoint] Configuring OpenAI provider..."

        node openclaw.mjs onboard \
            --non-interactive \
            --accept-risk \
            --auth-choice openai-api-key \
            --openai-api-key "$OPENAI_API_KEY" \
            --gateway-port "${OPENCLAW_GATEWAY_PORT:-18789}" \
            --gateway-token "${OPENCLAW_GATEWAY_TOKEN:-clawsql-openclaw-token}" \
            --gateway-bind lan \
            2>&1 || true

        node openclaw.mjs config set gateway.bind lan 2>&1 || true
        node openclaw.mjs config set gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback true 2>&1 || true

    else
        echo "[openclaw-entrypoint] No AI provider configured - using bundled model (limited)"

        # Create minimal config
        cat > "$CONFIG_FILE" << EOF
{
  "gateway": {
    "bind": "lan",
    "port": ${OPENCLAW_GATEWAY_PORT:-18789},
    "auth": {
      "mode": "token",
      "token": "${OPENCLAW_GATEWAY_TOKEN:-clawsql-openclaw-token}"
    },
    "controlUi": {
      "dangerouslyAllowHostHeaderOriginFallback": true
    }
  },
  "agents": {
    "defaults": {
      "model": "anthropic/claude-opus-4-6"
    }
  }
}
EOF
    fi

    echo "[openclaw-entrypoint] Configuration complete"
fi

# Start the gateway
echo "[openclaw-entrypoint] Starting gateway..."
exec node openclaw.mjs gateway --allow-unconfigured