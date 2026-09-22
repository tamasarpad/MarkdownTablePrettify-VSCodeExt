#!/bin/bash
#
# DevContainer operations wrapper (optional convenience — plain `devcontainer up`
# + `docker exec` work without it).
#
# Usage:
#   ./devcontainer.sh status              # container + git + ports + secrets
#   ./devcontainer.sh enter               # enter shell, injecting agent secrets
#   ./devcontainer.sh enter --no-secrets  # enter without secret injection
#
# Secret injection (all optional, all skipped silently if unavailable):
#   - CLAUDE_CODE_OAUTH_TOKEN: forwarded from host env, else macOS keychain
#     (service "claude-code-oauth-token"). On Linux, export it before calling,
#     or use the 1Password template below.
#   - 1Password: lines "VAR=op://vault/item/field" in
#     ~/.devcontainers/<project>/secrets.env.template are resolved via `op read`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEVCONTAINER_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_DIR="$(dirname "$DEVCONTAINER_DIR")"
DEVCONTAINER_JSON="$DEVCONTAINER_DIR/devcontainer.json"
PROJECT_NAME="$(basename "$PROJECT_DIR")"
AGENT_HOME="$HOME/.devcontainers/$PROJECT_NAME"
SECRETS_TEMPLATE="$AGENT_HOME/secrets.env.template"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
log_info()    { printf "${BLUE}i${NC} %s\n" "$1"; }
log_success() { printf "${GREEN}ok${NC} %s\n" "$1"; }
log_warn()    { printf "${YELLOW}warn${NC} %s\n" "$1"; }
log_error()   { printf "${RED}error${NC} %s\n" "$1" >&2; }
log_header()  { printf "\n${BOLD}${CYAN}=== %s ===${NC}\n" "$1"; }

check_docker() {
    command -v docker &>/dev/null || { log_error "Docker not installed."; exit 1; }
    docker info &>/dev/null || { log_error "Docker daemon not running."; exit 1; }
}

check_devcontainer_cli() {
    command -v devcontainer &>/dev/null || {
        log_error "devcontainer CLI not found. Install: npm install -g @devcontainers/cli"
        exit 1
    }
}

# Trailing `|| true`: no match (e.g. a project with no published port) must not
# trip `set -e` via a non-zero pipeline in a command substitution.
get_container_name() {
    grep -o '"--name=[^"]*"' "$DEVCONTAINER_JSON" 2>/dev/null | head -1 | sed 's/"--name=\([^"]*\)"/\1/' || true
}
get_container_port() {
    grep -oE '"[0-9.]*:?[0-9]+:[0-9]+"' "$DEVCONTAINER_JSON" 2>/dev/null | head -1 | sed 's/"//g' | sed 's/.*:\([0-9]*\):[0-9]*/\1/' || true
}
get_container_status() {
    local name="$1"
    if docker ps --filter "name=^${name}$" --format '{{.Names}}' 2>/dev/null | grep -q "^${name}$"; then echo running
    elif docker ps -a --filter "name=^${name}$" --format '{{.Names}}' 2>/dev/null | grep -q "^${name}$"; then echo stopped
    else echo "not found"; fi
}

load_secrets() {
    DOCKER_ENV_ARGS=()
    [ -f "$SECRETS_TEMPLATE" ] || return 1
    command -v op &>/dev/null || { log_warn "1Password CLI (op) not found — skipping secrets."; return 1; }
    log_info "Loading secrets from 1Password (Touch ID may be required)..."
    local loaded=0
    while IFS= read -r line || [ -n "$line" ]; do
        [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
        local var_name="${line%%=*}" op_ref="${line#*=}"
        [[ "$op_ref" =~ ^op:// ]] || continue
        local value
        if value=$(op read "$op_ref" 2>/dev/null); then
            DOCKER_ENV_ARGS+=("-e" "${var_name}=${value}"); ((loaded++))
        else
            log_warn "Failed to read: $var_name"
        fi
    done < "$SECRETS_TEMPLATE"
    [ "$loaded" -gt 0 ] && log_success "Loaded $loaded secret(s)" && return 0
    return 1
}

cmd_status() {
    check_docker
    local name port status
    name=$(get_container_name); port=$(get_container_port); status=$(get_container_status "$name")

    log_header "Container"
    echo "Name: $name"
    case "$status" in
        running) log_success "Status: running"; docker port "$name" 2>/dev/null | sed 's/^/Ports: /' || true ;;
        stopped) log_warn "Status: stopped"; echo "  Start: devcontainer up --workspace-folder \"$PROJECT_DIR\"" ;;
        *)       log_error "Status: not found"; echo "  Create: devcontainer up --workspace-folder \"$PROJECT_DIR\"" ;;
    esac

    log_header "Git"
    if [ -d "$PROJECT_DIR/.git" ]; then
        echo "Branch: $(git -C "$PROJECT_DIR" branch --show-current 2>/dev/null || echo unknown)"
        local changes; changes=$(git -C "$PROJECT_DIR" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
        [ "$changes" -gt 0 ] && log_warn "Uncommitted changes: $changes file(s)" || log_success "Working tree clean"
    else
        log_warn "Not a git repository"
    fi

    log_header "Secrets"
    if [ -f "$SECRETS_TEMPLATE" ]; then
        log_success "1Password template: $SECRETS_TEMPLATE"
    else
        echo "1Password template: not configured ($SECRETS_TEMPLATE)"
    fi
    command -v op &>/dev/null && log_success "1Password CLI: installed" || log_warn "1Password CLI: not installed"
    echo
}

cmd_enter() {
    local skip_secrets=false
    while [[ "${1:-}" == -* ]]; do
        case "$1" in
            --no-secrets) skip_secrets=true; shift ;;
            *) log_error "Unknown option: $1"; exit 1 ;;
        esac
    done

    check_docker
    local name status
    name=$(get_container_name); status=$(get_container_status "$name")
    case "$status" in
        running) ;;
        stopped) log_info "Starting $name..."; docker start "$name" >/dev/null ;;
        *) log_error "Container '$name' not found. Create: devcontainer up --workspace-folder \"$PROJECT_DIR\""; exit 1 ;;
    esac

    DOCKER_ENV_ARGS=()
    [ "$skip_secrets" = false ] && { load_secrets || true; }

    # CLAUDE_CODE_OAUTH_TOKEN: host env wins; else macOS keychain.
    if [ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] && command -v security &>/dev/null; then
        CLAUDE_CODE_OAUTH_TOKEN=$(security find-generic-password -a "$USER" -s "claude-code-oauth-token" -w 2>/dev/null) || true
    fi
    [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] && DOCKER_ENV_ARGS+=("-e" "CLAUDE_CODE_OAUTH_TOKEN=${CLAUDE_CODE_OAUTH_TOKEN}")

    log_info "Entering $name..."
    exec docker exec -it ${DOCKER_ENV_ARGS[@]+"${DOCKER_ENV_ARGS[@]}"} -u node -w /workspace "$name" bash -l
}

cmd_up() {
    check_docker; check_devcontainer_cli
    log_info "Bringing up container (devcontainer up)..."
    devcontainer up --workspace-folder "$PROJECT_DIR"
}

cmd_rebuild() {
    check_docker; check_devcontainer_cli
    log_info "Rebuilding container from scratch..."
    devcontainer up --workspace-folder "$PROJECT_DIR" --remove-existing-container
}

cmd_stop() {
    check_docker
    local name; name=$(get_container_name)
    if [ "$(get_container_status "$name")" = running ]; then
        docker stop "$name" >/dev/null && log_success "Stopped $name (state preserved)."
    else
        log_warn "$name is not running."
    fi
}

cmd_help() {
    cat <<EOF
DevContainer operations for this repo.

Usage: $0 <command>

  up                 Create/start the container (devcontainer up)
  enter [--no-secrets]   Enter a shell (starts if stopped; injects agent secrets)
  status             Container + git + secrets status
  stop               Stop the container (preserves state)
  rebuild            Recreate the container from scratch (--remove-existing-container)
  help               This message

Cross-project view (all agent containers on this host): docker ps
EOF
}

case "${1:-}" in
    up)            cmd_up ;;
    enter|e)       shift; cmd_enter "$@" ;;
    status|st)     cmd_status ;;
    stop)          cmd_stop ;;
    rebuild)       cmd_rebuild ;;
    help|--help|-h|"") cmd_help ;;
    *) log_error "Unknown command: $1"; echo; cmd_help; exit 1 ;;
esac
