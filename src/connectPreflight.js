/**
 * Pure, dependency-injected helpers for the Connect / Test SSH preflight
 * (issue #3 Failure 3 and the gh-switch fallback). No `vscode` import here so
 * everything is unit-testable offline; callers pass a config-like object.
 */

const PLATFORM_SETTING_SECTION = 'remote.SSH';
const PLATFORM_SETTING_KEY = 'remotePlatform';

/**
 * Ensures `remote.SSH.remotePlatform[hostAlias] === 'linux'` (Codespaces are
 * always Linux). A stale "windows"/"macOS" value makes Remote-SSH run
 * `powershell` on the Linux box → exit 127 (issue #3, Failure 3).
 *
 * deps.config:  object with get(key) and update(key, value, target) — e.g.
 *               vscode.workspace.getConfiguration('remote.SSH').
 * deps.target:  ConfigurationTarget for the write (Global = 1).
 * deps.log:     optional (msg) => void.
 *
 * Resolves { changed, previous } — never throws (a failed write is logged and
 * reported as { changed:false, error }) so Connect is never blocked by it.
 */
async function ensureLinuxRemotePlatform(hostAlias, deps) {
    const { config, target = 1, log = () => {} } = deps || {};
    if (!hostAlias || !config) return { changed: false, previous: undefined };
    let current;
    try { current = config.get(PLATFORM_SETTING_KEY); } catch { current = undefined; }
    const map = (current && typeof current === 'object' && !Array.isArray(current)) ? current : {};
    const previous = map[hostAlias];
    if (previous === 'linux') return { changed: false, previous };
    const next = { ...map, [hostAlias]: 'linux' };
    try {
        await config.update(PLATFORM_SETTING_KEY, next, target);
        log(previous === undefined
            ? `remote.SSH.remotePlatform["${hostAlias}"] set to "linux"`
            : `remote.SSH.remotePlatform["${hostAlias}"] was "${previous}" — overwritten with "linux" (Codespaces are Linux; issue #3)`);
        return { changed: true, previous };
    } catch (err) {
        log(`Could not update remote.SSH.remotePlatform["${hostAlias}"]: ${(err && err.message) || err}`);
        return { changed: false, previous, error: err };
    }
}

/**
 * True when tunnel/remote output shows a platform mismatch signature.
 * Classic case: Linux box tried to run powershell → "command not found" + exit 127.
 *
 * When `host` is provided and starts with 'cs.' (a Codespace exact-host alias),
 * a bare exit code 127 (no powershell text) also returns true — Codespaces are
 * always Linux, so any 127 on such a host is almost certainly a platform config
 * issue. Without a known-codespace host, bare 127 stays false to avoid false
 * positives on generic SSH hosts.
 */
function isPlatformMismatchError(err, host) {
    const text = [err && err.stderr, err && err.message, typeof err === 'string' ? err : '']
        .filter(Boolean).join('\n');
    const errCode = err && typeof err.code === 'number' ? err.code : null;
    if (/powershell(\.exe)?:?\s*(command )?not found|command not found:?\s*powershell/i.test(text)) return true;
    if (/exit(ed)?( with)? ?(code |status )?127\b/i.test(text) && /powershell/i.test(text)) return true;
    const isBare127 = /exit(ed)?( with)? ?(code |status )?127\b/i.test(text) || errCode === 127;
    if (isBare127 && typeof host === 'string' && host.startsWith('cs.')) return true;
    return false;
}

/**
 * After `gh auth switch --user <account>` fails, choose the terminal command
 * to hand the user. Switching can only succeed if <account> is already logged
 * into the CLI; when the CLI has zero accounts or doesn't know <account>, the
 * fix is a fresh login (with the codespace scope). Otherwise (transient
 * failure) re-offer the switch itself.
 */
function switchFallbackCommand(errText, account) {
    const t = String(errText || '');
    const needsLogin = /not logged in|no accounts|not logged into any|gh auth login|no such account|account .* not found/i.test(t);
    if (needsLogin || !account) return 'gh auth login -h github.com -s codespace';
    return `gh auth switch --hostname github.com --user ${String(account).replace(/[^A-Za-z0-9-]/g, '')}`;
}

module.exports = {
    ensureLinuxRemotePlatform,
    isPlatformMismatchError,
    switchFallbackCommand,
    PLATFORM_SETTING_SECTION,
    PLATFORM_SETTING_KEY
};
