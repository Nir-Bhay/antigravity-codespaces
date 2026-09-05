# AI Agent KeepAlive: Preventing SSH Disconnects in Cursor Agent & Antigravity Agent

> **Problem:** Autonomous AI agent sessions (Cursor Agent, Antigravity Agent, Claude Code, Aider) often execute complex multi-file tasks that take 10 to 45 minutes without user keystrokes. Standard SSH connections mistake this silence for abandonment and terminate the tunnel, killing your AI agent midway.

---

## 1. Why Remote SSH Connections Drop During Agent Tasks

When an AI agent is:
1. Indexing a large repository.
2. Generating a multi-file architecture refactor.
3. Running a long end-to-end test suite or Docker build inside the remote devcontainer.

The user is not actively typing in the terminal or editor buffer. 

Default OpenSSH configurations and cloud firewalls have **idle timeout thresholds** (frequently 60 to 180 seconds). When no TCP packets flow across the socket, intermediate NAT gateways, cloud load balancers, or the remote `sshd` process sever the connection. 

When the tunnel drops:
- The remote extension host crashes.
- The AI agent's execution context is broken.
- Uncommitted code modifications may be left in an inconsistent state.

---

## 2. How Antigravity Codespaces Pro Solves This

Antigravity Codespaces Pro introduces an automated **SSH Golden Block Engine** that writes hardened configuration blocks to `~/.ssh/config` for every synchronized Codespace.

Each host entry includes explicit OpenSSH keepalive parameters:

```ssh
# CS_ENTRY:automatic-waffle-v666j4p46qxjcpq5p
Host cs.automatic-waffle-v666j4p46qxjcpq5p
  User codespace
  ProxyCommand "C:/Program Files/GitHub CLI/gh.exe" cs ssh -c "automatic-waffle-v666j4p46qxjcpq5p" --stdio
  IdentityFile "C:/Users/lenovo/.ssh/codespaces.auto"
  UserKnownHostsFile /dev/null
  StrictHostKeyChecking no
  LogLevel quiet
  ServerAliveInterval 30
  ServerAliveCountMax 10
  TCPKeepAlive yes
# END_CS_ENTRY:automatic-waffle-v666j4p46qxjcpq5p
```

### Key Parameters Explained:
1. **`ServerAliveInterval 30`**: The local SSH client sends a zero-payload heartbeat packet to the remote container every 30 seconds of inactivity.
2. **`ServerAliveCountMax 10`**: If a transient network glitch occurs, the client retries up to 10 consecutive heartbeats (300 seconds of tolerance) before dropping the socket.
3. **`TCPKeepAlive yes`**: Enables operating-system-level TCP probes on the underlying transport layer.

---

## 3. Recommended Settings for Ultra-Long Agent Workflows

If you regularly run autonomous agent tasks lasting over an hour or work on unstable Wi-Fi / cellular connections, you can tune these parameters directly in settings:

Open `settings.json` (`Ctrl+,`):

```json
{
  "antigravity-codespaces.serverAliveInterval": 15,
  "antigravity-codespaces.serverAliveCountMax": 20,
  "antigravity-codespaces.autoSyncSSHOnStartup": true
}
```

Then run `Ctrl+Shift+P` → **Antigravity Codespaces: Sync SSH Config** to rewrite your active host blocks with the updated values.

---

## 4. Best Practices for Running Autonomous Agents in Codespaces

1. **Commit Early, Commit Often**: Ensure your agent makes granular atomic git commits during each phase of its plan.
2. **Pre-build Your DevContainers**: Add tools needed by your agents (e.g. `rg` ripgrep, `fd`, `git`, package managers) directly into `.devcontainer/devcontainer.json` so the agent doesn't waste time installing them at runtime.
3. **Inspect Real Tunnel Latency**: Use the built-in **Test SSH Connectivity** tool (`Alt+C` or sidebar) to ensure your round-trip latency to the GitHub data center is under 120ms for smooth interactive streaming.

---

## Conclusion
By eliminating idle socket timeouts, **Antigravity Codespaces Pro** turns GitHub Codespaces into a dependable cloud execution sandbox for the next generation of autonomous AI coding assistants.
