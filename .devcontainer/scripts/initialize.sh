#!/bin/bash
# Initialize: host-side preparation before container creation.
# Runs ON THE HOST (not inside the container) via devcontainer's initializeCommand.
# Must be idempotent (rebuilds, reopens, etc.). Non-zero exit blocks creation —
# only fail on unrecoverable issues.
#
# This is what makes the project standalone: a fresh clone on any machine gets a
# working agent home with no skill/agent involvement.

# Shared agent home for this project (persists Claude/Codex auth + config)
AGENT_HOME="$HOME/.devcontainers/MarkdownTablePrettify-VSCodeExt"

# Derive container name + published host port from devcontainer.json (best effort)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEVCONTAINER_JSON="$SCRIPT_DIR/../devcontainer.json"
CONTAINER_NAME=""
HOST_PORT=""
if [ -f "$DEVCONTAINER_JSON" ]; then
    CONTAINER_NAME=$(grep -o '"--name=[^"]*"' "$DEVCONTAINER_JSON" | head -1 | sed 's/"--name=//;s/"//')
    HOST_PORT=$(grep -oE '"0\.0\.0\.0:[0-9]+:[0-9]+"' "$DEVCONTAINER_JSON" | head -1 | sed 's/"0\.0\.0\.0://;s/:.*//')
fi
CONTAINER_NAME="${CONTAINER_NAME:-MarkdownTablePrettify-VSCodeExt-dev}"

# --- Step 1: Create the agent home directory ---
if [ ! -d "$AGENT_HOME" ]; then
    mkdir -p "$AGENT_HOME"
    echo "[initialize] Created agent home: $AGENT_HOME"
fi

mkdir -p "$AGENT_HOME/.ssh"
chmod 700 "$AGENT_HOME/.ssh"

if [ ! -w "$AGENT_HOME" ]; then
    echo "[initialize] ERROR: $AGENT_HOME is not writable by $(id -un) (UID $(id -u))."
    echo "  Fix: sudo chown -R $(id -u):$(id -g) $AGENT_HOME"
    exit 1
fi

# --- Step 2: Seed git identity from the host (first run only) ---
# SECURITY: only user.name and user.email are copied. Credential helpers are
# explicitly disabled so the agent can commit but never push.
if [ ! -f "$AGENT_HOME/.gitconfig" ]; then
    HOST_NAME=""
    HOST_EMAIL=""
    if command -v git &>/dev/null; then
        HOST_NAME=$(git config --global user.name 2>/dev/null || true)
        HOST_EMAIL=$(git config --global user.email 2>/dev/null || true)
    fi

    git config --file "$AGENT_HOME/.gitconfig" credential.helper ""
    git config --file "$AGENT_HOME/.gitconfig" push.default current

    [ -n "$HOST_NAME" ]  && git config --file "$AGENT_HOME/.gitconfig" user.name  "$HOST_NAME"  && echo "[initialize] Git user.name: $HOST_NAME (from host)"
    [ -n "$HOST_EMAIL" ] && git config --file "$AGENT_HOME/.gitconfig" user.email "$HOST_EMAIL" && echo "[initialize] Git user.email: $HOST_EMAIL (from host)"

    if [ -z "$HOST_NAME" ] || [ -z "$HOST_EMAIL" ]; then
        echo "[initialize] WARNING: Git identity incomplete. Commits fail until set."
        echo "  Fix inside container: git config --global user.name 'Your Name'"
        echo "                        git config --global user.email 'you@example.com'"
    fi
    echo "[initialize] Created .gitconfig (credential helpers disabled — commit-only)"
fi

# --- Step 3: Check published port availability (skip if this project has none) ---
if [ -n "$HOST_PORT" ]; then
    OUR_CONTAINER_RUNNING=""
    if command -v docker &>/dev/null; then
        OUR_CONTAINER_RUNNING=$(docker ps -q --filter "name=^${CONTAINER_NAME}$" 2>/dev/null)
    fi
    if [ -z "$OUR_CONTAINER_RUNNING" ]; then
        if command -v lsof &>/dev/null; then
            PORT_USER=$(lsof -i ":$HOST_PORT" -sTCP:LISTEN -t 2>/dev/null | head -1)
            if [ -n "$PORT_USER" ]; then
                PORT_PROC=$(ps -p "$PORT_USER" -o comm= 2>/dev/null || echo "unknown")
                echo "[initialize] ERROR: Port $HOST_PORT is in use by '$PORT_PROC' (PID $PORT_USER)."
                echo "  Stop it or change the port in .devcontainer/devcontainer.json (runArgs -p)."
                exit 1
            fi
        elif command -v ss &>/dev/null; then
            if ss -tlnp 2>/dev/null | grep -q ":$HOST_PORT "; then
                echo "[initialize] ERROR: Port $HOST_PORT is in use."
                echo "  Stop it or change the port in .devcontainer/devcontainer.json (runArgs -p)."
                exit 1
            fi
        fi
    fi
fi

echo "[initialize] Ready (home=$AGENT_HOME, container=$CONTAINER_NAME${HOST_PORT:+, port=$HOST_PORT})"
