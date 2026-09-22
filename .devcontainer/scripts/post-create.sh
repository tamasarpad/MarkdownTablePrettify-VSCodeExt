#!/bin/bash
# Post-create: seed agent home from assets, install agent tools, project deps.
# Runs once after container creation (or rebuild). Does NOT use set -e —
# network-dependent steps warn instead of aborting (partial setup beats none).
set -o pipefail

WORKSPACE="${WORKSPACE:-/workspace}"
ASSETS="$WORKSPACE/.devcontainer/assets"
ERRORS=0

echo "=== Post-create setup ==="

# The /home/node bind mount hides the image's default dotfiles — reseed them.
# Each checked independently so partial homes recover gracefully.
[ ! -f "$HOME/.bashrc" ]       && cp "$ASSETS/bashrc"       "$HOME/.bashrc"       && echo "Created .bashrc"
[ ! -f "$HOME/.bash_profile" ] && cp "$ASSETS/bash_profile" "$HOME/.bash_profile" && echo "Created .bash_profile"

# NPM_CONFIG_PREFIX (node-owned) comes from the image; ensure it is on PATH now.
export PATH="$HOME/.local/bin:${NPM_CONFIG_PREFIX:-/usr/local/share/npm-global}/bin:$PATH"

# --- Agent tools (network-dependent, non-fatal) ---
# Claude Code: official installer → ~/.local/bin (versioned symlink, self-updates there).
if ! command -v claude &>/dev/null; then
    echo "Installing Claude Code..."
    if ! curl -fsSL https://claude.ai/install.sh | bash; then
        echo "WARNING: Claude Code installation failed (network issue?)"
        ERRORS=$((ERRORS + 1))
    fi
else
    echo "Claude Code already installed: $(claude --version 2>/dev/null || echo unknown)"
fi

# Codex: standard `npm install -g` into the node-owned global prefix. The
# built-in updater uses the same command + prefix, so they stay in sync.
# Remove any legacy ~/.local Codex first (would shadow the global install).
[ -x "$HOME/.local/bin/codex" ] && rm -f "$HOME/.local/bin/codex" && echo "Removed legacy ~/.local/bin/codex"
[ -d "$HOME/.local/lib/node_modules/@openai" ] && rm -rf "$HOME/.local/lib/node_modules/@openai"
if ! command -v codex &>/dev/null; then
    echo "Installing Codex..."
    if ! npm install -g @openai/codex 2>&1; then
        echo "WARNING: Codex installation failed (network issue?)"
        ERRORS=$((ERRORS + 1))
    fi
else
    echo "Codex already installed: $(codex --version 2>/dev/null || echo unknown)"
fi

# --- Agent tool configs (only if missing — never clobber agent customizations) ---
if [ ! -f "$HOME/.claude/settings.json" ]; then
    mkdir -p "$HOME/.claude"
    cp "$ASSETS/claude-settings.json" "$HOME/.claude/settings.json"
    echo "Created Claude settings (bypassPermissions, ccstatusline)"
fi
if [ ! -f "$HOME/.codex/config.toml" ]; then
    mkdir -p "$HOME/.codex"
    cp "$ASSETS/codex-config.toml" "$HOME/.codex/config.toml"
    echo "Created Codex config (approval_policy=never)"
fi
if [ ! -f "$HOME/.config/ccstatusline/settings.json" ]; then
    mkdir -p "$HOME/.config/ccstatusline"
    cp "$ASSETS/ccstatusline-settings.json" "$HOME/.config/ccstatusline/settings.json"
    echo "Created ccstatusline config"
fi

# --- Git config fallback (primary path is initialize.sh on the host) ---
if [ ! -f "$HOME/.gitconfig" ]; then
    git config --global credential.helper ""
    git config --global push.default current
    echo "WARNING: Git identity not configured. Run: git config --global user.name 'Your Name'"
fi

# --- Register Codex as an MCP server in Claude (so `mcp__codex__codex` is available) ---
# Idempotent; user scope persists in the mounted home. Registration does NOT authenticate
# Codex — that is a separate one-time interactive step: run `codex login` inside the container.
# MCP servers load at Claude startup, so a new `claude` session is needed to pick this up.
if command -v claude &>/dev/null && command -v codex &>/dev/null; then
    if ! claude mcp get codex &>/dev/null; then
        if claude mcp add --scope user codex -- codex mcp-server; then
            echo "Registered Codex MCP server (mcp__codex__codex). Run 'codex login' once to authenticate."
        else
            echo "WARNING: failed to register Codex MCP server (claude mcp add)"
        fi
    else
        echo "Codex MCP server already registered"
    fi
fi

# --- Reuse repo Claude skills from Codex (if the repo ships any) ---
if [ -d "$WORKSPACE/.claude/skills" ]; then
    mkdir -p "$HOME/.codex/skills"
    ln -sfn "$WORKSPACE/.claude/skills" "$HOME/.codex/skills/claude-shared"
    echo "Linked repo Claude skills into Codex (~/.codex/skills/claude-shared)"
fi

# --- Project dependencies ---
cd "$WORKSPACE" || exit 1
if ! npm ci; then
    echo "ERROR: npm ci failed; extension dependencies are unavailable."
    exit 1
fi

if [ $ERRORS -gt 0 ]; then
    echo "=== Post-create complete with $ERRORS warning(s) — some tools may be missing ==="
else
    echo "=== Post-create complete ==="
fi
