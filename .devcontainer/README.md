# Markdown Table Prettifier — Agent Devcontainer

A containerized, sandboxed environment for AI coding agents (Claude Code, Codex)
working on this repo. **Optional** — you can still develop on the host normally.

This setup is **self-contained**: it needs no special skill or agent to bootstrap.
Anyone who clones the repo can bring it up with one command.

## What it gives you

- Agents run isolated in a container, not against your host.
- Git identity is seeded without a credential helper; make pushes from the host.
- Claude Code + Codex auth/config persist in a per-project agent home on the host
  (`~/.devcontainers/MarkdownTablePrettify-VSCodeExt/`), surviving container rebuilds.
- Node.js 22 and reproducible dependencies from `package-lock.json`.
- Xvfb and Electron libraries for the upstream VS Code extension test suite.
- No published ports, Docker socket, host SSH keys, or sibling repositories.

## Prerequisites

| Tool | Install |
| ---- | ------- |
| Docker | Docker Engine (Linux) or Docker Desktop (macOS/Windows) |
| devcontainer CLI | `npm install -g @devcontainers/cli` |

(Or open the folder in VS Code with the **Dev Containers** extension — it runs the
same lifecycle automatically.)

## Start it

```bash
devcontainer up --workspace-folder .
```

First run builds the image and runs `post-create.sh`, which installs Claude Code +
Codex and seeds config into `~/.devcontainers/MarkdownTablePrettify-VSCodeExt/`. Takes a few minutes.

The host-side `initialize.sh` (run automatically before the container starts) creates
that agent home and seeds a commit-only git identity from your host git config — so a
fresh clone on a new machine just works.

## Enter it

```bash
# Plain (works anywhere):
docker exec -it -u node -w /workspace MarkdownTablePrettify-VSCodeExt-dev bash -l

# Or the convenience wrapper (also injects a Claude OAuth token if available):
.devcontainer/scripts/devcontainer.sh enter
```

First time inside, authenticate Claude with `claude` → `/login` (or set
`CLAUDE_CODE_OAUTH_TOKEN` on the host before entering — see the wrapper header).

Codex is installed and registered with Claude as an MCP server (`mcp__codex__codex`).
From an SSH session, run `codex login --device-auth` and complete the sign-in in a
browser on the MacBook. Then start a fresh `claude` session so it picks up the MCP
server. Claude's own login prints a browser URL you can open on the MacBook.

## Common operations

```bash
.devcontainer/scripts/devcontainer.sh status         # container + git + secrets
docker stop MarkdownTablePrettify-VSCodeExt-dev                        # stop (state preserved)
devcontainer up --workspace-folder . --remove-existing-container   # rebuild
```

## Develop and verify

Run these from a shell inside the container:

```bash
npm run compile
xvfb-run -a npm test
```

`npm test` compiles the extension, copies system-test resources, downloads a VS Code
binary on first use, and launches the tests. The test download needs internet access.
The root `Dockerfile` builds the project's separate Markdown CLI image; the development
image is `.devcontainer/Dockerfile`.

## VS Code on another computer

On the MacBook, connect with **Remote - SSH** to macstudiolinux, open this folder on
the Linux host, then run **Dev Containers: Reopen in Container**. VS Code and its
extension development host run through that two-hop connection; Docker only needs
to run on macstudiolinux. Press F5 with the existing **Launch Extension**
configuration to debug the extension. The editor should meet `engines.vscode`
in `package.json` (currently `^1.115.0`).

The bind mount makes changes visible both in the remote host checkout and the
container. Avoid forwarding host SSH keys or Git credentials into agent sessions.
VS Code may supply Git credentials to its remote processes, so review remotes and
push from a host terminal when you intend to publish changes. No secret is needed
to build or test this repository.

`origin` is the personal fork and `upstream` is the source repository. This
setup does not configure automatic pushes.

## Files

| Path | Purpose |
| ---- | ------- |
| `devcontainer.json` | Container spec (mounts, ports, lifecycle hooks) |
| `Dockerfile` | Image: node:22-bookworm + project tools |
| `scripts/initialize.sh` | Host-side: create agent home, seed git identity, port check |
| `scripts/post-create.sh` | First run: install Claude/Codex, seed config, project deps |
| `scripts/post-start.sh` | Every start: verify env (idempotent) |
| `scripts/devcontainer.sh` | Per-repo tool: `up`, `enter`, `status`, `stop`, `rebuild` |
| `assets/` | Seed dotfiles + agent config copied into the agent home |
