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
 * Allows tests to redirect SSH config writes without touching the real file.
 * Production code never sets this variable.
 */
function getSshConfigPath() {
    return process.env.ANTIGRAVITY_SSH_CONFIG || SSH_CONFIG_PATH;
}

/**
 * Strict allowlist for Codespace names used inside ~/.ssh/config.
 * GitHub generates names like `musical-xylophone-abc123`; anything outside this
 * charset (quotes, newlines, shell/SSH metacharacters) is rejected so a hostile
 * or corrupt API response can never inject directives into the SSH config.
 */
const CS_NAME_ALLOWLIST = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

function sanitizeCsName(name) {
    const s = String(name || '').trim();
    if (!CS_NAME_ALLOWLIST.test(s) || s.length > 128) {
        throw new Error(`Refusing to write SSH config for unexpected Codespace name: ${JSON.stringify(s.slice(0, 60))}`);
    }
    return s;
}

function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Memoized gh discovery: execSync on every call was blocking the event loop
// on auth/API hot paths.
let _ghExeCache = null;
function _findGhExecutableUncached() {
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
 * Memoized GitHub CLI discovery (async-safe: sync exec, cached after first hit).
 */
function findGhExecutable() {
    if (!_ghExeCache) _ghExeCache = _findGhExecutableUncached();
    return _ghExeCache;
}

/**
 * Discovers Antigravity IDE CLI launcher dynamically via PATH discovery and common paths.
 */
function findAntigravityExecutable() {
    const platform = process.platform;

    // 1. Try system PATH first (checks antigravity-ide, antigravity, and code)
    const cliNames = platform === 'win32'
        ? ['antigravity-ide.cmd', 'antigravity.cmd', 'antigravity-ide', 'antigravity', 'code.cmd']
        : ['antigravity-ide', 'antigravity', 'code'];

    for (const name of cliNames) {
        try {
            const checkCmd = platform === 'win32' ? `where.exe "${name}" 2>nul` : `which "${name}" 2>/dev/null`;
            const result = execSync(checkCmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
            const firstPath = result.split(/\r?\n/)[0].trim();
            if (firstPath && fs.existsSync(firstPath)) return firstPath;
        } catch {}
    }

    // 2. Windows specific candidate directories
    if (platform === 'win32') {
        const candidates = [
            path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Antigravity IDE', 'bin', 'antigravity-ide.cmd'),
            path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Antigravity', 'bin', 'antigravity.cmd'),
            path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Antigravity IDE', 'bin', 'antigravity-ide.cmd'),
            path.join(process.env['ProgramFiles(x86)'] || '', 'Antigravity IDE', 'bin', 'antigravity-ide.cmd'),
            'C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd'
        ];
        for (const p of candidates) {
            if (p && fs.existsSync(p)) return p;
        }
        return 'antigravity-ide.cmd';
    }

    // 3. macOS specific candidate directories
    if (platform === 'darwin') {
        const macCandidates = [
            '/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide',
            '/Applications/Antigravity.app/Contents/Resources/app/bin/antigravity',
            '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'
        ];
        for (const p of macCandidates) {
            if (fs.existsSync(p)) return p;
        }
        return 'antigravity-ide';
    }

    // 4. Linux specific candidate directories
    const linuxCandidates = [
        '/usr/bin/antigravity-ide',
        '/usr/local/bin/antigravity-ide',
        '/usr/bin/antigravity',
        '/usr/bin/code'
    ];
    for (const p of linuxCandidates) {
        if (p && fs.existsSync(p)) return p;
    }
    return 'antigravity-ide';
}

/**
 * Ensures ~/.ssh/config contains a clean, deduplicated Host entry for the Codespace.
 * Safety: Codespace names are allowlist-validated (no injection), old blocks are
 * stripped with an escaped regex, writes are atomic (tmp + rename) with a .bak
 * backup, and keepalive values are clamped to sane ranges.
 */
function ensureSSHConfigEntry(cs, account) {
    const safeName = sanitizeCsName(cs && cs.name);
    try {
        const sshDir = path.dirname(getSshConfigPath());
        if (!fs.existsSync(sshDir)) {
            fs.mkdirSync(sshDir, { recursive: true, mode: 0o700 });
        }

        const safeAccount = (account || cs.account || 'default').replace(/[^a-zA-Z0-9_-]/g, '-');
        const repoFull = String(cs.repository || '');
        const repoParts = repoFull.split('/').filter(Boolean);
        const ownerShort = (repoParts.length >= 2 ? repoParts[0] : '').replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
        const repoShort = ((cs.repository || cs.name).split('/').pop() || 'workspace').replace(/[^a-zA-Z0-9_-]/g, '-');
        // Include the owner to avoid alias collisions for same-named repos under
        // different owners on the same account (e.g. ownerA/app vs ownerB/app).
        const aliasBase = ownerShort ? `cs-${safeAccount}-${ownerShort}-${repoShort}` : `cs-${safeAccount}-${repoShort}`;
        const aliasLower = aliasBase.toLowerCase();
        const aliasExact = aliasBase;
        const exactHost = `cs.${safeName}`;

        const ghExe = findGhExecutable();
        // Forward slashes prevent backslash escape issues inside OpenSSH config
        const normalizedGhExe = ghExe.replace(/\\/g, '/');

        const sshConfigPath = getSshConfigPath();
        let cfg = fs.existsSync(sshConfigPath) ? fs.readFileSync(sshConfigPath, 'utf8') : '';
        const blockId = `# CS_ENTRY:${safeName}`;
        const endMarker = `# END_CS_ENTRY:${safeName}`;

        let aliveInterval = 30;
        let aliveMax = 10;
        try {
            const config = vscode.workspace.getConfiguration('antigravity-codespaces');
            const rawInterval = Number(config.get('serverAliveInterval', 30));
            const rawMax = Number(config.get('serverAliveCountMax', 10));
            if (Number.isFinite(rawInterval)) aliveInterval = Math.min(300, Math.max(5, Math.trunc(rawInterval)));
            if (Number.isFinite(rawMax)) aliveMax = Math.min(100, Math.max(1, Math.trunc(rawMax)));
        } catch {}

        const newBlock = `
${blockId}
Host ${exactHost} ${aliasLower} ${aliasExact} ${safeName}
  User codespace
  ProxyCommand "${normalizedGhExe}" cs ssh -c "${safeName}" --stdio
  UserKnownHostsFile /dev/null
  StrictHostKeyChecking no
  LogLevel quiet
  ServerAliveInterval ${aliveInterval}
  ServerAliveCountMax ${aliveMax}
  TCPKeepAlive yes
${endMarker}
`;

        // Strip any previous entry for this Codespace: new end-marker format first,
        // then the legacy format (ends at the TCPKeepAlive line) for migration.
        const newFormatRegex = new RegExp(`\\n*${escapeRegExp(blockId)}[\\s\\S]*?${escapeRegExp(endMarker)}[^\\n]*`, 'g');
        cfg = cfg.replace(newFormatRegex, '');
        if (cfg.includes(blockId)) {
            const legacyRegex = new RegExp(`\\n*${escapeRegExp(blockId)}[\\s\\S]*?TCPKeepAlive yes[^\\n]*`, 'g');
            cfg = cfg.replace(legacyRegex, '');
        }

        cfg = cfg.trim() + '\n\n' + newBlock.trim() + '\n';
        // Backup + atomic write: temp file + rename prevents corruption on crash.
        const tmpPath = sshConfigPath + '.tmp';
        try {
            if (fs.existsSync(sshConfigPath)) {
                fs.copyFileSync(sshConfigPath, sshConfigPath + '.bak');
            }
        } catch {}
        fs.writeFileSync(tmpPath, cfg, 'utf8');
        try { fs.chmodSync(tmpPath, 0o600); } catch {}
        fs.renameSync(tmpPath, sshConfigPath);

        return exactHost;
    } catch (err) {
        console.error('SSH config generation error:', err);
        return `cs.${safeName}`;
    }
}

/**
 * Performs a non-destructive SSH tunnel probe and measures roundtrip latency.
 */
async function testSshTunnel(csName, token) {
    const safeName = sanitizeCsName(csName);
    const ghExe = findGhExecutable();
    const envOpts = token ? { env: { ...process.env, GH_TOKEN: token } } : {};
    const start = Date.now();
    await runCommand(ghExe, ['cs', 'ssh', '-c', safeName, '--', 'echo', 'ping_ok'], 20000, envOpts);
    return Date.now() - start;
}

module.exports = {
    findGhExecutable,
    findAntigravityExecutable,
    ensureSSHConfigEntry,
    testSshTunnel,
    sanitizeCsName,
    getSshConfigPath,
    SSH_DIR,
    SSH_CONFIG_PATH
};
