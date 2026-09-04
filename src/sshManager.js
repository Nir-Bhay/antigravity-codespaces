let vscode;
try { vscode = require('vscode'); } catch {}
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { runCommand } = require('./utils');

const SSH_DIR = path.join(os.homedir(), '.ssh');
const SSH_CONFIG_PATH = path.join(SSH_DIR, 'config');

/**
 * Discovers GitHub CLI executable across Windows, macOS, and Linux.
 */
function findGhExecutable() {
    const platform = process.platform;

    // 1. Try system PATH first (fast and standard)
    try {
        const checkCmd = platform === 'win32' ? 'where.exe gh 2>nul' : 'which gh 2>/dev/null';
        const result = execSync(checkCmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
        const firstPath = result.split(/\r?\n/)[0].trim();
        if (firstPath && fs.existsSync(firstPath)) return firstPath;
    } catch {}

    // 2. Windows specific candidate directories
    if (platform === 'win32') {
        const winCandidates = [
            'C:\\Program Files\\GitHub CLI\\gh.exe',
            path.join(process.env.ProgramFiles || 'C:\\Program Files', 'GitHub CLI', 'gh.exe'),
            path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'GitHub CLI', 'gh.exe'),
            path.join(process.env.LOCALAPPDATA || '', 'Programs', 'GitHub CLI', 'gh.exe'),
            path.join(os.homedir(), 'scoop', 'shims', 'gh.exe'),
            'C:\\ProgramData\\chocolatey\\bin\\gh.exe'
        ];
        for (const p of winCandidates) {
            if (p && fs.existsSync(p)) return p;
        }
        return 'gh.exe';
    }

    // 3. macOS specific candidate directories
    if (platform === 'darwin') {
        const macCandidates = [
            '/opt/homebrew/bin/gh',
            '/usr/local/bin/gh',
            path.join(os.homedir(), '.local/bin/gh')
        ];
        for (const p of macCandidates) {
            if (p && fs.existsSync(p)) return p;
        }
        return 'gh';
    }

    // 4. Linux specific candidate directories
    const linuxCandidates = [
        '/usr/bin/gh',
        '/usr/local/bin/gh',
        '/snap/bin/gh',
        path.join(os.homedir(), '.local/bin/gh')
    ];
    for (const p of linuxCandidates) {
        if (p && fs.existsSync(p)) return p;
    }
    return 'gh';
}

/**
 * Discovers Antigravity IDE CLI launcher without hardcoded user directories.
 */
function findAntigravityExecutable() {
    const platform = process.platform;
    if (platform === 'win32') {
        const candidates = [
            path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Antigravity IDE', 'bin', 'antigravity-ide.cmd'),
            path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Antigravity IDE', 'bin', 'antigravity-ide.cmd'),
            path.join(process.env['ProgramFiles(x86)'] || '', 'Antigravity IDE', 'bin', 'antigravity-ide.cmd')
        ];
        for (const p of candidates) {
            if (p && fs.existsSync(p)) return p;
        }
        return 'antigravity-ide.cmd';
    }

    if (platform === 'darwin') {
        const macPath = '/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide';
        if (fs.existsSync(macPath)) return macPath;
        return 'antigravity-ide';
    }

    const linuxCandidates = [
        '/usr/bin/antigravity-ide',
        '/usr/local/bin/antigravity-ide'
    ];
    for (const p of linuxCandidates) {
        if (p && fs.existsSync(p)) return p;
    }
    return 'antigravity-ide';
}

/**
 * Ensures ~/.ssh/config contains a clean, deduplicated Host entry for the Codespace.
 * Fixes: No non-existent IdentityFile, no hardcoded usernames, normalized slashes.
 */
function ensureSSHConfigEntry(cs, account) {
    try {
        if (!fs.existsSync(SSH_DIR)) {
            fs.mkdirSync(SSH_DIR, { recursive: true });
        }

        const safeAccount = (account || cs.account || 'default').replace(/[^a-zA-Z0-9_-]/g, '-');
        const repoShort = ((cs.repository || cs.name).split('/').pop() || 'workspace').replace(/[^a-zA-Z0-9_-]/g, '-');
        const aliasLower = `cs-${safeAccount}-${repoShort}`.toLowerCase();
        const aliasExact = `cs-${safeAccount}-${repoShort}`;
        const exactHost = `cs.${cs.name}`;
        const rawName = cs.name;

        const ghExe = findGhExecutable();
        // Forward slashes prevent backslash escape issues inside OpenSSH config
        const normalizedGhExe = ghExe.replace(/\\/g, '/');

        let cfg = fs.existsSync(SSH_CONFIG_PATH) ? fs.readFileSync(SSH_CONFIG_PATH, 'utf8') : '';
        const blockId = `# CS_ENTRY:${cs.name}`;

        let aliveInterval = 30;
        let aliveMax = 10;
        try {
            const config = vscode.workspace.getConfiguration('antigravity-codespaces');
            aliveInterval = config.get('serverAliveInterval', 30);
            aliveMax = config.get('serverAliveCountMax', 10);
        } catch {}

        const newBlock = `
${blockId}
Host ${exactHost} ${aliasLower} ${aliasExact} ${rawName}
  User codespace
  ProxyCommand "${normalizedGhExe}" cs ssh -c ${cs.name} --stdio
  UserKnownHostsFile /dev/null
  StrictHostKeyChecking no
  LogLevel quiet
  ServerAliveInterval ${aliveInterval}
  ServerAliveCountMax ${aliveMax}
  TCPKeepAlive yes
`;

        // Strip previous entry for this Codespace if present
        if (cfg.includes(blockId)) {
            const regex = new RegExp(`\\n*${blockId}[\\s\\S]*?TCPKeepAlive yes[^\\n]*`, 'g');
            cfg = cfg.replace(regex, '');
        }

        cfg = cfg.trim() + '\n\n' + newBlock.trim() + '\n';
        fs.writeFileSync(SSH_CONFIG_PATH, cfg, 'utf8');

        return exactHost;
    } catch (err) {
        console.error('SSH config generation error:', err);
        return `cs.${cs.name}`;
    }
}

/**
 * Performs a non-destructive SSH tunnel probe and measures roundtrip latency.
 */
async function testSshTunnel(csName, token) {
    const ghExe = findGhExecutable();
    const envOpts = token ? { env: { ...process.env, GH_TOKEN: token } } : {};
    const start = Date.now();
    await runCommand(ghExe, ['cs', 'ssh', '-c', csName, '--', 'echo', 'ping_ok'], 20000, envOpts);
    return Date.now() - start;
}

module.exports = {
    findGhExecutable,
    findAntigravityExecutable,
    ensureSSHConfigEntry,
    testSshTunnel,
    SSH_DIR,
    SSH_CONFIG_PATH
};
