#!/bin/bash
# Post-start: lightweight verification on every container start. Idempotent.

WORKSPACE="${WORKSPACE:-/workspace}"

echo "=== Post-start checks ==="

# Keep the Codex install single-sourced: drop any stale ~/.local copy that would
# shadow the node-owned global install + its built-in updater.
if [ -e "$HOME/.local/bin/codex" ] || [ -L "$HOME/.local/bin/codex" ]; then
    rm -f "$HOME/.local/bin/codex"
    rm -rf "$HOME/.local/lib/node_modules/@openai"
    echo "Cleaned up stale ~/.local/bin/codex"
fi

echo "Node: $(node --version 2>/dev/null || echo unknown)"
echo "npm:  $(npm --version 2>/dev/null || echo unknown)"
command -v claude &>/dev/null && echo "Claude Code: available" || echo "WARNING: Claude Code not found"
command -v codex  &>/dev/null && echo "Codex: available"       || echo "WARNING: Codex not found"
git config user.name &>/dev/null && echo "Git user: $(git config user.name)" || echo "WARNING: Git user not configured"

# Keep the Codex skills symlink fresh (repo path may have changed)
if [ -d "$WORKSPACE/.claude/skills" ]; then
    mkdir -p "$HOME/.codex/skills"
    ln -sfn "$WORKSPACE/.claude/skills" "$HOME/.codex/skills/claude-shared"
fi

echo "=== Post-start complete ==="
