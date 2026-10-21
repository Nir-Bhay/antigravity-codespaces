/**
 * Offline unit tests for antigravity-codespaces. Dependency-free (plain node).
 * Run: npm test
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { escapeHtml, generateNonce, formatRelativeTime, friendlyError, runCommand, runCommandWithDetails } = require('../src/utils');
const sshManager = require('../src/sshManager');
const { GithubApi } = require('../src/githubApi');
const { AuthManager, PAT_SECRET_KEY_PREFIX, PAT_SECRET_ACCOUNTS_KEY } = require('../src/authManager');
const connectPreflight = require('../src/connectPreflight');

let passed = 0;
function ok(name, fn) {
    return Promise.resolve()
        .then(() => fn())
        .then(() => { passed++; console.log(`  PASS ${name}`); })
        .catch((e) => {
            console.error(`  FAIL ${name}: ${e.message}`);
            process.exitCode = 1;
        });
}

(async () => {
    console.log('utils');
    await ok('escapeHtml escapes all five entities', () => {
        assert.strictEqual(escapeHtml('&<>"\''), '&amp;&lt;&gt;&quot;&#39;');
        assert.strictEqual(escapeHtml(null), '');
        assert.strictEqual(escapeHtml(undefined), '');
    });
    await ok('generateNonce is 32 hex chars and unique', () => {
        const a = generateNonce(), b = generateNonce();
        assert.match(a, /^[0-9a-f]{32}$/);
        assert.notStrictEqual(a, b);
    });
    await ok('formatRelativeTime guards invalid input', () => {
        assert.strictEqual(formatRelativeTime(undefined), 'N/A');
        assert.strictEqual(formatRelativeTime('not-a-date'), 'N/A');
        assert.strictEqual(formatRelativeTime(new Date().toISOString()), 'just now');
    });
    await ok('friendlyError maps auth/rate/network and truncates', () => {
        assert.match(friendlyError('401 Bad credentials'), /sign in again/i);
        assert.match(friendlyError('API rate limit exceeded'), /rate limit/i);
        assert.match(friendlyError('getaddrinfo EAI_AGAIN api.github.com'), /Network unreachable/i);
        assert.ok(friendlyError('x'.repeat(500)).length <= 301);
    });
    await ok('friendlyError guides 404/boot/ssh-server/drop/scope cases', () => {
        assert.match(friendlyError('HTTP 404: Not Found'), /Only the owner can open/i);
        assert.match(friendlyError('timed out while waiting for the codespace to start'), /still booting/i);
        assert.match(friendlyError('failed to start SSH server: check if SSH is installed'), /devcontainer.*sshd/i);
        assert.match(friendlyError('Connection closed exit 255'), /RUNNING/i);
        assert.match(friendlyError('This API operation needs the "codespace" scope'), /codespace.*permission/i);
        assert.match(friendlyError('Flag shorthand -r has been deprecated\nerror getting machine type: no terminal'), /machine/i);
    });
    await ok('sniffTunnelStderr maps gh-auth, scope, platform and pipe signatures', () => {
        const { sniffTunnelStderr, friendlyTunnelError } = require('../src/utils');
        assert.match(sniffTunnelStderr('To get started with GitHub CLI, please run: gh auth login'), /signed out/);
        assert.match(sniffTunnelStderr('HTTP 403: Must have admin rights to Repository.\nThis API operation needs the "codespace" scope.'), /gh auth refresh -h github\.com -s codespace/);
        assert.match(sniffTunnelStderr('bash: line 1: powershell: command not found'), /remote\.SSH\.remotePlatform/i);
        assert.match(sniffTunnelStderr('The process tried to write to a nonexistent pipe.'), /Test SSH Connectivity/);
        assert.strictEqual(sniffTunnelStderr(' totally unrelated error '), null);
        // friendlyTunnelError prefers sniffed stderr; falls back to friendlyError
        const err = new Error('SSH process exited (code 255)');
        err.stderr = 'This API operation needs the "codespace" scope.';
        assert.match(friendlyTunnelError(err), /gh auth refresh -h github\.com -s codespace/);
        assert.match(friendlyTunnelError(new Error('HTTP 404: Not Found')), /Only the owner can open/i);
        assert.match(friendlyTunnelError(null), /Unknown error/i);
    });
    await ok('listCodespaces failure paths stay guided and safe from ReferenceError', async () => {
        // Pure aggregate builder with scope guidance
        const scopeErr = GithubApi.buildListError('abhay', null, new Error('needs the "codespace" scope'));
        assert.match(scopeErr.message, /gh auth refresh.*codespace/i);

        // Standard aggregate error
        const err = GithubApi.buildListError('ghost', new Error('net down'), new Error('cli boom'));
        assert.match(err.message, /Couldn't load Codespaces for "ghost"/);
        assert.match(err.message, /press Refresh/i);

        // Null token (CLI-only fallback path) must NEVER throw ReferenceError: restErr is not defined
        const nullApi = new GithubApi({ getActiveAccount: () => '', getToken: async () => null });
        try {
            const list = await nullApi.listCodespaces('ghost');
            assert.ok(Array.isArray(list));
        } catch (err) {
            assert.match(err.message, /Couldn't load|missing the "codespace" permission/);
            assert.ok(!err.message.includes('ReferenceError'));
        }

        // Bogus token must reject (401-auth when online, aggregate when offline).
        const api = new GithubApi({ getActiveAccount: () => '', getToken: async () => 'bogus-invalid-token-xyz' });
        await assert.rejects(api.listCodespaces('ghost'), /expired|Couldn't load|missing the "codespace" permission/);
    });
    await ok('logger works without vscode (console fallback)', () => {
        const logger = require('../src/logger');
        logger.info('test info');
        logger.warn('test warn');
        logger.error('test error');
        logger.show();
    });
    await ok('runCommand resolves stdout only (stderr ignored)', async () => {
        const out = await runCommand(process.execPath, ['-e', "console.log('out'); console.error('warn noise')"], 8000);
        assert.strictEqual(out, 'out');
    });
    await ok('runCommand rejects on timeout and kills child', async () => {
        const start = Date.now();
        await assert.rejects(
            runCommand(process.execPath, ['-e', 'setTimeout(()=>{},30000)'], 500),
            /Timed out/
        );
        assert.ok(Date.now() - start < 10000, 'should fail fast');
    });
    await ok('runCommand rejects on failing exit code', async () => {
        await assert.rejects(runCommand(process.execPath, ['-e', 'process.exit(1)'], 5000));
    });

    console.log('sshManager');
    await ok('getGhAuthHealth detects missing gh (deps-injected)', async () => {
        const health = await sshManager.getGhAuthHealth({ findGhExecutable: () => null });
        assert.strictEqual(health.state, 'missing');
        const threw = await sshManager.getGhAuthHealth({ findGhExecutable: () => { throw new Error('nope'); } });
        assert.strictEqual(threw.state, 'missing');
    });
    await ok('getGhAuthHealth detects logged-out CLI from probe stderr', async () => {
        const health = await sshManager.getGhAuthHealth({
            findGhExecutable: () => 'gh.exe',
            runCommand: async () => { throw new Error('To get started with GitHub CLI, please run: gh auth login -s codespace'); }
        });
        assert.strictEqual(health.state, 'logged_out');
    });
    await ok('getGhAuthHealth fails open (unknown) on opaque probe errors', async () => {
        const health = await sshManager.getGhAuthHealth({
            findGhExecutable: () => 'gh.exe',
            runCommand: async () => { throw new Error('getaddrinfo EAI_AGAIN api.github.com'); }
        });
        assert.strictEqual(health.state, 'unknown');
    });
    await ok('getGhAuthHealth detects missing codespace scope for active user', async () => {
        const ghAuthStatus = [
            'github.com',
            '  ✓ Logged in to github.com account other (keyring)',
            '  - Token scopes: \x27gist\x27, \x27repo\x27, \x27workflow\x27',
            '',
            'github.com',
            '  ✓ Logged in to github.com account manjhss (keyring)',
            '  - Active account: true',
            '  - Token scopes: \x27gist\x27, \x27read:org\x27, \x27repo\x27, \x27workflow\x27'
        ].join('\n');
        let call = 0;
        const health = await sshManager.getGhAuthHealth({
            findGhExecutable: () => 'gh.exe',
            runCommand: async (cmd, args) => {
                if (args[0] === 'api') { assert.strictEqual(++call, 1); return 'manjhss'; }
                if (args[0] === 'auth') { return ghAuthStatus; }
                throw new Error('unexpected args ' + JSON.stringify(args));
            }
        });
        assert.strictEqual(health.state, 'scope_missing');
        assert.strictEqual(health.user, 'manjhss');
    });
    await ok('getGhAuthHealth returns ok when codespace scope present', async () => {
        const ghAuthStatus = [
            'github.com',
            '  ✓ Logged in to github.com account manjhss (keyring)',
            '  - Active account: true',
            '  - Token scopes: \x27codespace\x27, \x27gist\x27, \x27repo\x27'
        ].join('\n');
        const health = await sshManager.getGhAuthHealth({
            findGhExecutable: () => 'gh.exe',
            runCommand: async (cmd, args) => (args[0] === 'api' ? 'manjhss' : ghAuthStatus)
        });
        assert.strictEqual(health.state, 'ok');
        assert.strictEqual(health.user, 'manjhss');
    });
    await ok('sanitizeCsName accepts normal names', () => {
        assert.strictEqual(sshManager.sanitizeCsName('musical-xylophone-abc123'), 'musical-xylophone-abc123');
    });
    await ok('sanitizeCsName rejects injection payloads', () => {
        assert.throws(() => sshManager.sanitizeCsName('x"\nHost evil\n  HostName attacker\n  ProxyCommand evil #'));
        assert.throws(() => sshManager.sanitizeCsName('a(b'));
        assert.throws(() => sshManager.sanitizeCsName(''));
    });
    await ok('ensureSSHConfigEntry writes golden block, dedupes, migrates legacy', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agcs-test-'));
        const cfg = path.join(tmp, 'config');
        process.env.ANTIGRAVITY_SSH_CONFIG = cfg;
        try {
            const cs = { name: 'test-cs-123', repository: 'octo/app', account: 'octo' };
            const host = sshManager.ensureSSHConfigEntry(cs, 'octo');
            assert.strictEqual(host, 'cs.test-cs-123');
            let content = fs.readFileSync(cfg, 'utf8');
            assert.match(content, /Host cs\.test-cs-123 cs-octo-octo-app cs-octo-octo-app test-cs-123/);
            assert.match(content, /ProxyCommand ".*" cs ssh -c "test-cs-123" --stdio/);
            assert.match(content, /# END_CS_ENTRY:test-cs-123/);
            // Idempotent re-run: exactly one block.
            sshManager.ensureSSHConfigEntry(cs, 'octo');
            content = fs.readFileSync(cfg, 'utf8');
            assert.strictEqual(content.split('# CS_ENTRY:test-cs-123').length - 1, 1);
            // Legacy block (no end marker) migrates to the new format.
            fs.writeFileSync(cfg, `# CS_ENTRY:test-cs-123\nHost cs.test-cs-123\n  TCPKeepAlive yes\n`, 'utf8');
            sshManager.ensureSSHConfigEntry(cs, 'octo');
            content = fs.readFileSync(cfg, 'utf8');
            assert.strictEqual(content.split('# CS_ENTRY:test-cs-123').length - 1, 1);
            assert.match(content, /# END_CS_ENTRY:test-cs-123/);
            // Malicious name throws before any write.
            assert.throws(() => sshManager.ensureSSHConfigEntry({ name: 'x"\nHost evil' }, 'octo'));
        } finally {
            delete process.env.ANTIGRAVITY_SSH_CONFIG;
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    await ok('purgeLegacyBlocks removes stale artifacts, keeps user blocks', () => {
        const dirty = [
            'Host github.com',
            '  HostName github.com',
            '',
            'Host cs-old-thing cs.old-123',
            '  ProxyCommand "C:/gh.exe" cs ssh -c old-123 --stdio -- -i "C:/x/codespaces.auto"',
            '  IdentityFile C:/x/codespaces.auto',
            '',
            '# CS_ENTRY:keep-1',
            'Host cs.keep-1 cs-a-b keep-1',
            '  ProxyCommand "C:/gh.exe" cs ssh -c "keep-1" --stdio',
            '  TCPKeepAlive yes',
            '# END_CS_ENTRY:keep-1',
            '',
            'Host myserver',
            '  HostName 10.0.0.1',
            ''
        ].join('\n');
        const { cfg, removedBlocks, removedKeys } = sshManager.purgeLegacyBlocks(dirty);
        assert.strictEqual(removedBlocks, 1);
        assert.strictEqual(removedKeys, 0);
        assert.ok(cfg.includes('Host github.com'), 'user block must survive');
        assert.ok(cfg.includes('Host myserver'), 'user block must survive');
        assert.ok(cfg.includes('# CS_ENTRY:keep-1'), 'marked block must survive');
        assert.ok(!cfg.includes('cs.old-123'), 'legacy block must go');
        const clean = sshManager.purgeLegacyBlocks(cfg);
        assert.deepStrictEqual([clean.removedBlocks, clean.removedKeys], [0, 0]);
    });
    await ok('purgeLegacyBlocks removes END-less v5.0.0 blocks (foreign END must not shield)', () => {
        const dirty = [
            '# CS_ENTRY:old-a',
            'Host cs.old-a cs-x old-a',
            '  ProxyCommand "C:/gh.exe" cs ssh -c old-a --stdio -- -i "C:/x/codespaces.auto"',
            '  TCPKeepAlive yes',
            '',
            '# CS_ENTRY:keep-2',
            'Host cs.keep-2 cs-a-b keep-2',
            '  ProxyCommand "C:/gh.exe" cs ssh -c "keep-2" --stdio',
            '  TCPKeepAlive yes',
            '# END_CS_ENTRY:keep-2',
            ''
        ].join('\n');
        const r = sshManager.purgeLegacyBlocks(dirty);
        assert.strictEqual(r.removedBlocks, 1);
        assert.ok(!r.cfg.includes('cs.old-a'), 'END-less legacy block must go');
        assert.ok(r.cfg.includes('# CS_ENTRY:keep-2'), 'complete marked block must survive');
        assert.ok(r.cfg.includes('# END_CS_ENTRY:keep-2'), 'END marker must survive');
    });

    await ok('buildSshConfigBlock generates correct block with all options', () => {
        const block = sshManager.buildSshConfigBlock({
            codespace: 'test-cs-123',
            hostAliases: 'cs.test-cs-123 cs-octo-app test-cs-123',
            ghExePath: '/usr/bin/gh',
            identityFile: '/home/user/.ssh/codespaces.auto',
            knownHostsFile: '/home/user/.antigravity-codespaces/known_hosts',
            strictHostKeyChecking: 'accept-new',
            logLevel: 'ERROR',
            serverAliveInterval: 30,
            serverAliveCountMax: 10
        });
        assert.match(block, /# CS_ENTRY:test-cs-123/);
        assert.match(block, /Host cs\.test-cs-123 cs-octo-app test-cs-123/);
        assert.match(block, /ProxyCommand "\/usr\/bin\/gh" cs ssh -c "test-cs-123" --stdio/);
        assert.match(block, /IdentityFile "\/home\/user\/\.ssh\/codespaces\.auto"/);
        assert.match(block, /UserKnownHostsFile "\/home\/user\/\.antigravity-codespaces\/known_hosts"/);
        assert.match(block, /StrictHostKeyChecking accept-new/);
        assert.match(block, /LogLevel ERROR/);
        assert.match(block, /# END_CS_ENTRY:test-cs-123/);
    });

    await ok('buildSshConfigBlock uses managed known_hosts when knownHostsFile omitted (never /dev/null)', () => {
        const block = sshManager.buildSshConfigBlock({
            codespace: 'test-cs',
            hostAliases: 'cs.test-cs',
            ghExePath: 'gh'
        });
        assert.ok(!block.includes('/dev/null'), 'must not emit /dev/null');
        assert.match(block, /UserKnownHostsFile ".*\.antigravity-codespaces\/known_hosts"/);
        assert.match(block, /StrictHostKeyChecking accept-new/);
        assert.match(block, /LogLevel ERROR/);
    });

    await ok('mapTunnelError detects gh CLI not logged in', () => {
        const result = sshManager.mapTunnelError('To get started with GitHub CLI, please run: gh auth login', 1, 'cs.test');
        assert.match(result.message, /not logged in/i);
        assert.strictEqual(result.action, 'gh auth login -s codespace');
        assert.strictEqual(result.actionType, 'terminal_command');
    });

    await ok('mapTunnelError detects missing codespace scope', () => {
        const result = sshManager.mapTunnelError('This API operation needs the "codespace" scope', 1, 'cs.test');
        assert.match(result.message, /codespace.*scope/i);
        assert.match(result.action, /gh auth refresh/);
        assert.strictEqual(result.actionType, 'terminal_command');
    });

    await ok('mapTunnelError detects host key changed', () => {
        const result = sshManager.mapTunnelError('REMOTE HOST IDENTIFICATION HAS CHANGED', 255, 'cs.test');
        assert.match(result.message, /host key has changed/i);
        assert.strictEqual(result.actionType, 'remove_host_key');
    });

    await ok('mapTunnelError detects tunnel died (exit 255)', () => {
        const result = sshManager.mapTunnelError('The process tried to write to a nonexistent pipe', 255, 'cs.test');
        assert.match(result.message, /tunnel terminated/i);
    });

    await ok('mapTunnelError uses isPlatformMismatchError from connectPreflight', () => {
        const result = sshManager.mapTunnelError('bash: powershell: command not found', 127, 'cs.test');
        assert.match(result.message, /platform mismatch/i);
        assert.strictEqual(result.actionType, 'check_platform');
    });

    await ok('removeHostFromManagedKnownHosts removes matching host', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agcs-kh-'));
        const khPath = path.join(tmp, 'known_hosts');
        process.env.ANTIGRAVITY_KNOWN_HOSTS = khPath;
        try {
            fs.writeFileSync(khPath, 'cs.test-123 ssh-rsa AAAA...\ncs.other ssh-ed25519 BBBB...\n', 'utf8');
            const removed = sshManager.removeHostFromManagedKnownHosts('cs.test-123');
            assert.strictEqual(removed, true);
            const content = fs.readFileSync(khPath, 'utf8');
            assert.ok(!content.includes('cs.test-123'));
            assert.ok(content.includes('cs.other'));
        } finally {
            delete process.env.ANTIGRAVITY_KNOWN_HOSTS;
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    await ok('ensureManagedKnownHosts creates directory and file', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agcs-kh-'));
        const newDir = path.join(tmp, 'subdir');
        const khPath = path.join(newDir, 'known_hosts');
        process.env.ANTIGRAVITY_KNOWN_HOSTS = khPath;
        try {
            const result = sshManager.ensureManagedKnownHosts();
            assert.strictEqual(result, khPath);
            assert.ok(fs.existsSync(khPath));
        } finally {
            delete process.env.ANTIGRAVITY_KNOWN_HOSTS;
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    await ok('runCommandWithDetails returns stdout, stderr and exitCode', async () => {
        const result = await runCommandWithDetails(
            process.execPath, 
            ['-e', "console.log('out'); console.error('err'); process.exit(42)"],
            8000
        );
        assert.strictEqual(result.stdout, 'out');
        assert.strictEqual(result.stderr, 'err');
        assert.strictEqual(result.exitCode, 42);
    });

    console.log('githubApi');
    await ok('normalizeRepoInput validates owner/repo', () => {
        const good = GithubApi.normalizeRepoInput('https://github.com/octocat/Hello-World.git');
        assert.deepStrictEqual([good.owner, good.repoName], ['octocat', 'Hello-World']);
        const tree = GithubApi.normalizeRepoInput('owner/repo/tree/main');
        assert.deepStrictEqual([tree.owner, tree.repoName, tree.cleanRepo], ['owner', 'repo', 'owner/repo']);
        const bad = GithubApi.normalizeRepoInput('justowner');
        assert.strictEqual(bad.owner, '');
    });
    await ok('cache keys resolve the active account (no default collision)', () => {
        const apiAnon = new GithubApi({ getActiveAccount: () => '' });
        const apiBob = new GithubApi({ getActiveAccount: () => 'bob' });
        assert.strictEqual(apiAnon._csKey(undefined), 'cs:default');
        assert.strictEqual(apiBob._csKey(undefined), 'cs:bob');
        assert.strictEqual(apiBob._csKey('alice'), 'cs:alice');
    });
    await ok('fresh-cache entries expire by TTL', () => {
        const api = new GithubApi({ getActiveAccount: () => '' });
        api._setFresh(api._csCache, 'k', [1]);
        assert.deepStrictEqual(api._getFresh(api._csCache, 'k', 10000), [1]);
        assert.strictEqual(api._getFresh(api._csCache, 'k', -1), undefined);
    });
    await ok('CLI meta normalizes to REST shape incl. account', () => {
        const api = new GithubApi({ getActiveAccount: () => '' });
        const m = api._normalizeMeta({ name: 'x', machineDisplayName: '4 vCPU', repository: { full_name: 'o/r' } }, 'alice');
        assert.strictEqual(m.account, 'alice');
        assert.strictEqual(m.repository, 'o/r');
        assert.strictEqual(m.machineDisplayName, '4 vCPU');
    });

    console.log('authManager');
    await ok('authManager tracks active account and manages token cache', () => {
        const globalState = new Map();
        const auth = new AuthManager({
            globalState: {
                get: (k) => globalState.get(k),
                update: (k, v) => globalState.set(k, v)
            }
        });
        assert.strictEqual(auth.getActiveAccount(), '');
        auth.setActiveAccount('alice');
        assert.strictEqual(auth.getActiveAccount(), 'alice');
        assert.strictEqual(globalState.get('activeAccount'), 'alice');

        auth._tokenCache.set('alice', 'ghp_secret');
        assert.strictEqual(auth._tokenCache.get('alice'), 'ghp_secret');
        auth.clearCache();
        assert.strictEqual(auth._tokenCache.has('alice'), false);
    });
    await ok('authManager _readPatIndex repairs corrupt secret data gracefully', async () => {
        let stored = '{ invalid json';
        const auth = new AuthManager({
            secrets: {
                get: async () => stored,
                store: async (k, v) => { stored = v; }
            }
        });
        const index = await auth._readPatIndex();
        assert.deepStrictEqual(index, []);
        assert.strictEqual(stored, '[]');
    });
    await ok('authManager getAccounts executes cleanly without ReferenceError', async () => {
        const auth = new AuthManager({
            globalState: { get: () => '', update: () => {} },
            secrets: { get: async () => '[]', store: async () => {} }
        });
        const accs = await auth.getAccounts();
        assert.ok(Array.isArray(accs));
    });

    console.log('contracts (static)');
    await ok('every contributed command is registered in extension.js', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
        const ext = fs.readFileSync(path.join(ROOT, 'extension.js'), 'utf8');
        const contributed = pkg.contributes.commands.map((c) => c.command);
        assert.ok(contributed.length >= 17, 'expected all commands');
        for (const cmd of contributed) {
            assert.ok(ext.includes(`registerCommand('${cmd}'`), `missing registration: ${cmd}`);
        }
        assert.ok(ext.includes("registerWebviewViewProvider(\n            'antigravity-codespaces-view'") ||
            ext.includes("registerWebviewViewProvider('antigravity-codespaces-view'") ||
            ext.includes("'antigravity-codespaces-view'"), 'view id mismatch');
    });
    await ok('webviews have script-src CSP, no window.prompt, unknown-command guards', () => {
        for (const f of ['dashboardProvider.js', 'sidebarProvider.js']) {
            const src = fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
            assert.ok(src.includes("script-src 'nonce-"), `${f}: missing script-src nonce`);
            assert.ok(!src.includes('window.prompt('), `${f}: window.prompt forbidden`);
            assert.ok(src.includes('unknown webview command'), `${f}: missing default message guard`);
            
            // Zero inline on<event>= handlers allowed in HTML templates (strictly enforced by CSP)
            const regex = /\b(on[a-z]+)\s*=\s*["'][^"']*["']/gi;
            let match;
            const found = [];
            while ((match = regex.exec(src)) !== null) {
                const prefix = src.slice(Math.max(0, match.index - 10), match.index);
                if (!prefix.includes('.') && !prefix.includes('addEventListener')) {
                    found.push(match[0]);
                }
            }
            assert.strictEqual(found.length, 0, `${f} has inline event handler(s): ${found.join(', ')}`);
        }
        const dash = fs.readFileSync(path.join(ROOT, 'src', 'dashboardProvider.js'), 'utf8');
        assert.ok(dash.includes('vscode.getState()') && dash.includes('vscode.setState('), 'dashboard must preserve UI state');
    });


    console.log('connectPreflight (issue #3/#4 §C)');
    const cp = require('../src/connectPreflight');
    const fakeConfig = (initial, failWrite) => {
        const st = { value: initial, writes: [] };
        return { st, get: (k) => (k === 'remotePlatform' ? st.value : undefined),
            update: async (k, v, target) => { if (failWrite) throw new Error('EPERM'); st.writes.push({ k, v, target }); st.value = v; } };
    };
    await ok('ensureLinuxRemotePlatform: unset → writes linux at global scope', async () => {
        const c = fakeConfig(undefined); const logs = [];
        const r = await cp.ensureLinuxRemotePlatform('cs-me-app', { config: c, target: 1, log: (m) => logs.push(m) });
        assert.deepStrictEqual(r, { changed: true, previous: undefined });
        assert.deepStrictEqual(c.st.writes, [{ k: 'remotePlatform', v: { 'cs-me-app': 'linux' }, target: 1 }]);
        assert.strictEqual(logs.length, 1);
    });
    await ok('ensureLinuxRemotePlatform: windows → overwritten, other hosts preserved, logged', async () => {
        const c = fakeConfig({ 'cs-me-app': 'windows', winbox: 'windows' }); const logs = [];
        const r = await cp.ensureLinuxRemotePlatform('cs-me-app', { config: c, target: 1, log: (m) => logs.push(m) });
        assert.strictEqual(r.changed, true); assert.strictEqual(r.previous, 'windows');
        assert.deepStrictEqual(c.st.value, { 'cs-me-app': 'linux', winbox: 'windows' });
        assert.match(logs[0], /was "windows".*overwritten/);
    });
    await ok('ensureLinuxRemotePlatform: already linux → no write', async () => {
        const c = fakeConfig({ 'cs-me-app': 'linux' });
        const r = await cp.ensureLinuxRemotePlatform('cs-me-app', { config: c });
        assert.strictEqual(r.changed, false); assert.strictEqual(c.st.writes.length, 0);
    });
    await ok('ensureLinuxRemotePlatform: write failure never throws; bad shapes tolerated', async () => {
        const r = await cp.ensureLinuxRemotePlatform('h', { config: fakeConfig(null, true) });
        assert.strictEqual(r.changed, false); assert.ok(r.error);
        const c = fakeConfig(['junk']);
        assert.strictEqual((await cp.ensureLinuxRemotePlatform('h', { config: c })).changed, true);
        assert.deepStrictEqual(c.st.value, { h: 'linux' });
        assert.strictEqual((await cp.ensureLinuxRemotePlatform('', { config: c })).changed, false);
        assert.strictEqual((await cp.ensureLinuxRemotePlatform('h', {})).changed, false);
    });
    await ok('isPlatformMismatchError detects exit 127 / powershell not found only', () => {
        assert.ok(cp.isPlatformMismatchError({ stderr: 'bash: line 1: powershell: command not found' }));
        assert.ok(cp.isPlatformMismatchError(new Error('Process exited with code 127: powershell missing')));
        assert.ok(cp.isPlatformMismatchError('zsh: command not found: powershell'));
        assert.ok(!cp.isPlatformMismatchError(new Error('exit code 127: foo: command not found')));
        assert.ok(!cp.isPlatformMismatchError(new Error('exit 255 nonexistent pipe')));
        assert.ok(!cp.isPlatformMismatchError(null));
    });
    await ok('isPlatformMismatchError: bare 127 + cs. host => true, bare 127 + non-cs host => false', () => {
        assert.ok(cp.isPlatformMismatchError(new Error('Process exited with code 127'), 'cs.my-codespace-abc123'));
        assert.ok(cp.isPlatformMismatchError({ code: 127 }, 'cs.any-name'));
        assert.ok(!cp.isPlatformMismatchError(new Error('Process exited with code 127'), 'my-server'));
        assert.ok(!cp.isPlatformMismatchError(new Error('Process exited with code 127'), 'cs-account-repo'));
        assert.ok(!cp.isPlatformMismatchError(new Error('Process exited with code 127'), null));
        assert.ok(!cp.isPlatformMismatchError(new Error('Process exited with code 127')));
    });
    await ok('switchFallbackCommand: zero/unknown accounts → login, else re-switch (sanitized)', () => {
        assert.match(cp.switchFallbackCommand('not logged in to github.com account bob', 'bob'), /gh auth login .*-s codespace/);
        assert.match(cp.switchFallbackCommand('You are not logged into any GitHub hosts.', 'bob'), /gh auth login/);
        assert.match(cp.switchFallbackCommand('timeout', ''), /gh auth login/);
        assert.strictEqual(cp.switchFallbackCommand('timeout', 'bob;rm -rf'), 'gh auth switch --hostname github.com --user bobrm-rf');
    });
    const STATUS = "github.com\n  ✓ Logged in to github.com account bobby (keyring)\n  - Active account: false\n  - Token scopes: 'codespace', 'repo'\n\n  ✓ Logged in to github.com account bob (keyring)\n  - Active account: true\n  - Token scopes: 'gist', 'read:org', 'repo'\n";
    await ok('parseGhAuthStatusScopes anchors to exact account block', () => {
        const p = sshManager.parseGhAuthStatusScopes;
        assert.deepStrictEqual(p(STATUS, 'bob'), ['gist', 'read:org', 'repo']);
        assert.deepStrictEqual(p(STATUS, 'BOBBY'), ['codespace', 'repo']);
        assert.strictEqual(p(STATUS, 'alice'), null);
        assert.strictEqual(p('✓ Logged in to github.com as old (oauth_token)\n', 'old'), null);
        assert.deepStrictEqual(p("✓ Logged in to github.com as old (oauth_token)\n  ✓ Token scopes: codespace, repo", 'old'), ['codespace', 'repo']);
    });
    const health = (apiOut, statusOut, opts = {}) => sshManager.getGhAuthHealth({
        findGhExecutable: () => { if (opts.noGh) throw new Error('nf'); return 'gh'; },
        runCommand: async (exe, args) => {
            if (args[0] === 'api') { if (apiOut instanceof Error) throw apiOut; return apiOut; }
            if (statusOut instanceof Error) throw statusOut; return statusOut;
        }
    });
    await ok('getGhAuthHealth: multi-account scope parsing (other account has codespace)', async () => {
        assert.deepStrictEqual(await health('bob\n', STATUS), { state: 'scope_missing', user: 'bob' });
        assert.deepStrictEqual(await health('bobby\n', STATUS), { state: 'ok', user: 'bobby' });
    });
    await ok('getGhAuthHealth: states + fail-open on unparseable/unknown', async () => {
        assert.strictEqual((await health('', '', { noGh: true })).state, 'missing');
        assert.strictEqual((await health(new Error('You are not logged into any GitHub hosts. To log in, run: gh auth login'), '')).state, 'logged_out');
        assert.strictEqual((await health(new Error('dial tcp: i/o timeout'), '')).state, 'unknown');
        assert.strictEqual((await health('', '')).state, 'unknown');
        const fo = await health('envuser\n', 'github.com\n  ✓ Logged in to github.com account envuser (GH_TOKEN)\n');
        assert.strictEqual(fo.state, 'ok'); assert.strictEqual(fo.scopesUnknown, true);
        assert.strictEqual((await health('envuser\n', new Error('boom'))).state, 'ok');
    });
    await ok('extension wires shared preflight into Connect + testSSH, platform fix before connect', () => {
        const src = fs.readFileSync(path.join(ROOT, 'extension.js'), 'utf8');
        assert.ok((src.match(/await ghPreflight\(/g) || []).length >= 2, 'ghPreflight used by connect and testSSH');
        assert.ok(/quickConnect[\s\S]*executeCommand\('antigravity-codespaces\.connect'/.test(src), 'quickConnect delegates to connect');
        const conn = src.indexOf("registerCommand('antigravity-codespaces.connect'");
        const ens = src.indexOf('ensureLinuxRemotePlatform(hostAlias', conn);
        const open = src.indexOf("'vscode.openFolder'", conn);
        assert.ok(ens > conn && ens < open, 'remotePlatform ensured before opening remote');
        assert.ok(src.includes("'Fix Remote Platform'"));
    });

    // ── First-Run Card Tests (Issue #4 §A-B) ─────────────────────────────────
    console.log('sidebarProvider (first-run card)');
    await ok('sidebarProvider has first-run card HTML with three steps', () => {
        const src = fs.readFileSync(path.join(ROOT, 'src', 'sidebarProvider.js'), 'utf8');
        assert.ok(src.includes('first-run-card'), 'first-run-card class exists');
        assert.ok(src.includes('first-run-steps'), 'first-run-steps container exists');
        assert.ok(src.includes('1. Sign in to GitHub'), 'step 1 label');
        assert.ok(src.includes('2. Set up GitHub CLI'), 'step 2 label');
        assert.ok(src.includes('3. Connect to a Codespace'), 'step 3 label');
        assert.ok(src.includes('dismissFirstRunBtn'), 'dismiss button exists');
        assert.ok(src.includes('stepSignInBtn'), 'step 1 action button');
        assert.ok(src.includes('stepSetupGhBtn'), 'step 2 action button');
        assert.ok(src.includes('stepConnectBtn'), 'step 3 action button');
    });
    await ok('sidebarProvider stores first-run dismissed in globalState', () => {
        const src = fs.readFileSync(path.join(ROOT, 'src', 'sidebarProvider.js'), 'utf8');
        assert.ok(src.includes('FIRST_RUN_DISMISSED_KEY'), 'key constant defined');
        assert.ok(src.includes('globalState.get'), 'reads from globalState');
        assert.ok(src.includes('globalState.update'), 'writes to globalState');
        assert.ok(src.includes('isFirstRunDismissed()'), 'check method exists');
        assert.ok(src.includes('dismissFirstRun()'), 'dismiss method exists');
    });
    await ok('sidebarProvider first-run card shows based on gh health and dismissal', () => {
        const src = fs.readFileSync(path.join(ROOT, 'src', 'sidebarProvider.js'), 'utf8');
        assert.ok(src.includes('showFirstRunCard = !this.isFirstRunDismissed() && !ghHealthy'), 'card visibility logic');
        assert.ok(src.includes('showFirstRunCard ? `'), 'conditional HTML rendering');
        assert.ok(src.includes('step1Done = accounts.length > 0'), 'step 1 completion check');
        assert.ok(src.includes("step2Done = diag.ghInstalled && ghHealth.state === 'ok'"), 'step 2 completion check');
        assert.ok(src.includes('step3Done = codespaces.length > 0'), 'step 3 completion check');
    });
    await ok('sidebarProvider first-run card buttons dispatch correct messages', () => {
        const src = fs.readFileSync(path.join(ROOT, 'src', 'sidebarProvider.js'), 'utf8');
        assert.ok(src.includes("command: 'dismissFirstRun'"), 'dismiss posts dismissFirstRun');
        assert.ok(src.includes("command: 'loginGitHub'") && src.includes('stepSignInBtn'), 'step 1 posts loginGitHub');
        assert.ok(src.includes("command: 'openSetupDoctor'") && src.includes('stepSetupGhBtn'), 'step 2 posts openSetupDoctor');
        assert.ok(src.includes("command: 'createCodespace'") && src.includes('stepConnectBtn'), 'step 3 posts createCodespace');
    });

    // ── Issue #4 §D-G Tests ──────────────────────────────────────────────────
    console.log('issue #4 §D-G features');
    await ok('systemDoctor.generateReport includes all required fields (§F)', () => {
        const src = fs.readFileSync(path.join(ROOT, 'src', 'systemDoctor.js'), 'utf8');
        assert.ok(src.includes('os.release()'), 'includes OS version');
        assert.ok(src.includes('vscode.env.appName'), 'includes IDE name');
        assert.ok(src.includes('vscode.version'), 'includes IDE version');
        assert.ok(src.includes('_redactAuthStatus'), 'redacts auth status');
        assert.ok(src.includes('_extractCodespaceBlocks'), 'extracts SSH config blocks');
        assert.ok(src.includes('lastTunnelStderr'), 'includes last tunnel stderr');
        assert.ok(src.includes('setLastTunnelStderr'), 'has method to store tunnel stderr');
    });
    await ok('systemDoctor._redactAuthStatus removes all token types (source check)', () => {
        const src = fs.readFileSync(path.join(ROOT, 'src', 'systemDoctor.js'), 'utf8');
        assert.ok(src.includes("gho_[A-Za-z0-9_]+"), 'redacts gho_ tokens (OAuth)');
        assert.ok(src.includes("ghp_[A-Za-z0-9_]+"), 'redacts ghp_ tokens (classic PAT)');
        assert.ok(src.includes("ghu_[A-Za-z0-9_]+"), 'redacts ghu_ tokens (user-to-server)');
        assert.ok(src.includes("ghs_[A-Za-z0-9_]+"), 'redacts ghs_ tokens (server-to-server)');
        assert.ok(src.includes("ghr_[A-Za-z0-9_]+"), 'redacts ghr_ tokens (refresh)');
        assert.ok(src.includes("github_pat_[A-Za-z0-9_]+"), 'redacts github_pat_ tokens (fine-grained)');
        assert.ok(src.includes("Bearer [A-Za-z0-9_-]+"), 'redacts Bearer tokens');
        assert.ok(src.includes('[REDACTED]'), 'uses REDACTED marker');
    });
    await ok('systemDoctor._extractCodespaceBlocks extracts cs. blocks (source check)', () => {
        const src = fs.readFileSync(path.join(ROOT, 'src', 'systemDoctor.js'), 'utf8');
        assert.ok(src.includes('_extractCodespaceBlocks'), 'method exists');
        assert.ok(src.includes("/^cs[\\.-]/"), 'matches cs. pattern');
        assert.ok(src.includes('blocks.slice(0, 10)'), 'limits to 10 blocks');
    });
    await ok('extension.js has reconnectLast command registered (§G)', () => {
        const src = fs.readFileSync(path.join(ROOT, 'extension.js'), 'utf8');
        assert.ok(src.includes("'antigravity-codespaces.reconnectLast'"), 'reconnectLast command registered');
        assert.ok(src.includes('LAST_CODESPACE_KEY'), 'last codespace key defined');
        assert.ok(src.includes('globalState.get(LAST_CODESPACE_KEY)'), 'reads last codespace from globalState');
        assert.ok(src.includes('globalState.update(LAST_CODESPACE_KEY'), 'stores last codespace in globalState');
    });
    await ok('extension.js connect shows staged progress (§E)', () => {
        const src = fs.readFileSync(path.join(ROOT, 'extension.js'), 'utf8');
        assert.ok(src.includes("'Step 1/4: Checking gh CLI...'"), 'step 1 progress');
        assert.ok(src.includes("'Step 2/4: Configuring SSH...'"), 'step 2 progress');
        assert.ok(src.includes("'Step 3/4: Waking container...'"), 'step 3 progress');
        assert.ok(src.includes("'Step 4/4: Opening remote folder...'"), 'step 4 progress');
    });
    await ok('extension.js createCodespace offers Connect Now button (§G)', () => {
        const src = fs.readFileSync(path.join(ROOT, 'extension.js'), 'utf8');
        assert.ok(src.includes("'Connect Now'"), 'Connect Now button offered');
        assert.ok(src.includes("if (action === 'Connect Now')"), 'Connect Now action handler');
    });
    await ok('authManager validates PAT scopes at login (§G)', () => {
        const src = fs.readFileSync(path.join(ROOT, 'src', 'authManager.js'), 'utf8');
        assert.ok(src.includes('x-oauth-scopes'), 'reads scopes from response header');
        assert.ok(src.includes('hasCodespaceScope'), 'hasCodespaceScope method exists');
        assert.ok(src.includes("missing the \"codespace\" scope"), 'warns about missing scope');
    });
    await ok('package.json has reconnectLast command', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
        const cmds = pkg.contributes.commands.map(c => c.command);
        assert.ok(cmds.includes('antigravity-codespaces.reconnectLast'), 'reconnectLast in package.json');
    });

    // ── Issue #4 §D folder detection tests ────────────────────────────────────
    console.log('issue #4 §D folder detection');
    await ok('GithubApi.getBestFolder prefers recentFolders[0]', () => {
        const { GithubApi } = require('../src/githubApi');
        const meta = { recentFolders: ['/workspaces/my-project', '/home/user'] };
        const result = GithubApi.getBestFolder(meta, 'owner/repo', 'cs-name', '/workspaces/${repo}');
        assert.strictEqual(result, '/workspaces/my-project', 'uses first recentFolders entry');
    });
    await ok('GithubApi.getBestFolder falls back to template when no recentFolders', () => {
        const { GithubApi } = require('../src/githubApi');
        const meta = { devcontainerPath: '.devcontainer/devcontainer.json' };
        const result = GithubApi.getBestFolder(meta, 'owner/my-repo', 'cs-name', '/workspaces/${repo}');
        assert.strictEqual(result, '/workspaces/my-repo', 'derives from repo name');
    });
    await ok('GithubApi.getBestFolder uses template fallback', () => {
        const { GithubApi } = require('../src/githubApi');
        const result = GithubApi.getBestFolder({}, 'owner/test-repo', 'cs-name', '/workspaces/${repo}');
        assert.strictEqual(result, '/workspaces/test-repo', 'uses template');
    });
    await ok('GithubApi.getBestFolder handles ${name} placeholder', () => {
        const { GithubApi } = require('../src/githubApi');
        const result = GithubApi.getBestFolder({}, null, 'my-codespace', '/home/${name}');
        assert.strictEqual(result, '/home/my-codespace', 'replaces ${name}');
    });
    await ok('GithubApi._normalizeMeta includes recentFolders and devcontainerPath', () => {
        const { GithubApi } = require('../src/githubApi');
        const mockAuthManager = { getToken: async () => null };
        const api = new GithubApi(mockAuthManager);
        const raw = {
            name: 'test',
            recentFolders: ['/workspaces/proj'],
            devcontainerPath: '.devcontainer/devcontainer.json'
        };
        const m = api._normalizeMeta(raw, 'user');
        assert.deepStrictEqual(m.recentFolders, ['/workspaces/proj'], 'recentFolders preserved');
        assert.strictEqual(m.devcontainerPath, '.devcontainer/devcontainer.json', 'devcontainerPath preserved');
    });
    await ok('checkRemoteFolderExists is exported from sshManager', () => {
        const sshManager = require('../src/sshManager');
        assert.ok(typeof sshManager.checkRemoteFolderExists === 'function', 'checkRemoteFolderExists exported');
        assert.ok(typeof sshManager.listRemoteWorkspaces === 'function', 'listRemoteWorkspaces exported');
    });
    await ok('checkRemoteFolderExists returns exists:true when folder found (mocked)', async () => {
        const sshManager = require('../src/sshManager');
        const mockRunner = async () => ({ stdout: 'exists\n', stderr: '', exitCode: 0 });
        const result = await sshManager.checkRemoteFolderExists('cs.test', '/workspaces/proj', { runCommandWithDetails: mockRunner });
        assert.strictEqual(result.exists, true, 'folder exists');
    });
    await ok('checkRemoteFolderExists returns exists:false when folder missing (mocked)', async () => {
        const sshManager = require('../src/sshManager');
        const mockRunner = async () => { const e = new Error('exit 1'); e.exitCode = 1; throw e; };
        const result = await sshManager.checkRemoteFolderExists('cs.test', '/workspaces/missing', { runCommandWithDetails: mockRunner });
        assert.strictEqual(result.exists, false, 'folder does not exist');
    });
    await ok('extension.js connect uses GithubApi.getBestFolder and checkRemoteFolderExists', () => {
        const src = fs.readFileSync(path.join(ROOT, 'extension.js'), 'utf8');
        assert.ok(src.includes('GithubApi.getBestFolder'), 'uses getBestFolder');
        assert.ok(src.includes('checkRemoteFolderExists'), 'uses checkRemoteFolderExists');
        assert.ok(src.includes('listRemoteWorkspaces'), 'uses listRemoteWorkspaces');
        assert.ok(src.includes("Folder \"${remoteFolder}\" not found"), 'offers alternative when folder missing');
    });

    // ── Usage analytics ─────────────────────────────────────────────────
    console.log('usage analytics');
    const us = require('../src/usageService');
    const uv = require('../src/usageView');
    const NOW = Date.UTC(2026, 9, 21, 12, 0, 0); // 21 Oct 2026
    const RESET = Date.UTC(2026, 10, 1);
    function fakeResp(status, body, scopes = '') {
        return { status, ok: status >= 200 && status < 300, json: async () => body, headers: { get: (k) => (k.toLowerCase() === 'x-oauth-scopes' ? scopes : null) } };
    }
    function makeFetch(routes, calls = []) {
        return async (url, opts) => {
            calls.push({ url, auth: opts.headers.Authorization });
            for (const [re, fn] of routes) if (re.test(url)) return fn(url, opts);
            return fakeResp(404, { message: 'Not Found' });
        };
    }
    function daysOf(n, perDay, endMs = NOW) {
        const d = {};
        for (let i = 0; i < n; i++) d[new Date(endMs - i * 86400000).toISOString().slice(0, 10)] = perDay;
        return d;
    }
    await ok('quota math: Free 120, Pro 180, custom, org plan has no personal quota', () => {
        assert.strictEqual(us.resolvePlan('free').coreHours, 120);
        assert.strictEqual(us.resolvePlan('free').storageGb, 15);
        assert.strictEqual(us.resolvePlan('pro').coreHours, 180);
        assert.strictEqual(us.resolvePlan('pro').storageGb, 20);
        assert.strictEqual(us.resolvePlan('', {}).coreHours, 120);
        assert.strictEqual(us.resolvePlan('free', { plan: 'pro' }).coreHours, 180);
        assert.strictEqual(us.resolvePlan('pro', { plan: 'custom', monthlyCoreHours: 60, monthlyStorageGb: 5 }).coreHours, 60);
        const team = us.resolvePlan('team');
        assert.strictEqual(team.personal, false);
        assert.strictEqual(team.coreHours, 0);
    });
    await ok('core-hours = cores x hours (4-core x 10h = 40) and prices', () => {
        assert.strictEqual(us.coreHoursFor(4, 10), 40);
        assert.strictEqual(us.coreHoursFor(2, -5), 0);
        assert.strictEqual(us.pricePerHour(2), 0.18);
        assert.strictEqual(us.pricePerHour(32), 2.88);
        assert.strictEqual(us.coresFromSku('Codespaces compute 8 core'), 8);
    });
    await ok('remaining = quota - used, never below 0; pct levels amber/red', () => {
        const a = us.computeStats({ quota: 120, used: 40, now: NOW, reset: RESET });
        assert.strictEqual(a.remaining, 80);
        assert.strictEqual(a.level, 'ok');
        assert.strictEqual(us.computeStats({ quota: 120, used: 90, now: NOW, reset: RESET }).level, 'amber');
        assert.strictEqual(us.computeStats({ quota: 120, used: 110, now: NOW, reset: RESET }).level, 'red');
        const over = us.computeStats({ quota: 120, used: 500, now: NOW, reset: RESET });
        assert.strictEqual(over.remaining, 0);
        assert.strictEqual(over.daysLeftLabel, 'quota used up');
    });
    await ok('days left: <3 days -> not enough data, uses last-7-day avg, full cycle, no divide by zero', () => {
        assert.strictEqual(us.computeStats({ quota: 120, used: 4, daily: daysOf(2, 2), now: NOW, reset: RESET }).daysLeftLabel, 'not enough data');
        const s = us.computeStats({ quota: 120, used: 100, daily: daysOf(10, 10), now: NOW, reset: RESET });
        assert.strictEqual(s.avgPerDay, 10);
        assert.strictEqual(s.daysLeftLabel, 'about 2 days left');
        const slow = us.computeStats({ quota: 120, used: 3, daily: daysOf(5, 0.5), now: NOW, reset: RESET });
        assert.strictEqual(slow.daysLeftLabel, 'lasts the full cycle');
        const zero = us.computeStats({ quota: 120, used: 0, daily: daysOf(5, 0), now: NOW, reset: RESET });
        assert.strictEqual(zero.daysLeftLabel, 'lasts the full cycle');
        const q0 = us.computeStats({ quota: 0, used: 0, now: NOW, reset: RESET });
        assert.ok(Number.isFinite(q0.pct));
    });
    await ok('parseSummary converts per-core SKUs to core-hours and uses discountQuantity', () => {
        const p = us.parseSummary({ usageItems: [
            { product: 'codespaces', sku: 'Codespaces compute 4 core', unitType: 'Hours', grossQuantity: 10, discountQuantity: 10, netAmount: 0 },
            { product: 'codespaces', sku: 'Codespaces storage', unitType: 'GigabyteMonths', grossQuantity: 3.5, discountQuantity: 3.5, netAmount: 0 },
            { product: 'actions', sku: 'Actions Linux', grossQuantity: 999 }
        ] });
        assert.strictEqual(p.computeCoreHours, 40);
        assert.strictEqual(p.includedCoreHours, 40);
        assert.strictEqual(p.storageGbMonths, 3.5);
    });
    const userBody = (login, plan) => ({ login, plan: plan ? { name: plan } : undefined });
    const csList = (login) => ({ codespaces: [
        { name: 'cs-mine', state: 'Available', machine: { cpus: 4, name: 'standardLinux32gb' }, repository: { full_name: login + '/app' }, billable_owner: { login } },
        { name: 'cs-org', state: 'Available', machine: { cpus: 8 }, repository: { full_name: 'acme/api' }, billable_owner: { login: 'acme' } }
    ] });
    await ok('live mode: summary API -> used/remaining from discountQuantity', async () => {
        const svc = new us.UsageService({ authManager: { getToken: async () => 'tok-a' }, now: () => NOW, fetchImpl: makeFetch([
            [/\/user$/, () => fakeResp(200, userBody('alice', 'pro'), 'repo, codespace, user')],
            [/\/user\/codespaces/, () => fakeResp(200, csList('alice'))],
            [/usage\/summary/, () => fakeResp(200, { usageItems: [{ product: 'codespaces', sku: 'Codespaces compute 2 core', unitType: 'Hours', grossQuantity: 30, discountQuantity: 30, netAmount: 0 }] })]
        ]) });
        const u = await svc.getAccountUsage('alice');
        assert.strictEqual(u.mode, 'live');
        assert.strictEqual(u.plan.coreHours, 180);
        assert.strictEqual(u.stats.used, 60);
        assert.strictEqual(u.stats.remaining, 120);
        assert.deepStrictEqual(u.orgBilled, ['acme']);
    });
    await ok('403 and 404 without user scope -> needsPermission', async () => {
        for (const code of [403, 404]) {
            const svc = new us.UsageService({ authManager: { getToken: async () => 't' }, now: () => NOW, fetchImpl: makeFetch([
                [/\/user$/, () => fakeResp(200, userBody('bob'), 'repo, codespace')],
                [/\/user\/codespaces/, () => fakeResp(200, { codespaces: [] })],
                [/usage\/summary/, () => fakeResp(code, { message: 'x' })]
            ]) });
            const u = await svc.getAccountUsage('bob');
            assert.strictEqual(u.mode, 'needsPermission', 'status ' + code);
            assert.match(uv.hubUsageCardHtml(u), /Usage needs permission/);
            assert.match(uv.hubUsageCardHtml(u), /Grant access/);
            assert.match(uv.sidebarSummaryHtml(u, 'n'), /Grant access to see usage/);
        }
    });
    await ok('404 with user scope -> Estimated from tracked sessions; org-billed excluded', async () => {
        const state = { m: {}, get(k, d) { return k in this.m ? this.m[k] : d; }, update(k, v) { this.m[k] = v; return Promise.resolve(); } };
        let now = NOW - 10 * 3600000;
        const fetchImpl = makeFetch([
            [/\/user$/, () => fakeResp(200, userBody('carol', 'free'), 'repo, codespace, user')],
            [/\/user\/codespaces/, () => fakeResp(200, csList('carol'))],
            [/usage\/summary/, () => fakeResp(404, { message: 'Not Found' })]
        ]);
        const svc = new us.UsageService({ authManager: { getToken: async () => 't' }, now: () => now, fetchImpl, state });
        await svc.getAccountUsage('carol'); // records session start for both codespaces
        now = NOW; svc.clearCache();
        const u = await svc.getAccountUsage('carol');
        assert.strictEqual(u.mode, 'estimated');
        assert.strictEqual(Math.round(u.stats.used), 40, '4-core x 10h, org 8-core excluded');
        assert.strictEqual(u.machines.length, 1);
        assert.match(uv.hubUsageCardHtml(u), /Estimated/);
        assert.match(uv.sidebarSummaryHtml(u, 'n'), /Estimated/);
        assert.match(uv.hubUsagePageHtml(u), /billed to acme/);
    });
    await ok('org plan with only org-billed codespaces -> "Billed to {org}" with no bar', async () => {
        const svc = new us.UsageService({ authManager: { getToken: async () => 't' }, now: () => NOW, fetchImpl: makeFetch([
            [/\/user$/, () => fakeResp(200, userBody('dan', 'enterprise'), 'user')],
            [/\/user\/codespaces/, () => fakeResp(200, { codespaces: [csList('dan').codespaces[1]] })]
        ]) });
        const u = await svc.getAccountUsage('dan');
        assert.strictEqual(u.mode, 'orgBilled');
        const html = uv.hubUsageCardHtml(u);
        assert.match(html, /Billed to acme/);
        assert.ok(!/usage-bar/.test(html));
    });
    await ok('10-minute cache: second call does not refetch; refresh() clears', async () => {
        const calls = []; let now = NOW;
        const svc = new us.UsageService({ authManager: { getToken: async () => 't' }, now: () => now, fetchImpl: makeFetch([
            [/\/user$/, () => fakeResp(200, userBody('eve', 'free'), 'user')],
            [/\/user\/codespaces/, () => fakeResp(200, { codespaces: [] })],
            [/usage\/summary/, () => fakeResp(200, { usageItems: [] })]
        ], calls) });
        await svc.getAccountUsage('eve');
        const n = calls.length;
        now += 9 * 60000; await svc.getAccountUsage('eve');
        assert.strictEqual(calls.length, n, 'cached within 10 min');
        now += 2 * 60000; await svc.getAccountUsage('eve');
        assert.ok(calls.length > n, 'refetched after 10 min');
        const m = calls.length; await svc.refresh(); await svc.getAccountUsage('eve');
        assert.ok(calls.length > m, 'refresh clears cache');
    });
    await ok('unknown compute SKU core count -> Estimated (no 1-core guess) and SKU logged', async () => {
        assert.strictEqual(us.parseSummary({ usageItems: [{ product: 'codespaces', sku: 'Codespaces compute premium', grossQuantity: 10 }] }).computeCoreHours, 0);
        const logs = [];
        const svc = new us.UsageService({ authManager: { getToken: async () => 't' }, now: () => NOW, log: (m) => logs.push(m), fetchImpl: makeFetch([
            [/\/user$/, () => fakeResp(200, userBody('gus', 'free'), 'user')],
            [/\/user\/codespaces/, () => fakeResp(200, { codespaces: [] })],
            [/usage\/summary/, () => fakeResp(200, { usageItems: [{ product: 'codespaces', sku: 'Codespaces compute premium', grossQuantity: 10, discountQuantity: 10 }] })]
        ]) });
        const u = await svc.getAccountUsage('gus');
        assert.strictEqual(u.mode, 'estimated');
        assert.ok(logs.some(l => l.includes('Codespaces compute premium')));
    });
    await ok('offline: network failure keeps last good result with offline note', async () => {
        let down = false, now = NOW;
        const net = makeFetch([
            [/\/user$/, () => fakeResp(200, userBody('hal', 'free'), 'user')],
            [/\/user\/codespaces/, () => fakeResp(200, { codespaces: [] })],
            [/usage\/summary/, () => fakeResp(200, { usageItems: [{ product: 'codespaces', sku: 'Codespaces compute 2 core', grossQuantity: 5, discountQuantity: 5 }] })]
        ]);
        const svc = new us.UsageService({ authManager: { getToken: async () => 't' }, now: () => now, fetchImpl: async (u, o) => { if (down) throw new Error('getaddrinfo ENOTFOUND api.github.com'); return net(u, o); } });
        const first = await svc.getAccountUsage('hal');
        down = true; await svc.refresh(); now += 60000;
        const u = await svc.getAccountUsage('hal');
        assert.strictEqual(u.offline, true);
        assert.strictEqual(u.stats.used, first.stats.used);
        assert.match(uv.hubUsageCardHtml(u), /offline · last updated \d\d:\d\d/);
        now += 11 * 60000;
        assert.strictEqual((await svc.getAccountUsage('hal')).offline, true, 'still served after TTL');
        const fresh = new us.UsageService({ authManager: { getToken: async () => 't' }, now: () => now, fetchImpl: async () => { throw new Error('offline'); } });
        const [e] = await fresh.getAllUsage(['nobody']);
        assert.strictEqual(e.mode, 'error');
    });
    await ok('only the active gh account is fetched (follows account switches)', async () => {
        const calls = []; let active = 'alice';
        const tokens = { alice: 'tok-alice', bob: 'tok-bob' };
        const svc = new us.UsageService({ authManager: { getToken: async (a) => tokens[a] }, getActiveAccount: async () => active, now: () => NOW, fetchImpl: makeFetch([
            [/\/user$/, (url, o) => fakeResp(200, o.headers.Authorization.endsWith('alice') ? userBody('alice', 'pro') : userBody('bob', 'free'), 'user')],
            [/\/user\/codespaces/, () => fakeResp(200, { codespaces: [] })],
            [/usage\/summary/, (url) => fakeResp(200, { usageItems: [{ product: 'codespaces', sku: 'Codespaces compute 2 core', grossQuantity: url.includes('/alice/') ? 10 : 5, discountQuantity: url.includes('/alice/') ? 10 : 5 }] })]
        ], calls) });
        const u = await svc.getActiveUsage();
        assert.strictEqual(u.account, 'alice');
        assert.strictEqual(u.stats.used, 20);
        assert.ok(calls.every(c => c.auth === 'Bearer tok-alice'), 'no other account token used');
        active = 'bob';
        const u2 = await svc.getActiveUsage();
        assert.strictEqual(u2.account, 'bob');
        assert.strictEqual(u2.plan.coreHours, 120);
        assert.strictEqual(await new us.UsageService({ authManager: { getToken: async () => null }, getActiveAccount: async () => null }).getActiveUsage(), null);
        const html = uv.sidebarSummaryHtml(u, 'n');
        assert.strictEqual((html.match(/class="usage-mini"/g) || []).length, 1);
        assert.match(html, /20 \/ 180 core-hrs/);
    });
    await ok('Cloud Hub usage card + page: bar colours, tiles, sortable table, svg chart, last fetched', () => {
        const mk = (used) => ({ account: 'a', login: 'a', plan: { label: 'Free' }, mode: 'live', fetchedAt: NOW, cycleStart: new Date(Date.UTC(2026, 9, 1)).toISOString(), resetDate: new Date(RESET).toISOString(),
            stats: us.computeStats({ quota: 120, used, daily: daysOf(5, 6), now: NOW, reset: RESET }), daily: daysOf(5, 6), storage: { used: 2, quota: 15 }, billed: 0,
            machines: us.machineRows([{ name: 'cs1', repo: 'a/x', cores: 2, coreHours: 30 }]), storageRows: [] });
        const u = mk(30);
        const card = uv.hubUsageCardHtml(u, '');
        assert.match(card, /USAGE · a · Free/);
        assert.match(card, /30 \/ 120/);
        assert.match(card, /HOURS LEFT/);
        assert.match(card, /DAYS LEFT/);
        assert.match(uv.hubUsageCardHtml(mk(95)), /usage-fill amber/);
        assert.match(uv.hubUsageCardHtml(mk(110)), /usage-fill red/);
        assert.strictEqual(uv.storageTierText(u), '2 / 15 GB-month');
        assert.strictEqual(uv.storageTierText(null), '15 GB Free Tier');
        const page = uv.hubUsagePageHtml(u);
        assert.match(page, /id="usagePage"/);
        assert.match(page, /RESETS/);
        assert.match(page, /<svg/);
        assert.match(page, /stroke-dasharray/);
        assert.match(page, /class="usage-table sortable"/);
        assert.match(page, /Updated hourly · last fetched/);
        assert.strictEqual(u.machines[0].estCost, 2.7);
        assert.strictEqual(u.machines[0].share, 100);
    });
    await ok('Cloud Hub dashboard integrates usage (rail item, card, page) and no separate usage webview', () => {
        const src = fs.readFileSync(path.join(ROOT, 'src', 'dashboardProvider.js'), 'utf8');
        assert.ok(src.includes('railUsageBtn'));
        assert.ok(src.includes('hubUsageCardHtml(this._usage'));
        assert.ok(src.includes('hubUsagePageHtml(this._usage)'));
        assert.ok(!fs.existsSync(path.join(ROOT, 'src', 'usageDashboard.js')));
    });
    await ok('usage service never logs tokens', () => {
        const src = fs.readFileSync(path.join(ROOT, 'src', 'usageService.js'), 'utf8');
        assert.ok(!/console\.(log|warn|error)\([^)]*token/i.test(src));
    });
    await ok('package.json contributes usage settings and refresh command', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
        const props = pkg.contributes.configuration.properties;
        assert.deepStrictEqual(props['antigravity-codespaces.usage.plan'].enum, ['auto', 'free', 'pro', 'custom']);
        assert.ok(props['antigravity-codespaces.usage.monthlyCoreHours']);
        assert.ok(props['antigravity-codespaces.usage.monthlyStorageGb']);
        assert.ok(pkg.contributes.commands.some(c => c.command === 'antigravity-codespaces.refreshUsage'));
        assert.ok(!pkg.contributes.commands.some(c => c.command === 'antigravity-codespaces.usageDashboard'));
    });

    console.log(passed + ' assertions passed' + (process.exitCode ? ' (WITH FAILURES)' : ''));
})();
