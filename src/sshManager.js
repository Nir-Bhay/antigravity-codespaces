let vscode;
try { vscode = require('vscode'); } catch {}
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { runCommand, runCommandWithDetails } = require('./utils');

const SSH_DIR = path.join(os.homedir(), '.ssh');
const SSH_CONFIG_PATH = path.join(SSH_DIR, 'config');

const EXTENSION_DATA_DIR = path.join(os.homedir(), '.antigravity-codespaces');
const MANAGED_KNOWN_HOSTS_PATH = path.join(EXTENSION_DATA_DIR, 'known_hosts');

let _configLogger = null;

/**
 * Sets the logger used for SSH config mutations. Called once from extension.js
 * with a shared 'Codespaces' output channel.
 */
function setConfigLogger(logger) {
    _configLogger = logger;
}

/**
 * Logs timestamped SSH config mutations to the shared output channel.
 */
function logConfigMutation(action, details) {
    if (!_configLogger) return;
    const timestamp = new Date().toISOString();
    try {
        _configLogger.appendLine(`[${timestamp}] [SSH Config] ${action}`);
        if (details) {
            _configLogger.appendLine(details);
        }
        _configLogger.appendLine('');
    } catch {}
}

/**
 * Allows tests to redirect SSH config writes without touching the real file.
 * Production code never sets this variable.
 */
function getSshConfigPath() {
    return process.env.ANTIGRAVITY_SSH_CONFIG || SSH_CONFIG_PATH;
}

/**
 * Returns the path to the extension-managed known_hosts file.
 * Allows tests to override via environment variable.
 */
function getManagedKnownHostsPath() {
    return process.env.ANTIGRAVITY_KNOWN_HOSTS || MANAGED_KNOWN_HOSTS_PATH;
}

/**
 * Ensures the extension data directory and managed known_hosts file exist.
 * Creates them with appropriate permissions if missing.
 */
function ensureManagedKnownHosts() {
    const knownHostsPath = getManagedKnownHostsPath();
    const dataDir = path.dirname(knownHostsPath);
    try {
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
        }
        if (!fs.existsSync(knownHostsPath)) {
            fs.writeFileSync(knownHostsPath, '', { mode: 0o600 });
        }
        return knownHostsPath;
    } catch (err) {
        console.error('Failed to create managed known_hosts:', err);
        return knownHostsPath;
    }
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

/**
 * Removes stale pre-v5.0.1 artifacts from an ssh config text WITHOUT touching
 * anything else. Pure function (no file I/O) so it is fully unit-testable.
 *
 * Drops exactly two provably-ours kinds of leftovers:
 *  1. `IdentityFile …codespaces.auto` lines — that key file was never created
 *     (historic BUG-06); OpenSSH wastes time on the missing key and old
 *     ProxyCommand lines even forwarded it via `-- -i`.
 *  2. Unmarked legacy `Host` blocks whose ProxyCommand invokes `gh cs ssh`
 *     (pre-marker generations). Marked `# CS_ENTRY:` blocks are left alone —
 *     `ensureSSHConfigEntry` migrates those itself on sync.
 *
 * User blocks (github.com, custom hosts, …) never match the `gh cs ssh`
 * signature and are always preserved.
 *
 * Returns { cfg, removedBlocks, removedKeys }.
 */
function purgeLegacyBlocks(cfgText) {
    let cfg = String(cfgText || '');
    let removedBlocks = 0;
    let removedKeys = 0;

    // Unmarked legacy blocks with a `gh cs ssh` ProxyCommand.
    // A `# CS_ENTRY:` … `# END_CS_ENTRY:` region is skipped wholesale ONLY when
    // the matching END marker exists ahead; marker-less (v5.0.0-era) regions fall
    // through so their inner Host lines are judged on their own merits.
    const isMarker = (l) => /^\s*#\s*(END_)?CS_ENTRY:/.test(l);
    const isEndMarker = (l) => /^\s*#\s*END_CS_ENTRY:/.test(l);
    const isHost = (l) => /^\s*Host\s+/i.test(l);
    const lines = cfg.split(/\r?\n/);
    const out = [];
    let i = 0;
    while (i < lines.length) {
        if (isMarker(lines[i]) && !isEndMarker(lines[i])) {
            // Look ahead for the MATCHING end marker (same codespace name).
            // A foreign END marker (different block) must not legitimize this region.
            const startName = lines[i].trim().replace(/^#\s*CS_ENTRY:\s*/, '').split(/\s/)[0];
            const wantEnd = `# END_CS_ENTRY:${startName}`;
            let k = i + 1;
            while (k < lines.length && lines[k].trim() !== wantEnd) k++;
            if (k < lines.length) {
                // Complete marked region — preserve verbatim.
                while (i <= k) out.push(lines[i++]);
                continue;
            }
            // Marker-less legacy region: fall through to line-by-line handling.
            out.push(lines[i++]);
            continue;
        }
        if (isHost(lines[i])) {
            let j = i + 1;
            while (j < lines.length && !isHost(lines[j]) && !isMarker(lines[j])) j++;
            const block = lines.slice(i, j).join('\n');
            if (/ProxyCommand.*\bgh(\.exe)?["']?\s+cs\s+ssh\b/i.test(block)) {
                removedBlocks++;
                // Drop an orphaned `# CS_ENTRY:` marker that introduced this block.
                if (out.length && /^#\s*CS_ENTRY:/.test(out[out.length - 1].trim())) out.pop();
                i = j;
                continue;
            }
        }
        out.push(lines[i]);
        i++;
    }
    // Collapse 3+ consecutive blank lines left behind by removals.
    cfg = out.join('\n').replace(/\n{4,}/g, '\n\n\n');

    return { cfg, removedBlocks, removedKeys };
}

/**
 * Backs up and cleans the real ssh config file. Returns counts so callers can
 * report them. Never throws — returns { cleaned: false } on any I/O problem.
 */
function cleanSshConfigFile() {
    try {
        const sshConfigPath = getSshConfigPath();
        if (!fs.existsSync(sshConfigPath)) return { cleaned: true, removedBlocks: 0, removedKeys: 0 };
        const original = fs.readFileSync(sshConfigPath, 'utf8');
        const { cfg, removedBlocks, removedKeys } = purgeLegacyBlocks(original);
        if (!removedBlocks && !removedKeys) return { cleaned: true, removedBlocks: 0, removedKeys: 0 };
        try {
            fs.copyFileSync(sshConfigPath, `${sshConfigPath}.pre-cleanup.bak`);
        } catch {}
        const tmpPath = `${sshConfigPath}.tmp`;
        fs.writeFileSync(tmpPath, cfg, 'utf8');
        try { fs.chmodSync(tmpPath, 0o600); } catch {}
        fs.renameSync(tmpPath, sshConfigPath);
        return { cleaned: true, removedBlocks, removedKeys };
    } catch (err) {
        console.error('SSH config cleanup error:', err);
        return { cleaned: false, removedBlocks: 0, removedKeys: 0 };
    }
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
 * Builds an SSH config block for a Codespace. Pure function — no I/O.
 * @param {Object} opts - Configuration options
 * @param {string} opts.codespace - Codespace name (validated)
 * @param {string} opts.hostAliases - Space-separated host aliases
 * @param {string} opts.ghExePath - Normalized path to gh executable
 * @param {string} [opts.identityFile] - Optional path to identity file
 * @param {string} [opts.knownHostsFile] - Path to known_hosts file
 * @param {string} [opts.strictHostKeyChecking='accept-new'] - accept-new|yes|no
 * @param {string} [opts.logLevel='ERROR'] - quiet|error|info|verbose
 * @param {number} [opts.serverAliveInterval=30] - SSH keepalive interval
 * @param {number} [opts.serverAliveCountMax=10] - Max keepalive probes
 * @returns {string} The SSH config block text
 */
function buildSshConfigBlock(opts) {
    const {
        codespace,
        hostAliases,
        ghExePath,
        identityFile,
        knownHostsFile,
        strictHostKeyChecking = 'accept-new',
        logLevel = 'ERROR',
        serverAliveInterval = 30,
        serverAliveCountMax = 10
    } = opts;

    const blockId = `# CS_ENTRY:${codespace}`;
    const endMarker = `# END_CS_ENTRY:${codespace}`;

    const identityLine = identityFile ? `  IdentityFile "${identityFile}"\n` : '';
    const effectiveKnownHostsFile = knownHostsFile || getManagedKnownHostsPath().replace(/\\/g, '/');
    const knownHostsLine = `  UserKnownHostsFile "${effectiveKnownHostsFile}"`;

    return `
${blockId}
Host ${hostAliases}
  User codespace
  ProxyCommand "${ghExePath}" cs ssh -c "${codespace}" --stdio
${identityLine}${knownHostsLine}
  StrictHostKeyChecking ${strictHostKeyChecking}
  LogLevel ${logLevel}
  ServerAliveInterval ${serverAliveInterval}
  ServerAliveCountMax ${serverAliveCountMax}
  TCPKeepAlive yes
${endMarker}
`.trim();
}

/**
 * Ensures ~/.ssh/config contains a clean, deduplicated Host entry for the Codespace.
 * Safety: Codespace names are allowlist-validated (no injection), old blocks are
 * stripped with an escaped regex, writes are atomic (tmp + rename) with a .bak
 * backup, and keepalive values are clamped to sane ranges.
 * 
 * Uses extension-managed known_hosts for host key verification (TOFU with accept-new).
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
        const aliasBase = ownerShort ? `cs-${safeAccount}-${ownerShort}-${repoShort}` : `cs-${safeAccount}-${repoShort}`;
        const aliasLower = aliasBase.toLowerCase();
        const aliasExact = aliasBase;
        const exactHost = `cs.${safeName}`;
        const hostAliases = `${exactHost} ${aliasLower} ${aliasExact} ${safeName}`;

        const ghExe = findGhExecutable();
        const normalizedGhExe = ghExe.replace(/\\/g, '/');

        const sshConfigPath = getSshConfigPath();
        let cfg = fs.existsSync(sshConfigPath) ? fs.readFileSync(sshConfigPath, 'utf8') : '';
        const blockId = `# CS_ENTRY:${safeName}`;
        const endMarker = `# END_CS_ENTRY:${safeName}`;

        // Extract previous block for logging (before removal)
        let previousBlock = null;
        const prevBlockMatch = cfg.match(new RegExp(`${escapeRegExp(blockId)}[\\s\\S]*?${escapeRegExp(endMarker)}`));
        if (prevBlockMatch) {
            previousBlock = prevBlockMatch[0];
        }

        // Read settings with defaults
        let aliveInterval = 30;
        let aliveMax = 10;
        let strictHostKeyChecking = 'accept-new';
        let sshLogLevel = 'ERROR';
        try {
            const config = vscode.workspace.getConfiguration('antigravity-codespaces');
            const rawInterval = Number(config.get('serverAliveInterval', 30));
            const rawMax = Number(config.get('serverAliveCountMax', 10));
            if (Number.isFinite(rawInterval)) aliveInterval = Math.min(300, Math.max(5, Math.trunc(rawInterval)));
            if (Number.isFinite(rawMax)) aliveMax = Math.min(100, Math.max(1, Math.trunc(rawMax)));
            
            const rawStrictCheck = config.get('strictHostKeyChecking', 'accept-new');
            if (['accept-new', 'yes', 'no'].includes(rawStrictCheck)) {
                strictHostKeyChecking = rawStrictCheck;
            }
            
            const rawLogLevel = String(config.get('sshLogLevel', 'error')).toUpperCase();
            if (['QUIET', 'ERROR', 'INFO', 'VERBOSE'].includes(rawLogLevel)) {
                sshLogLevel = rawLogLevel;
            }
        } catch {}

        // Ensure managed known_hosts exists and get its path
        const knownHostsPath = ensureManagedKnownHosts().replace(/\\/g, '/');

        const autoKeyPath = path.join(SSH_DIR, 'codespaces.auto').replace(/\\/g, '/');
        const identityFile = fs.existsSync(path.join(SSH_DIR, 'codespaces.auto')) ? autoKeyPath : null;

        const newBlock = buildSshConfigBlock({
            codespace: safeName,
            hostAliases,
            ghExePath: normalizedGhExe,
            identityFile,
            knownHostsFile: knownHostsPath,
            strictHostKeyChecking,
            logLevel: sshLogLevel,
            serverAliveInterval: aliveInterval,
            serverAliveCountMax: aliveMax
        });

        // Strip any previous entry for this Codespace
        const newFormatRegex = new RegExp(`\\n*${escapeRegExp(blockId)}[\\s\\S]*?${escapeRegExp(endMarker)}[^\\n]*`, 'g');
        cfg = cfg.replace(newFormatRegex, '');
        if (cfg.includes(blockId)) {
            const legacyRegex = new RegExp(`\\n*${escapeRegExp(blockId)}[\\s\\S]*?TCPKeepAlive yes[^\\n]*`, 'g');
            cfg = cfg.replace(legacyRegex, '');
        }

        cfg = cfg.trim() + '\n\n' + newBlock + '\n';

        // Backup + atomic write
        const tmpPath = sshConfigPath + '.tmp';
        try {
            if (fs.existsSync(sshConfigPath)) {
                fs.copyFileSync(sshConfigPath, sshConfigPath + '.bak');
            }
        } catch {}
        fs.writeFileSync(tmpPath, cfg, 'utf8');
        try { fs.chmodSync(tmpPath, 0o600); } catch {}
        fs.renameSync(tmpPath, sshConfigPath);

        // Log the mutation
        if (previousBlock) {
            logConfigMutation(`Updated SSH block for ${safeName}`, `BEFORE:\n${previousBlock}\n\nAFTER:\n${newBlock}`);
        } else {
            logConfigMutation(`Created SSH block for ${safeName}`, `NEW BLOCK:\n${newBlock}`);
        }

        return exactHost;
    } catch (err) {
        console.error('SSH config generation error:', err);
        return `cs.${safeName}`;
    }
}

/**
 * Performs a non-destructive SSH tunnel probe and measures roundtrip latency.
 * Returns { latency, stderr, exitCode } on success, or throws with mapped error details.
 * 
 * @param {string} csName - The codespace name
 * @param {string} [token] - Optional GH_TOKEN for authentication
 * @returns {Promise<{latency: number, stderr?: string, exitCode?: number}>}
 */
async function testSshTunnel(csName, token) {
    const safeName = sanitizeCsName(csName);
    const ghExe = findGhExecutable();
    const envOpts = token ? { env: { ...process.env, GH_TOKEN: token } } : {};
    const start = Date.now();
    
    const result = await runCommandWithDetails(
        ghExe, 
        ['cs', 'ssh', '-c', safeName, '--', 'echo', 'ping_ok'], 
        20000, 
        envOpts
    );
    
    const latency = Date.now() - start;
    
    if (result.exitCode !== 0) {
        const mapped = mapTunnelError(result.stderr, result.exitCode, `cs.${safeName}`);
        const err = new Error(mapped.message);
        err.stderr = result.stderr;
        err.exitCode = result.exitCode;
        err.mappedError = mapped;
        throw err;
    }
    
    return { latency, stderr: result.stderr, exitCode: result.exitCode };
}

/**
 * SSH tunnel probe that returns the proxy tunnel's captured stderr on failure,
 * so callers can sniff exact causes (gh auth problems, platform mismatch) and
 * show actionable guidance instead of a bare "exit 255 / nonexistent pipe".
 *
 * Resolve shape: { latencyMs }
 * Reject shape:  Error with .stderr (raw tunnel stderr, may be empty).
 */
async function probeSshTunnelVerbose(csName, token) {
    const safeName = sanitizeCsName(csName);
    const ghExe = findGhExecutable();
    const envOpts = token ? { env: { ...process.env, GH_TOKEN: token } } : {};
    const start = Date.now();
    try {
        await runCommand(ghExe, ['cs', 'ssh', '-c', safeName, '--', 'echo', 'ping_ok'], 20000, envOpts);
        return { latencyMs: Date.now() - start };
    } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        // runCommand already embeds stderr at the front of its error message
        // (detail = stderr || stdout || err.message); expose it separately for sniffing.
        e.stderr = String((err && err.message) || '');
        throw e;
    }
}

/**
 * Returns the GitHub CLI's currently active username (`gh api user --jq .login`,
 * clean JSON — no fragile `auth status` parsing). Null when gh is missing or
 * the check fails; callers must fail open (never block on this).
 */
async function getGhActiveUser() {
    try {
        const ghExe = findGhExecutable();
        const raw = await runCommand(ghExe, ['api', 'user', '--jq', '.login'], 8000);
        const login = (raw || '').split(/\s+/)[0].trim();
        return login || null;
    } catch {
        return null;
    }
}

/**
 * Pure parser for `gh auth status` output. Splits it into per-account blocks
 * ("Logged in to <host> account <user>" / legacy "Logged in to <host> as <user>")
 * and returns the lowercase scope list of the block whose login EXACTLY equals
 * `user` (case-insensitive) — so "bob" never picks up "bobby"'s scopes and a
 * later account's scopes never leak into an earlier one's.
 * Returns null when no block / no "Token scopes" line exists for that user.
 */
function parseGhAuthStatusScopes(text, user) {
    const raw = String(text || '');
    const want = String(user || '').toLowerCase();
    if (!want) return null;
    const header = /Logged in to \S+ (?:account|as) ([A-Za-z0-9-]+)/g;
    const marks = [];
    let m;
    while ((m = header.exec(raw)) !== null) marks.push({ user: m[1].toLowerCase(), start: m.index });
    for (let i = 0; i < marks.length; i++) {
        if (marks[i].user !== want) continue;
        const block = raw.slice(marks[i].start, i + 1 < marks.length ? marks[i + 1].start : raw.length);
        const sm = block.match(/Token scopes:\s*(.*)$/im);
        if (!sm) return null;
        return (sm[1].match(/[A-Za-z0-9:_-]+/g) || [])
            .map(x => x.toLowerCase())
            .filter(x => x !== 'none');
    }
    return null;
}

/**
 * Checks the gh CLI's auth health in one round-trip.
 *
 * `gh cs ssh` authenticates with the CLI's OWN keyring token, which is fully
 * separate from the extension's OAuth/PAT session. When the CLI is logged out
 * or its token lacks the `codespace` scope, the tunnel dies instantly with an
 * opaque exit 255 ("The process tried to write to a nonexistent pipe") that
 * gives the user no actionable guidance (see issues #3/#4). This probe lets
 * the Connect preflight detect those states BEFORE launching SSH.
 *
 * Returns one of:
 *   { state: 'missing' }                 – gh CLI not found on PATH
 *   { state: 'logged_out' }              – no authenticated accounts
 *   { state: 'scope_missing' }           – logged in, but token lacks `codespace`
 *   { state: 'ok', user }                – healthy, active login returned
 *   { state: 'unknown' }                 – probe failed unexpectedly; fail open
 */
async function getGhAuthHealth(deps = {}) {
    const findGh = deps.findGhExecutable || findGhExecutable;
    const run = deps.runCommand || runCommand;
    let ghExe;
    try {
        ghExe = findGh();
    } catch {
        return { state: 'missing' };
    }
    if (!ghExe) return { state: 'missing' };

    // Sanity probe: a logged-out CLI fails here with a unmistakable message.
    let loggedInUser = null;
    let probeStderr = '';
    try {
        const raw = await run(ghExe, ['api', 'user', '--jq', '.login'], 8000);
        loggedInUser = (raw || '').split(/\s+/)[0].trim() || null;
    } catch (err) {
        probeStderr = (err && err.message) || '';
        if (/not logged into any GitHub hosts|gh auth login/i.test(probeStderr)) {
            return { state: 'logged_out' };
        }
        // gh missing/unreachable surfaces as command-not-found/ENOENT from runCommand
        if (/not recognized|ENOENT|command not found/i.test(probeStderr)) {
            return { state: 'missing' };
        }
        // Anything else (network flap, etc.) → fail open.
        return { state: 'unknown' };
    }

    if (!loggedInUser) return { state: 'unknown' };

    // Scope check: `gh auth status` prints scopes per account. It succeeds even
    // when another account is active, so anchor it to the active login.
    // NOTE: gh auth status exits 0 and prints to stdout when healthy; scopes
    // appear as `Token scopes: 'a', 'b', ...`. Parse permissively (case- and
    // quote-insensitive) so future gh verbosity changes don't break detection.
    let scopes = '';
    try {
        const status = await run(ghExe, ['auth', 'status'], 8000);
        scopes = String(status || '');
    } catch (err) {
        // gh auth status can exit non-zero yet still print account info on stdout;
        // stderr from runCommand errors carries the same text, so mine it too.
        scopes = String((err && err.message) || '');
    }
    const scopeList = parseGhAuthStatusScopes(scopes, loggedInUser);
    // null → no parseable scope line for this account (fine-grained PAT,
    // GH_TOKEN env var, future gh output change): fail open, never block.
    if (scopeList === null) return { state: 'ok', user: loggedInUser, scopesUnknown: true };
    if (!scopeList.includes('codespace')) {
        return { state: 'scope_missing', user: loggedInUser };
    }
    return { state: 'ok', user: loggedInUser };
}

/**
 * Removes a host entry from the extension-managed known_hosts file.
 * Used when REMOTE HOST IDENTIFICATION HAS CHANGED error is detected.
 * @param {string} host - The host pattern to remove
 * @returns {boolean} True if removal was attempted
 */
function removeHostFromManagedKnownHosts(host) {
    try {
        const knownHostsPath = getManagedKnownHostsPath();
        if (!fs.existsSync(knownHostsPath)) return false;
        
        const content = fs.readFileSync(knownHostsPath, 'utf8');
        const lines = content.split(/\r?\n/);
        const filtered = lines.filter(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return true;
            const hostPart = trimmed.split(/\s+/)[0] || '';
            return !hostPart.includes(host);
        });
        
        const newContent = filtered.join('\n');
        if (newContent !== content) {
            fs.writeFileSync(knownHostsPath, newContent, { mode: 0o600 });
            logConfigMutation(`Removed host key for ${host}`, `Removed from managed known_hosts`);
            return true;
        }
        return false;
    } catch (err) {
        console.error('Failed to remove host from known_hosts:', err);
        return false;
    }
}

/**
 * Maps SSH tunnel/test errors to user-friendly messages with actionable guidance.
 * Pure function — no I/O or side effects. Uses isPlatformMismatchError from
 * connectPreflight.js when available.
 * 
 * @param {string} stderr - The stderr output from the failed command
 * @param {number} exitCode - The exit code of the failed command
 * @param {string} [host] - The host being connected to (for host key errors)
 * @returns {Object} { message: string, action?: string, actionType?: string }
 *   - message: User-friendly error description
 *   - action: Suggested fix command or action
 *   - actionType: 'terminal_command' | 'remove_host_key' | 'check_platform' | null
 */
function mapTunnelError(stderr, exitCode, host) {
    const stderrLower = (stderr || '').toLowerCase();
    const stderrRaw = stderr || '';

    // Use isPlatformMismatchError from connectPreflight (reuse teammate's logic)
    let isPlatformMismatch = false;
    try {
        const { isPlatformMismatchError } = require('./connectPreflight');
        isPlatformMismatch = isPlatformMismatchError({ stderr: stderrRaw, code: exitCode, message: stderrRaw }, host);
    } catch {
        // connectPreflight not available, fall back to basic detection
        isPlatformMismatch = (exitCode === 127 || stderrLower.includes('command not found')) &&
            (stderrLower.includes('powershell') || stderrLower.includes('bash'));
    }

    // Order matters: check most specific patterns first

    // 1. gh CLI not logged in
    if (stderrLower.includes('gh auth login') || 
        stderrLower.includes('not logged into any github hosts')) {
        return {
            message: 'GitHub CLI is not logged in. You need to authenticate before connecting.',
            action: 'gh auth login -s codespace',
            actionType: 'terminal_command'
        };
    }

    // 2. Missing codespace scope (check BEFORE generic 403/permission errors)
    if (stderrLower.includes('needs the "codespace" scope') ||
        stderrLower.includes('must have admin rights')) {
        return {
            message: 'GitHub CLI token is missing the "codespace" scope required for SSH tunneling.',
            action: 'gh auth refresh -h github.com -s codespace',
            actionType: 'terminal_command'
        };
    }

    // 3. Platform mismatch (exit 127 with command not found)
    if (isPlatformMismatch) {
        return {
            message: 'Remote platform mismatch: the IDE is trying to run Windows commands on a Linux codespace (or vice versa). Check remote.SSH.remotePlatform setting.',
            action: host ? `Check remote.SSH.remotePlatform["${host}"] — codespaces are Linux` : 'Check remote.SSH.remotePlatform setting',
            actionType: 'check_platform'
        };
    }

    // 4. Host key changed (MITM warning)
    if (stderrRaw.includes('REMOTE HOST IDENTIFICATION HAS CHANGED') ||
        stderrRaw.includes('HOST IDENTIFICATION HAS CHANGED') ||
        stderrRaw.includes('host key verification failed')) {
        return {
            message: 'The remote host key has changed. This can happen when a codespace is rebuilt. The old key can be removed from the managed known_hosts file.',
            action: host || 'the codespace host',
            actionType: 'remove_host_key'
        };
    }

    // 5. Tunnel died immediately (exit 255 or nonexistent pipe)
    if (exitCode === 255 || 
        stderrLower.includes('nonexistent pipe') ||
        stderrLower.includes('connection closed')) {
        return {
            message: 'SSH tunnel terminated immediately. This usually indicates a gh CLI authentication problem or the codespace is not running.',
            action: 'Run "Test SSH Connectivity" for details, or check gh auth status',
            actionType: 'terminal_command'
        };
    }

    // 6. Connection timeout
    if (stderrLower.includes('timed out') || stderrLower.includes('connection timed out')) {
        return {
            message: 'Connection timed out. The codespace may be starting up or there may be network issues.',
            action: null,
            actionType: null
        };
    }

    // 7. Generic connection refused
    if (stderrLower.includes('connection refused')) {
        return {
            message: 'Connection refused. The codespace may not be running or SSH service is not available.',
            action: null,
            actionType: null
        };
    }

    // Default: return the stderr as-is with generic guidance
    return {
        message: stderr ? `SSH error: ${stderr.slice(0, 300)}${stderr.length > 300 ? '...' : ''}` : 'SSH connection failed with no error details.',
        action: null,
        actionType: null
    };
}

module.exports = {
    findGhExecutable,
    findAntigravityExecutable,
    ensureSSHConfigEntry,
    testSshTunnel,
    probeSshTunnelVerbose,
    sanitizeCsName,
    purgeLegacyBlocks,
    cleanSshConfigFile,
    getGhActiveUser,
    getGhAuthHealth,
    parseGhAuthStatusScopes,
    getSshConfigPath,
    getManagedKnownHostsPath,
    ensureManagedKnownHosts,
    buildSshConfigBlock,
    mapTunnelError,
    removeHostFromManagedKnownHosts,
    setConfigLogger,
    SSH_DIR,
    SSH_CONFIG_PATH,
    EXTENSION_DATA_DIR,
    MANAGED_KNOWN_HOSTS_PATH
};
