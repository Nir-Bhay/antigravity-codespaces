/**
 * Offline unit tests for antigravity-codespaces. Dependency-free (plain node).
 * Run: npm test
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { escapeHtml, generateNonce, formatRelativeTime, friendlyError, runCommand } = require('../src/utils');
const sshManager = require('../src/sshManager');
const { GithubApi } = require('../src/githubApi');
const { AuthManager, PAT_SECRET_KEY_PREFIX, PAT_SECRET_ACCOUNTS_KEY } = require('../src/authManager');

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

    console.log(passed + ' assertions passed' + (process.exitCode ? ' (WITH FAILURES)' : ''));
})();
