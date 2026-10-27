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
    console.log('workflow security');
    await ok('build and packaging jobs use scoped, non-persisted checkout credentials', () => {
        const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'build-and-release.yml'), 'utf8');
        assert.match(workflow, /^permissions:\n  contents: read$/m, 'default workflow token is read-only');
        assert.match(workflow, /^  build:\n    name: Build & Validate VSIX\n    permissions:\n      contents: read\n/m, 'build job is read-only');
        assert.match(workflow, /^      - name: Checkout Repository\n        uses: actions\/checkout@v5\n        with:\n          persist-credentials: false$/m, 'build checkout does not persist its token');
        assert.match(workflow, /^  release:\n    name: Publish GitHub Release\n    needs: build\n    if: .+\n    runs-on: ubuntu-latest\n    permissions:\n      contents: write\n/m, 'only release receives contents:write');
        assert.match(workflow, /^      - name: Checkout Repository\n        uses: actions\/checkout@v4\n        with:\n          persist-credentials: false$/m, 'release checkout does not persist its token');
    });

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

        // Without a token scoped to the requested account, never use ambient gh auth.
        const nullApi = new GithubApi({ getActiveAccount: () => '', getToken: async () => null });
        await assert.rejects(nullApi.listCodespaces('ghost'), /account-bound GitHub token.*ghost/i);

        // Bogus token must reject (401-auth when online, aggregate when offline).
        const api = new GithubApi({ getActiveAccount: () => '', getToken: async () => 'bogus-invalid-token-xyz' });
        await assert.rejects(api.listCodespaces('ghost'), /expired|Couldn't load|missing the "codespace" permission/);
    });
    await ok('Codespaces CLI fallbacks never use ambient auth for a different account', async () => {
        const calls = [];
        const runCommand = async (_cmd, args, _timeout, options = {}) => {
            calls.push({ args, token: options.env && options.env.GH_TOKEN });
            return JSON.stringify([{ name: 'bob-space' }]);
        };
        const noTokenApi = new GithubApi({ getActiveAccount: () => 'bob', getToken: async () => null }, {
            runCommand,
            fetchImpl: async () => { throw new Error('network disabled in test'); }
        });

        await assert.rejects(noTokenApi.listCodespaces('alice'), /account-bound GitHub token.*alice/i);
        await assert.rejects(noTokenApi.startCodespace('bob-space', 'alice'), /account-bound GitHub token.*alice/i);
        await assert.rejects(noTokenApi.stopCodespace('bob-space', 'alice'), /account-bound GitHub token.*alice/i);
        await assert.rejects(noTokenApi.deleteCodespace('bob-space', 'alice'), /account-bound GitHub token.*alice/i);
        await assert.rejects(noTokenApi.rebuildCodespace('bob-space', 'alice'), /account-bound GitHub token.*alice/i);
        await assert.rejects(noTokenApi.createCodespace('octocat/repo', 'main', 'alice'), /account-bound GitHub token.*alice/i);
        assert.deepStrictEqual(await noTokenApi.fetchPorts('bob-space', 'alice'), []);
        assert.deepStrictEqual(await noTokenApi.fetchMeta('bob-space', 'alice'), {});
        assert.deepStrictEqual(await noTokenApi.fetchUserRepos('alice'), []);
        assert.deepStrictEqual(calls, [], 'missing account token must prevent every CLI invocation');

        const notFound = { status: 404, ok: false, headers: { get: () => null }, json: async () => ({ message: 'Not Found' }) };
        const boundApi = new GithubApi({ getActiveAccount: () => 'bob', getToken: async (account) => account === 'alice' ? 'alice-test-token' : null }, {
            runCommand,
            fetchImpl: async () => notFound,
            retryDelayMs: 0
        });
        const listed = await boundApi.listCodespaces('alice');
        assert.strictEqual(listed[0].account, 'alice');
        await boundApi.startCodespace('alice-space', 'alice');
        await boundApi.stopCodespace('alice-space', 'alice');
        await boundApi.deleteCodespace('alice-space', 'alice');
        await boundApi.rebuildCodespace('alice-space', 'alice');
        assert.ok(calls.length >= 5);
        assert.ok(calls.every(call => call.token === 'alice-test-token'), 'all CLI fallback invocations must carry the selected account token');
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
    await ok('checkRemoteFolderExists passes hostile paths as one POSIX-quoted remote command', async () => {
        const sshManager = require('../src/sshManager');
        const paths = [
            '/workspaces/proj; printf POC >&2',
            '/workspaces/$(printf POC >&2)',
            '/workspaces/proj > /tmp/poc',
            '/workspaces/proj\nprintf POC >&2',
            "/workspaces/O'Reilly"
        ];
        for (const folderPath of paths) {
            let capturedArgs;
            const result = await sshManager.checkRemoteFolderExists('cs.test', folderPath, {
                runCommandWithDetails: async (_cmd, args) => {
                    capturedArgs = args;
                    return { stdout: 'exists\n', stderr: '', exitCode: 0 };
                }
            });
            assert.strictEqual(result.exists, true);
            const remoteArgs = capturedArgs.slice(capturedArgs.indexOf('cs.test') + 1);
            const quotedPath = "'" + folderPath.replace(/'/g, "'\\''") + "'";
            assert.deepStrictEqual(remoteArgs, [`test -d ${quotedPath} && echo exists`]);
        }
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
        assert.strictEqual(slow.daysLeftLabel, "won't run out before reset");
        const zero = us.computeStats({ quota: 120, used: 0, daily: daysOf(5, 0), now: NOW, reset: RESET });
        assert.strictEqual(zero.daysLeftLabel, "won't run out before reset");
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
    await ok('404 with user scope -> clear error with reason + gh command, no guessed numbers', async () => {
        const svc = new us.UsageService({ authManager: { getToken: async () => 't' }, now: () => NOW, fetchImpl: makeFetch([
            [/\/user$/, () => fakeResp(200, userBody('carol', 'free'), 'repo, codespace, user')],
            [/\/user\/codespaces/, () => fakeResp(200, csList('carol'))],
            [/usage\/summary/, () => fakeResp(404, { message: 'Not Found' })]
        ]) });
        const u = await svc.getAccountUsage('carol');
        assert.strictEqual(u.mode, 'error');
        assert.strictEqual(u.stats, undefined, 'no figures');
        assert.match(u.error, /404/);
        const card = uv.hubUsageCardHtml(u);
        assert.match(card, /Usage unavailable/);
        assert.match(card, /enhanced billing platform/);
        assert.ok(!/gh auth refresh/.test(card), 'scope is present, so no scope fix is suggested');
        assert.ok(!/core-hrs|Estimated/.test(card));
        assert.ok(!/core-hrs|Estimated/.test(uv.sidebarSummaryHtml(u, 'n')));
        assert.strictEqual(uv.storageTierText(u), '15 GB-month · Free', 'plan from the API');
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
    await ok('unknown compute SKU core count -> error state (no 1-core guess) and SKU logged', async () => {
        assert.strictEqual(us.parseSummary({ usageItems: [{ product: 'codespaces', sku: 'Codespaces compute premium', grossQuantity: 10 }] }).computeCoreHours, 0);
        const logs = [];
        const svc = new us.UsageService({ authManager: { getToken: async () => 't' }, now: () => NOW, log: (m) => logs.push(m), fetchImpl: makeFetch([
            [/\/user$/, () => fakeResp(200, userBody('gus', 'free'), 'user')],
            [/\/user\/codespaces/, () => fakeResp(200, { codespaces: [] })],
            [/usage\/summary/, () => fakeResp(200, { usageItems: [{ product: 'codespaces', sku: 'Codespaces compute premium', grossQuantity: 10, discountQuantity: 10 }] })]
        ]) });
        const u = await svc.getAccountUsage('gus');
        assert.strictEqual(u.mode, 'error');
        assert.match(u.error, /Codespaces compute premium/);
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
    await ok('real billing fixtures: summary + daily parse to GitHub billing page numbers', async () => {
        const sumFx = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'billing-usage-summary.json'), 'utf8'));
        const dayFx = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'billing-usage-daily.json'), 'utf8'));
        assert.strictEqual(us.coresFromSku('codespaces_compute_d2'), 2);
        assert.strictEqual(us.coresFromSku('codespaces_compute_c4'), 4);
        assert.strictEqual(us.coresFromSku('Codespaces compute 2-core'), 2);
        assert.strictEqual(us.coresFromSku('codespaces_compute_16_core'), 16);
        assert.strictEqual(us.coresFromSku('codespaces_storage'), null);
        const p = us.parseSummary(sumFx);
        assert.deepStrictEqual(p.unknownSkus, []);
        assert.ok(Math.abs(p.computeCoreHours - 76.48) < 0.01, 'core-hours ' + p.computeCoreHours);
        assert.ok(Math.abs(p.storageGbMonths - 7.64) < 0.01, 'storage ' + p.storageGbMonths);
        assert.ok(Math.abs(p.computeAmount - 6.88) < 0.01);
        assert.ok(Math.abs(p.storageAmount - 0.53) < 0.01);
        assert.ok(Math.abs(p.grossAmount - 7.42) < 0.01, 'consumed ' + p.grossAmount);
        assert.strictEqual(p.netAmount, 0);
        const d = us.parseDaily(dayFx, '2026-10-01T00:00:00Z');
        const amt = Object.fromEntries(d.repos.map(r => [r.repo, Math.round(r.amount * 100) / 100]));
        assert.strictEqual(amt['repo-a'], 6.92);
        assert.strictEqual(amt['repo-b'], 0.35);
        assert.strictEqual(amt['repo-c'], 0.16);
        assert.ok(Object.keys(d.daily).length >= 3);

        const svc = new us.UsageService({ authManager: { getToken: async () => 't' }, now: () => Date.UTC(2026, 9, 21, 12), fetchImpl: makeFetch([
            [/\/user$/, () => fakeResp(200, userBody('octocat', 'pro'), 'user, codespace')],
            [/\/user\/codespaces/, () => fakeResp(200, { codespaces: [{ name: 'x', state: 'Shutdown', machine: { cpus: 2, storage_in_bytes: 103e9 }, billable_owner: { login: 'octocat' } }] })],
            [/usage\/summary/, () => fakeResp(200, sumFx)],
            [/settings\/billing\/usage\?/, () => fakeResp(200, dayFx)]
        ]) });
        const u = await svc.getAccountUsage('octocat');
        assert.strictEqual(u.mode, 'live');
        assert.deepStrictEqual(u.compute, { used: 76.5, quota: 180, amount: 6.88, quotaValue: 16.2 });
        assert.deepStrictEqual(u.storage, { used: 7.64, quota: 20, amount: 0.53, quotaValue: 1.4 });
        assert.deepStrictEqual(u.dollars, { consumed: 7.42, discount: 7.42, billable: 0 });
        assert.strictEqual(Math.round(us.resolvePlan('free').coreHours * us.CORE_HOUR_PRICE * 100) / 100, 10.8);
        assert.strictEqual(u.repos[0].repo, 'repo-a');
        const card = uv.hubUsageCardHtml(u);
        assert.ok(!/Estimated/.test(card));
        assert.match(card, /76\.5<\/b> \/ 180 core-hrs <small>\(\$6\.88 of \$16\.20\)/);
        assert.match(card, /7\.6<\/b> \/ 20 GB-month <small>\(\$0\.53 of \$1\.40\)/);
        assert.match(card, /\$7\.42 consumed · −\$7\.42 included discount · <b>\$0\.00 billable/);
        assert.ok(!/of \$17\.60/.test(card), 'no combined quota');
        const page = uv.hubUsagePageHtml(u);
        assert.match(page, /Per repository/);
        assert.match(page, /repo-a/);
        assert.match(page, /\$6\.92/);
        assert.strictEqual(uv.storageTierText(u), '7.6 / 20 GB-month');
    });
    await ok('billing API 5xx -> real error state with reason', async () => {
        const svc = new us.UsageService({ authManager: { getToken: async () => 't' }, now: () => NOW, fetchImpl: makeFetch([
            [/\/user$/, () => fakeResp(200, userBody('ivy', 'free'), 'user')],
            [/\/user\/codespaces/, () => fakeResp(200, { codespaces: [] })],
            [/usage\/summary/, () => fakeResp(502, { message: 'Bad Gateway' })]
        ]) });
        const u = await svc.getAccountUsage('ivy');
        assert.strictEqual(u.mode, 'error');
        assert.match(u.error, /502: Bad Gateway/);
        assert.match(uv.hubUsagePageHtml(u), /Usage unavailable/);
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
            repos: [{ repo: 'a/x', coreHours: 30, storageGbMonths: 1, amount: 2.7, share: 100 }], storageRows: [] });
        const u = mk(30);
        const card = uv.hubUsageCardHtml(u, '');
        assert.match(card, /USAGE · a · Free/);
        assert.match(card, /30<\/b> \/ 120 core-hrs/);
        assert.match(card, /HOURS LEFT/);
        assert.match(card, /DAYS LEFT/);
        assert.match(uv.hubUsageCardHtml(mk(95)), /usage-fill amber/);
        assert.match(uv.hubUsageCardHtml(mk(110)), /usage-fill red/);
        assert.strictEqual(uv.storageTierText(u), '2 / 15 GB-month');
        assert.strictEqual(uv.storageTierText(null), '', 'unknown plan -> tile hidden, never a hardcoded tier');
        const page = uv.hubUsagePageHtml(u);
        assert.match(page, /id="usagePage"/);
        assert.match(page, /Resets<\/span><b>/);
        assert.match(page, /<svg/);
        assert.match(page, /stroke-dasharray/);
        assert.match(page, /class="usage-table sortable"/);
        assert.match(page, /Updated hourly · last fetched/);
        assert.match(page, /\$2\.70/);
    });
    await ok('Cloud Hub dashboard integrates usage (rail item, card, page) and no separate usage webview', () => {
        const src = fs.readFileSync(path.join(ROOT, 'src', 'dashboardProvider.js'), 'utf8');
        assert.ok(src.includes('railUsageBtn'));
        assert.ok(src.includes('hubUsageCardHtml(this._usage'));
        assert.ok(src.includes('hubUsagePageHtml(this._usage, this._usageOpts)'));
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

    // ── Usage analytics v2 (deeper detail; all from billing data or arithmetic on it) ──
    console.log('usage analytics v2');
    const FX = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', n), 'utf8'));
    const OCT_SUM = FX('billing-usage-summary.json'), OCT_DAY = FX('billing-usage-daily.json');
    const SEP_SUM = FX('billing-usage-summary-2026-09.json'), SEP_DAY = FX('billing-usage-daily-2026-09.json');
    const FX_NOW2 = Date.UTC(2026, 9, 21, 12);
    function fxService(extra = {}) {
        const calls = [];
        const pick = (url) => /month=9\b/.test(url);
        const svc = new us.UsageService({ authManager: { getToken: async () => 't' }, now: () => FX_NOW2, ...extra, fetchImpl: makeFetch([
            [/\/user$/, () => fakeResp(200, userBody('octocat', 'pro'), 'user')],
            [/\/user\/codespaces/, () => fakeResp(200, { codespaces: [] })],
            [/usage\/summary/, (url) => fakeResp(200, pick(url) ? SEP_SUM : /month=8\b/.test(url) ? { usageItems: [] } : OCT_SUM)],
            [/settings\/billing\/usage\?/, (url) => fakeResp(200, pick(url) ? SEP_DAY : OCT_DAY)]
        ], calls) });
        return { svc, calls };
    }
    await ok('computeStats: avg uses days elapsed in the cycle (bug fix), not days since first usage', () => {
        const start = Date.UTC(2026, 9, 1), reset = Date.UTC(2026, 10, 1);
        const daily = { '2026-10-01': 20, '2026-10-02': 20 };
        const s = us.computeStats({ quota: 120, used: 40, daily, now: Date.UTC(2026, 9, 10, 12), reset, cycleStart: start });
        assert.strictEqual(s.avgPerDay, 0, 'no usage in the last 7 days');
        assert.strictEqual(s.daysLeftLabel, "won't run out before reset");
        const early = us.computeStats({ quota: 120, used: 40, daily, now: Date.UTC(2026, 9, 2, 12), reset, cycleStart: start });
        assert.strictEqual(early.daysLeftLabel, 'not enough data');
        const mid = us.computeStats({ quota: 120, used: 40, daily: { '2026-10-09': 7, '2026-10-10': 7 }, now: Date.UTC(2026, 9, 10, 12), reset, cycleStart: start });
        assert.strictEqual(mid.avgPerDay, 2, '14 core-hrs over 7 days');
        assert.strictEqual(mid.avgWindowDays, 7);
    });
    await ok('buildAnalytics: projection, run-out date, hours left per machine size, peak/active/today', () => {
        const start = new Date(Date.UTC(2026, 9, 1)), reset = new Date(Date.UTC(2026, 10, 1));
        const now = new Date(Date.UTC(2026, 9, 21, 0));
        const daily = {}; for (let i = 15; i <= 21; i++) daily[`2026-10-${i}`] = 10;
        const stats = us.computeStats({ quota: 120, used: 100, daily, now, reset, cycleStart: start });
        const a = us.buildAnalytics({ stats, quota: 120, daily, dailyAmount: { '2026-10-18': 1.8 }, cycleStart: start, reset, now, isCurrent: true });
        assert.strictEqual(a.projectionLabel, 'runs out');
        assert.strictEqual(a.runOutDate, new Date(now.getTime() + 2 * 86400000).toISOString());
        assert.strictEqual(a.projectedEnd, 210);
        assert.deepStrictEqual(a.remainingByMachine.map(m => m.hours), [10, 5, 2.5, 1.3, 0.6]);
        assert.strictEqual(a.activeDays, 7);
        assert.strictEqual(a.totalDays, 31);
        assert.strictEqual(a.today.value, 10);
        assert.strictEqual(a.series.filter(p => !p.future).pop().cumulative, 70);
        assert.ok(Math.abs(a.series[30].pace - 120) < 1e-9);
        const ok2 = us.buildAnalytics({ stats: us.computeStats({ quota: 120, used: 30, daily: { '2026-10-20': 1 }, now, reset, cycleStart: start }), quota: 120, daily: {}, cycleStart: start, reset, now });
        assert.strictEqual(ok2.projectionLabel, "won't run out before reset");
        assert.strictEqual(ok2.runOutDate, null);
        const closed = us.buildAnalytics({ stats, quota: 120, daily, cycleStart: start, reset, now, isCurrent: false });
        assert.strictEqual(closed.projectionLabel, 'Closed month');
        assert.strictEqual(closed.today, null);
    });
    await ok('parseDaily (fixture): per-repo SKU breakdown, daily maps, storage per day, export rows', () => {
        const d = us.parseDaily(OCT_DAY, '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z');
        const a = d.repos.find(r => r.repo === 'repo-a');
        assert.ok(a.skus.some(k => k.kind === 'compute' && k.cores === 2));
        assert.ok(a.skus.some(k => k.kind === 'storage'));
        const skuSum = a.skus.reduce((t, k) => t + k.amount, 0);
        assert.ok(Math.abs(skuSum - a.amount) < 1e-9);
        assert.ok(Math.abs(Object.values(a.daily).reduce((t, v) => t + v, 0) - a.coreHours) < 1e-9);
        const st = Object.values(d.dailyStorage).reduce((t, v) => t + v, 0);
        assert.ok(Math.abs(st - d.repos.reduce((t, r) => t + r.storageGbMonths, 0)) < 1e-9);
        assert.strictEqual(d.rows.length, OCT_DAY.usageItems.length);
        const outside = us.parseDaily(OCT_DAY, '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z');
        assert.strictEqual(outside.rows.length, 0, 'rows outside the period are dropped');
    });
    await ok('service (fixtures): current month analytics + month-over-month vs previous month', async () => {
        const { svc } = fxService();
        const u = await svc.getAccountUsage('octocat');
        assert.strictEqual(u.mode, 'live');
        assert.strictEqual(u.isCurrent, true);
        assert.deepStrictEqual(u.period, { year: 2026, month: 10 });
        assert.ok(u.analytics && u.analytics.series.length === 31);
        assert.ok(u.mom, 'previous month compared');
        assert.ok(Math.abs(u.mom.coreHours.previous - 118.06) < 0.02, String(u.mom.coreHours.previous));
        assert.ok(Math.abs(u.mom.consumed.previous - 11.70) < 0.02, String(u.mom.consumed.previous));
        assert.ok(u.mom.coreHours.delta < 0);
        assert.strictEqual(u.months.length, 6);
        assert.ok(u.months[0].current && u.months[0].month === 10);
        assert.strictEqual(u.analytics.remainingByMachine[0].hours, Math.round(((180 - u.stats.used) / 2) * 10) / 10);
    });
    await ok('service (fixtures): previous month via period is a closed month with its own numbers and cache entry', async () => {
        const { svc, calls } = fxService();
        const sep = await svc.getAccountUsage('octocat', { year: 2026, month: 9 });
        assert.strictEqual(sep.isCurrent, false);
        assert.strictEqual(sep.analytics.projectionLabel, 'Closed month');
        assert.ok(Math.abs(sep.compute.used - 118.1) < 0.05, String(sep.compute.used));
        assert.ok(Math.abs(sep.storage.used - 15.48) < 0.01);
        assert.strictEqual(sep.resetDate, '2026-10-01T00:00:00.000Z');
        assert.ok(calls.some(c => /month=9\b/.test(c.url)));
        const oct = await svc.getAccountUsage('octocat');
        assert.notStrictEqual(oct.compute.used, sep.compute.used, 'separate cache entries per month');
        await assert.rejects(() => svc.getAccountUsage('octocat', { year: 2026, month: 12 }), /Future/);
    });
    await ok('toCsv / toJson export the API rows (quoted, no tokens)', async () => {
        const { svc } = fxService();
        const u = await svc.getAccountUsage('octocat');
        const csv = us.toCsv(u);
        const lines = csv.trim().split('\r\n');
        assert.strictEqual(lines[0], 'date,repository,sku,unit_type,quantity,core_hours,gb_months,gross_amount_usd,discount_amount_usd,net_amount_usd');
        assert.strictEqual(lines.length, OCT_DAY.usageItems.length + 1);
        assert.strictEqual(us.toCsv({ rows: [{ date: 'd', repository: 'a,"b"', sku: 's', unitType: 'u', quantity: 1, coreHours: null, gbMonths: 1, grossAmount: 0, discountAmount: 0, netAmount: 0 }] }).split('\r\n')[1].split(',')[1], '"a');
        const j = JSON.parse(us.toJson(u));
        assert.strictEqual(j.account, 'octocat');
        assert.strictEqual(j.rows.length, OCT_DAY.usageItems.length);
        assert.ok(!/Bearer|token/i.test(us.toJson(u)));
        assert.ok(Math.abs(j.repositories.reduce((t, r) => t + r.amount, 0) - 7.42) < 0.02);
    });
    await ok('toCsv neutralises formula injection (= + - @ tab CR) but keeps numbers', () => {
        const row = (repo) => ({ date: '2026-10-01', repository: repo, sku: 's', unitType: 'u', quantity: -1.5, coreHours: null, gbMonths: null, grossAmount: 0, discountAmount: -0.2, netAmount: 0 });
        const cell = (repo) => us.toCsv({ rows: [row(repo)] }).split('\r\n')[1];
        assert.ok(cell('=HYPERLINK("x")').startsWith('2026-10-01,"\'=HYPERLINK(""x"")"'));
        for (const p of ['+1', '-1', '@SUM(A1)', '\tx']) assert.ok(cell(p).split(',')[1].startsWith("'" + p[0]), p);
        assert.ok(cell('\rx').split(',')[1].startsWith('"\'\r'));
        assert.strictEqual(cell('repo-a').split(',')[1], 'repo-a');
        assert.ok(cell('repo-a').includes(',-1.5,'), 'numeric negatives untouched');
    });
    await ok('pendingAlerts: configurable thresholds, once per month/quota, not for closed months', () => {
        const u = { mode: 'live', isCurrent: true, login: 'octocat', period: { year: 2026, month: 10 }, compute: { used: 140, quota: 180 }, storage: { used: 19, quota: 20 } };
        const a = us.pendingAlerts(u, [75, 90], {});
        assert.deepStrictEqual(a.map(x => x.kind + x.threshold), ['compute75', 'storage75', 'storage90']);
        const shown = Object.fromEntries(a.map(x => [x.key, 1]));
        assert.strictEqual(us.pendingAlerts(u, [75, 90], shown).length, 0);
        assert.strictEqual(us.pendingAlerts(u, [50], {}).length, 2);
        assert.strictEqual(us.pendingAlerts({ ...u, isCurrent: false }, [75], {}).length, 0);
        assert.strictEqual(us.pendingAlerts(u, [], {}).length, 0);
    });
    await ok('monthOptions wraps across years', () => {
        const m = us.monthOptions(new Date(Date.UTC(2026, 1, 10)), 4);
        assert.deepStrictEqual(m.map(x => `${x.year}-${x.month}`), ['2026-2', '2026-1', '2025-12', '2025-11']);
    });
    await ok('Usage page v2: projection, machine sizes, charts with tooltips, MoM, filter/expand, export, links, storage tip', async () => {
        const { svc } = fxService();
        const u = await svc.getAccountUsage('octocat');
        const page = uv.hubUsagePageHtml(u);
        assert.ok(!/Full cycle/.test(page));
        assert.match(page, /At this pace: ~[\d.]+ core-hrs by reset/);
        assert.match(page, /2-core<\/span><b>[\d.]+ h<\/b>/);
        assert.match(page, /4-core machine uses your quota 2× as fast/);
        assert.match(page, /<title>Oct \d+: [\d.]+ core-hrs · \$[\d.]+<\/title>/);
        assert.match(page, /Cumulative vs pace/);
        assert.match(page, /Daily storage GB-month sparkline/);
        assert.match(page, /FORECAST.*?~[\d.]+ \/ 180.*?by Nov 1 · (won't run out|runs out)/s);
        assert.ok(!/DAYS LEFT|PROJECTED BY RESET/.test(page), 'merged into Forecast');
        assert.strictEqual((page.match(/class="usage-tile"/g) || []).length, 4, '4 tiles, no orphan row');
        assert.match(page, /usage-qfacts.*?Billable.*?Resets/s);
        assert.match(page, /class="usage-scroll"><table class="usage-table sortable" id="usageRepoTable"/);
        assert.match(page, /Compared with September 2026/);
        assert.match(page, /id="usageRepoFilter"/);
        assert.match(page, /class="usage-expand" aria-expanded="false"/);
        assert.match(page, /data-usage-export="csv"/);
        assert.match(page, /data-usage-export="json"/);
        assert.match(page, /data-usage-url="https:\/\/github\.com\/settings\/billing"/);
        assert.match(page, /data-usage-url="https:\/\/github\.com\/settings\/codespaces"/);
        assert.match(page, /Most storage this month: <b>repo-a<\/b>/);
        assert.match(page, /including stopped ones/);
        assert.match(page, /id="usageMonth"/);
        assert.match(page, /usage-derived/);
        assert.match(page, /AVG \/ DAY.*?<span class="kpi-value">\d+\.\d<\/span>/s, 'avg/day with one decimal');
        assert.ok(!/<button[^>]*>[^<]*delete/i.test(page), 'no delete action');
        const card = uv.hubUsageCardHtml(u);
        assert.match(card, /At this pace/);
        const dollars = uv.hubUsageCardHtml(u, '', { preferredUnit: 'dollars' });
        assert.match(dollars, /<b>\$6\.88<\/b> \/ \$16\.20 <small>\(76\.5 \/ 180 core-hrs\)/);
        assert.strictEqual(uv.sidebarSummaryHtml(u, 'n', { show: false }), '');
        assert.match(uv.sidebarSummaryHtml(u, 'n', { preferredUnit: 'dollars' }), /\$6\.88 \/ \$16\.20 compute/);
    });
    await ok('package.json contributes v2 usage settings', () => {
        const props = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).contributes.configuration.properties;
        assert.deepStrictEqual(props['antigravity-codespaces.usage.alertThresholds'].default, [75, 90]);
        assert.strictEqual(props['antigravity-codespaces.usage.refreshMinutes'].minimum, 5);
        assert.strictEqual(props['antigravity-codespaces.usage.showSidebarLine'].default, true);
        assert.deepStrictEqual(props['antigravity-codespaces.usage.preferredUnit'].enum, ['core-hours', 'dollars']);
    });

    // ── Error hardening + error UX (one test per spec row) ──
    console.log('error hardening');
    const gapi = require(path.join(ROOT, 'src', 'githubApi.js'));
    const eux = require(path.join(ROOT, 'src', 'errorUx.js'));
    const { launchIde } = require(path.join(ROOT, 'src', 'launcher.js'));
    const hang = (url, opts) => new Promise((_, rej) => { opts.signal.addEventListener('abort', () => rej(opts.signal.reason)); });
    const resp = (status, body = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => body, headers: { get: () => null } });
    await ok('ghFetch: hanging request aborts with "GitHub isn\'t responding" (timeout kind)', async () => {
        await assert.rejects(() => gapi.ghFetch('https://api.github.com/x', {}, { fetchImpl: hang, timeoutMs: 50 }), (e) => e.kind === 'timeout' && /GitHub isn't responding/.test(e.message));
        assert.strictEqual(gapi.FETCH_TIMEOUT_MS, 15000);
    });
    await ok('ghFetch: 503 retried once, then "GitHub is having trouble right now." (server kind)', async () => {
        let n = 0;
        await assert.rejects(() => gapi.ghFetch('u', {}, { fetchImpl: async () => { n++; return resp(503); }, retryDelayMs: 0 }), (e) => e.kind === 'server' && e.status === 503 && /having trouble/.test(e.message));
        assert.strictEqual(n, 2, 'auto-retry once');
        let m = 0;
        const r = await gapi.ghFetch('u', {}, { fetchImpl: async () => (++m === 1 ? resp(502) : resp(200)), retryDelayMs: 0 });
        assert.strictEqual(r.status, 200);
    });
    await ok('ghFetch: network failure -> network kind; every fetch in githubApi goes through the timeout wrapper', async () => {
        await assert.rejects(() => gapi.ghFetch('u', {}, { fetchImpl: async () => { throw new TypeError('fetch failed'); } }), (e) => e.kind === 'network');
        const src = fs.readFileSync(path.join(ROOT, 'src', 'githubApi.js'), 'utf8');
        assert.strictEqual((src.match(/await fetch\(/g) || []).length, 0);
        assert.strictEqual((src.match(/await this\._fetch\(/g) || []).length, 6);
        assert.ok(src.includes('new AbortController()') && src.includes('clearTimeout(timer)'));
    });
    await ok('listCodespaces: a timeout surfaces immediately (no slow CLI fallback)', async () => {
        const api = new gapi.GithubApi({ getToken: async () => 't', getActiveAccount: () => 'octocat' }, { fetchImpl: hang, timeoutMs: 30 });
        await assert.rejects(() => api.listCodespaces('octocat'), (e) => e.kind === 'timeout');
    });
    await ok('launchIde: spawn error / non-zero exit -> not connected; running process -> connected', async () => {
        const { EventEmitter } = require('events');
        const fake = (behave) => () => { const c = new EventEmitter(); c.unref = () => {}; setTimeout(() => behave(c), 5); return c; };
        const e1 = await launchIde('ide', [], { execFileImpl: fake(c => c.emit('error', new Error('spawn ENOENT'))), settleMs: 200 });
        assert.strictEqual(e1.ok, false); assert.match(e1.reason, /ENOENT/);
        const e2 = await launchIde('ide', [], { execFileImpl: fake(c => c.emit('exit', 1)), settleMs: 200 });
        assert.strictEqual(e2.ok, false); assert.match(e2.reason, /code 1/);
        const e3 = await launchIde('ide', [], { execFileImpl: fake(() => {}), settleMs: 30 });
        assert.strictEqual(e3.ok, true);
        const e4 = await launchIde('ide', [], { execFileImpl: () => { throw new Error('EACCES'); } });
        assert.strictEqual(e4.ok, false);
    });
    await ok('classifyError rows: timeout / 5xx / offline / auth / scope / rate limit / other', () => {
        const k = (kind, msg = 'x', status) => { const e = new Error(msg); e.kind = kind; e.status = status; return eux.classifyError(e); };
        const t = k('timeout'); assert.strictEqual(t.title, "GitHub isn't responding (15s)."); assert.deepStrictEqual(t.actions.slice(0, 2), ['retry', 'workOffline']); assert.strictEqual(t.level, 'warning');
        const s5 = k('server', 'x', 503); assert.strictEqual(s5.title, 'GitHub is having trouble right now.'); assert.deepStrictEqual(s5.actions.slice(0, 2), ['retry', 'githubStatus']);
        assert.strictEqual(k('network').level, 'warning');
        assert.deepStrictEqual(eux.classifyError(new Error('GitHub authentication expired or token is invalid.')).actions[0], 'signIn');
        assert.strictEqual(eux.classifyError(new Error('Account "a" is missing the "codespace" permission.')).level, 'warning');
        assert.strictEqual(eux.classifyError(new Error('GitHub API rate limit reached.')).kind, 'rateLimit');
        assert.ok(eux.classifyError(new Error('boom')).actions.includes('details'), 'Details button opens the log');
    });
    await ok('messages never show stack traces or "undefined"', () => {
        const e = new Error('Request failed: undefined'); e.stack = 'Error: Request failed: undefined\n    at foo (x.js:1:1)';
        assert.strictEqual(eux.cleanReason(e), 'Request failed');
        assert.strictEqual(eux.cleanReason('TypeError: x is undefined\n    at a (b:1)'), 'x is');
        assert.strictEqual(eux.cleanReason(undefined), 'Unknown error.');
        assert.ok(!/undefined/.test(eux.notificationText(eux.classifyError(undefined))));
    });
    await ok('connect failure: "Couldn\'t open <repo> in this IDE." [Run Setup Doctor][Copy SSH command]; card reverts', () => {
        const c = eux.connectFailure('octocat/repo-a', 'The IDE launcher exited with code 1.');
        assert.strictEqual(c.title, "Couldn't open octocat/repo-a in this IDE.");
        assert.deepStrictEqual(c.actions.slice(0, 2), ['setupDoctor', 'copySsh']);
        const src = fs.readFileSync(path.join(ROOT, 'extension.js'), 'utf8');
        assert.ok(src.includes('launchIde(ANTIGRAVITY_EXE'), 'launcher awaited before connected=true');
        assert.ok(!/child\.on\('error', \(\) => \{\}\)/.test(src));
        const tier4 = src.slice(src.indexOf('errorUx.connectFailure('), src.indexOf('errorUx.connectFailure(') + 400);
        assert.ok(/dashboardProvider\.refreshHtml\(\)/.test(tier4), 'views refresh so the card shows Available again');
    });
    await ok('reconnect: start failure shows the real reason and skips SSH', () => {
        const nf = new Error('HTTP 404: Not Found');
        assert.match(eux.startFailure('cs-1', nf).why, /no longer exists/);
        assert.match(eux.startFailure('cs-1', new Error('HTTP 402 spending limit')).why, /quota or spending limit/);
        const src = fs.readFileSync(path.join(ROOT, 'extension.js'), 'utf8');
        const rc = src.slice(src.indexOf("'antigravity-codespaces.reconnectLast'"), src.indexOf("'antigravity-codespaces.reconnectLast'") + 2200);
        assert.ok(!rc.includes('.catch(() => {})'));
        assert.ok(rc.indexOf('if (startErr)') > 0 && rc.indexOf('return;', rc.indexOf('if (startErr)')) < rc.indexOf("'antigravity-codespaces.connect'"));
    });
    await ok('no empty catch blocks in extension.js / dashboardProvider.js; metadata failure is logged (silent)', () => {
        const ext = fs.readFileSync(path.join(ROOT, 'extension.js'), 'utf8');
        const dash = fs.readFileSync(path.join(ROOT, 'src', 'dashboardProvider.js'), 'utf8');
        assert.strictEqual((ext.match(/catch\s*(\(\w*\))?\s*\{\s*\}/g) || []).length, 0);
        assert.strictEqual((dash.match(/catch\s*(\(\w*\))?\s*\{\s*\}/g) || []).length, 0);
        assert.match(ext, /metadata for \$\{cs\.name\} unavailable/);
    });
    await ok('banner: icon + text label (not colour only), dismissible, "as of <time>" over cached data', () => {
        const h = eux.bannerHtml(eux.classifyError(Object.assign(new Error('x'), { kind: 'timeout' })), { asOf: '10:42' });
        assert.match(h, /class="ux-icon"[^>]*>⚠️/); assert.match(h, /class="ux-label">Warning</);
        assert.match(h, /class="ux-dismiss"/); assert.match(h, /Showing data as of 10:42/);
        assert.match(h, /role="status"/);
        assert.match(eux.bannerHtml({ kind: 'k', level: 'warning', title: 't', actions: [] }), /class="ux-label">Warning</);
        assert.match(eux.skeletonHtml(2), /aria-busy="true"/);
        assert.strictEqual((eux.skeletonHtml(2).match(/ux-skel-card/g) || []).length, 2);
    });
    await ok('Cloud Hub: account error banner over cached list; empty / signed-out copy; spinner on busy buttons; Windsurf Remote SSH', () => {
        const Module = require('module');
        const orig = Module._resolveFilename;
        Module._resolveFilename = function (r, ...a) { return r === 'vscode' ? 'vscode' : orig.call(this, r, ...a); };
        require.cache.vscode = { id: 'vscode', filename: 'vscode', loaded: true, exports: { window: {}, commands: {}, env: {}, Uri: {}, ViewColumn: {}, workspace: { getConfiguration: () => ({ get: (k, d) => d }) } } };
        try {
            const D = require(path.join(ROOT, 'src', 'dashboardProvider.js'));
            const DP = D.DashboardProvider || D;
            const warm = DP.accountErrorBanners([{ account: 'octocat', error: "Couldn't reach GitHub.", errorKind: 'network', cachedAt: Date.UTC(2026, 9, 21, 5, 0) }]);
            assert.match(warm, /ux-warning/); assert.match(warm, /Showing data as of/);
            const cold = DP.accountErrorBanners([{ account: 'octocat', error: 'x', errorKind: 'server', errorStatus: 503 }]);
            assert.match(cold, /ux-critical/); assert.match(cold, /GitHub Status/);
            const near = DP.usageBanner({ mode: 'live', isCurrent: true, compute: { used: 150, quota: 180 }, storage: { used: 2, quota: 20 } });
            assert.match(near, /ux-warning/); assert.match(near, /compute 83%/);
            assert.strictEqual(DP.usageBanner({ mode: 'live', isCurrent: true, compute: { used: 10, quota: 180 }, storage: { used: 2, quota: 20 } }), '');
            assert.match(DP.usageBanner({ mode: 'needsPermission' }), /user/);
            assert.match(DP.usageBanner({ mode: 'live', offline: true, fetchedAt: Date.now() }), /as of/);
            const p = Object.create(DP.prototype); p._usage = null; p._initialPage = null; p._context = { extensionUri: {} };
            const out = p.buildDashboardHtml([], '', []);
            assert.match(out, /You're signed out\./); assert.match(out, /Sign in with gh/);
            const empty = p.buildDashboardHtml([{ account: 'octocat', type: 'gh', codespaces: [] }], 'octocat', ['octocat']);
            assert.match(empty, /No codespaces yet\./); assert.match(empty, /Create codespace/);
            const failed = p.buildDashboardHtml([{ account: 'octocat', type: 'gh', codespaces: [], error: 'x', errorKind: 'timeout' }], 'octocat', ['octocat']);
            assert.ok(!/No codespaces yet/.test(failed), 'a failed load is not shown as empty');
            assert.match(failed, /GitHub isn(&#39;|')t responding/);
            const src = fs.readFileSync(path.join(ROOT, 'src', 'dashboardProvider.js'), 'utf8');
            assert.match(src, /btn-spin.*Connecting…/);
            assert.ok(src.includes('errorUx.skeletonHtml(3)'));
        const SD = require(path.join(ROOT, 'src', 'systemDoctor.js'));
            const w = (SD.SystemDoctor || SD).detectRemoteSsh(['codeium.windsurf-remote-openssh'], 'Windsurf');
            assert.strictEqual(w.has, true); assert.strictEqual(w.id, 'codeium.windsurf-remote-openssh');
            assert.deepStrictEqual((SD.SystemDoctor || SD).detectRemoteSsh(['codeium.windsurf-remote-openssh', 'jeanp413.open-remote-ssh'], 'Windsurf').conflicts, ['jeanp413.open-remote-ssh']);
            assert.strictEqual((SD.SystemDoctor || SD).detectRemoteSsh(['foo.bar'], 'Visual Studio Code').has, false);
            const SDc = SD.SystemDoctor || SD;
            assert.strictEqual(SDc.detectRemoteSsh(['codeium.windsurf-remote-openssh'], 'Some Renamed IDE').isWindsurf, true, 'detected by extension, not name');
            assert.strictEqual(SDc.detectRemoteSsh([], 'Devin Desktop').isWindsurf, true);
            assert.strictEqual(SDc.detectRemoteSsh(['ms-vscode-remote.remote-ssh'], 'Visual Studio Code').isWindsurf, false);
        } finally { Module._resolveFilename = orig; delete require.cache.vscode; }
    });
    await ok('docs: keep-alive guide uses accept-new; SECURITY/CONTRIBUTING no longer 4.3.x', () => {
        const g = fs.readFileSync(path.join(ROOT, 'docs', 'AI_AGENT_KEEP_ALIVE_GUIDE.md'), 'utf8');
        assert.ok(!/StrictHostKeyChecking no/.test(g)); assert.match(g, /StrictHostKeyChecking accept-new/);
        assert.match(fs.readFileSync(path.join(ROOT, 'SECURITY.md'), 'utf8'), /5\.3\.x/);
        assert.ok(!/4\.3\.0/.test(fs.readFileSync(path.join(ROOT, 'CONTRIBUTING.md'), 'utf8')));
    });

    // ── Usage-side gaps (a–g) + design review ──
    console.log('usage error gaps + design');
    const SUM_OK = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'billing-usage-summary.json'), 'utf8'));
    const svcWith = (routes) => new us.UsageService({ authManager: { getToken: async () => 't' }, now: () => Date.UTC(2026, 9, 21, 12), fetchImpl: makeFetch(routes) });
    const userOk = [/\/user$/, () => fakeResp(200, userBody('octocat', 'pro'), 'codespace, user')];
    const csOk = [/\/user\/codespaces/, () => fakeResp(200, { codespaces: [] })];
    const withHeaders = (status, body, h) => ({ status, ok: false, json: async () => body, headers: { get: (k) => h[k.toLowerCase()] ?? null } });
    await ok('(a) malformed 200 body / non-numeric quantity -> "Usage data unavailable (unexpected response)", never 0 or NaN', async () => {
        for (const bad of ['<html>', null, {}, { usageItems: 'x' }, { usageItems: [{ product: 'Codespaces', sku: 'codespaces_compute_d2', grossQuantity: 'abc' }] }, { usageItems: [{ product: 'Codespaces', sku: 'codespaces_storage' }] }]) {
            const u = await svcWith([userOk, csOk, [/usage\/summary/, () => fakeResp(200, bad)]]).getAccountUsage('octocat');
            assert.strictEqual(u.mode, 'error', JSON.stringify(bad)); assert.strictEqual(u.kind, 'malformed');
            assert.strictEqual(u.error, 'Usage data unavailable (unexpected response).');
            const card = uv.hubUsageCardHtml(u); assert.match(card, /Usage data unavailable \(unexpected response\)/);
            assert.ok(!/NaN|>0 \//.test(card + uv.sidebarSummaryHtml(u, 'n')));
        }
        assert.strictEqual(us.billingShapeError({ usageItems: [] }), '', 'empty month is valid');
        assert.strictEqual(us.billingShapeError(SUM_OK), '');
    });
    await ok('(b) 401 from /user -> "GitHub sign-in expired" with [Sign in again]', async () => {
        const u = await svcWith([[/\/user$/, () => fakeResp(401, { message: 'Bad credentials' })]]).getAccountUsage('octocat');
        assert.strictEqual(u.kind, 'auth'); assert.match(u.error, /GitHub sign-in expired/);
        assert.match(uv.hubUsageCardHtml(u), /data-usage-signin="1">Sign in again</);
        assert.match(uv.sidebarSummaryHtml(u, 'n'), /Sign in again/);
        assert.ok(!/user" scope/.test(uv.hubUsageCardHtml(u)), 'not mistaken for a missing scope');
    });
    await ok('(c) 403 / 404 with the user scope present -> specific messages', async () => {
        const u404 = await svcWith([userOk, csOk, [/usage\/summary/, () => fakeResp(404, { message: 'Not Found' })]]).getAccountUsage('octocat');
        assert.match(u404.error, /404.*enhanced billing platform/); assert.strictEqual(u404.fix, null);
        const u403 = await svcWith([userOk, csOk, [/usage\/summary/, () => fakeResp(403, { message: 'Resource protected by organization SAML enforcement' })]]).getAccountUsage('octocat');
        assert.match(u403.error, /403.*SAML.*fine-grained token/);
        assert.notStrictEqual(u403.error, u404.error);
    });
    await ok('(d) usage 429 / exhausted 403 shows the reset time from headers', async () => {
        const reset = Math.floor(Date.UTC(2026, 9, 21, 15, 30) / 1000);
        const u = await svcWith([userOk, csOk, [/usage\/summary/, () => withHeaders(429, { message: 'rate' }, { 'x-ratelimit-reset': String(reset) })]]).getAccountUsage('octocat');
        assert.strictEqual(u.kind, 'rateLimit'); assert.strictEqual(u.resetAt, new Date(reset * 1000).toISOString());
        assert.match(u.error, /^GitHub API rate limit reached\. Resets at \d{1,2}:\d{2}/);
        const u2 = await svcWith([userOk, csOk, [/usage\/summary/, () => withHeaders(403, {}, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) })]]).getAccountUsage('octocat');
        assert.strictEqual(u2.kind, 'rateLimit');
        assert.ok(us.rateLimitInfo({ status: 429, retryAfter: '60' }).resetAt);
        assert.strictEqual(us.rateLimitInfo({ status: 403, rateRemaining: '12' }), null);
    });
    await ok('(e) offline with no cache -> offline banner, not raw text', async () => {
        const svc = new us.UsageService({ authManager: { getToken: async () => 't' }, now: () => Date.UTC(2026, 9, 21, 12), fetchImpl: async () => { const e = new TypeError('fetch failed'); e.cause = { code: 'ENOTFOUND' }; throw e; } });
        const u = await svc.getAccountUsage('octocat');
        assert.strictEqual(u.mode, 'offline');
        const card = uv.hubUsageCardHtml(u);
        assert.match(card, /ux-banner ux-warning/); assert.match(card, /You're offline|You&#39;re offline/);
        assert.ok(!/fetch failed|ENOTFOUND|TypeError/.test(card + uv.hubUsagePageHtml(u) + uv.sidebarSummaryHtml(u, 'n')));
        assert.match(uv.sidebarSummaryHtml(u, 'n'), /Offline/);
    });
    await ok('(f) daily-usage and previous-month failures show warning notes in their sections', async () => {
        const u = await svcWith([userOk, csOk,
            [/usage\/summary\?product=codespaces&year=2026&month=9\b/, () => fakeResp(500, {})],
            [/usage\/summary/, () => fakeResp(200, SUM_OK)],
            [/settings\/billing\/usage\?/, () => fakeResp(200, { usageItems: [{ product: 'codespaces', sku: 'Codespaces compute 2-core', date: '2026-10-02', quantity: 'x' }] })]
        ]).getAccountUsage('octocat');
        assert.strictEqual(u.mode, 'live');
        assert.match(u.dailyError, /unexpected response/); assert.match(u.prevError, /500/);
        const page = uv.hubUsagePageHtml(u);
        assert.match(page, /usage-warn-note[\s\S]*?Daily usage returned an unexpected response/);
        assert.match(page, /Compared with the previous month[\s\S]*?Previous month returned 500/);
    });
    await ok('(g) codespaces-list failure does not misdetect org billing (unknown)', async () => {
        const u = await svcWith([[/\/user$/, () => fakeResp(200, userBody('octocat', 'business'), 'codespace, user')], [/\/user\/codespaces/, () => fakeResp(500, {})], [/usage\/summary/, () => fakeResp(200, SUM_OK)], [/settings\/billing\/usage\?/, () => fakeResp(200, { usageItems: [] })]]).getAccountUsage('octocat');
        assert.notStrictEqual(u.mode, 'orgBilled');
        assert.strictEqual(u.orgBilledUnknown, true); assert.strictEqual(u.codespaceCount, null);
        if (u.mode === 'live') assert.match(uv.hubUsagePageHtml(u), /unknown whether some are billed to an organization/);
    });
    await ok('design: signed-out full page, no Enterprise Edition, real version, cached cards, running-card actions, storage tile', () => {
        const Module = require('module'); const orig = Module._resolveFilename;
        Module._resolveFilename = function (r, ...a) { return r === 'vscode' ? 'vscode' : orig.call(this, r, ...a); };
        require.cache.vscode = { id: 'vscode', filename: 'vscode', loaded: true, exports: { window: {}, commands: {}, env: {}, Uri: {}, ViewColumn: {}, workspace: { getConfiguration: () => ({ get: (k, d) => d }) } } };
        try {
            const D = require(path.join(ROOT, 'src', 'dashboardProvider.js')); const DP = D.DashboardProvider || D;
            const p = Object.create(DP.prototype); p._usage = null; p._initialPage = null; p._context = { extensionUri: {} };
            const out = p.buildDashboardHtml([], '', []);
            assert.match(out, /class="main-canvas is-signed-out"/);
            assert.match(out, /\.main-canvas\.is-signed-out > :not\(\.hub-header\):not\(\.workspace-grid\) \{ display: none/);
            assert.ok(!/Enterprise Edition/.test(out));
            const ver = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
            assert.match(out, new RegExp('rail-ide-version">v' + ver.replace(/\./g, '\\.') + '<'));
            assert.match(out, /id="kpiCardStorage" style="cursor:pointer;display:none;"/, 'no hardcoded storage tier');
            const cs = [{ name: 'cs-a', repository: 'octocat/repo-a', state: 'Available', lastUsedAt: '2026-10-21T08:00:00Z' }];
            const cached = p.buildDashboardHtml([{ account: 'octocat', type: 'gh', codespaces: cs, error: 'x', errorKind: 'timeout', cachedAt: Date.now() }], 'octocat', ['octocat']);
            assert.match(cached, /ws-card is-running is-cached/); assert.match(cached, /class="cached-tag"[^>]*>Cached</);
            assert.match(cached, /data-cmd="connect"[^>]*disabled aria-disabled="true"/); assert.match(cached, /data-cmd="stop"[^>]*disabled/);
            const live = p.buildDashboardHtml([{ account: 'octocat', type: 'gh', codespaces: cs }], 'octocat', ['octocat']);
            const dock = live.slice(live.indexOf('class="action-utility-group"'), live.indexOf('</article>'));
            assert.ok(!/data-cmd="openDeleteModal"|data-cmd="openRebuildModal"|data-cmd="openWeb"/.test(dock), 'extra actions live in the ⋮ menu on running cards');
            assert.ok(!/disabled aria-disabled/.test(live));
            const S = require(path.join(ROOT, 'src', 'sidebarProvider.js')); const SP = S.SidebarProvider || S;
            assert.match(SP.skeletonPage(), /ux-skel-card/);
            const sp = Object.create(SP.prototype); sp._usage = null; sp._context = { globalState: { get: () => true } }; sp.isFirstRunDismissed = () => true;
            const accs = [{ account: 'octocat', type: 'gh' }];
            const sc = sp.buildSidebarHtml(accs, 'octocat', cs, "GitHub isn't responding (15s).", {}, false, { errorKind: 'timeout', cachedAt: Date.now() });
            assert.match(sc, /ux-banner ux-warning/); assert.match(sc, /Showing data as of/); assert.ok(!/id="errorView"/.test(sc));
            const se = sp.buildSidebarHtml(accs, 'octocat', [], 'boom', {}, false, { errorKind: 'server', errorStatus: 503 });
            assert.match(se, /id="errorView"/); assert.match(se, /GitHub is having trouble right now/);
            assert.match(sp.buildSidebarHtml(accs, 'octocat', [], '', {}, false), /No codespaces yet\./);
        } finally { Module._resolveFilename = orig; delete require.cache.vscode; }
        assert.strictEqual(uv.storageTierText({ mode: 'error', plan: { key: 'free', label: 'Free', storageGb: 15, personal: true, guessed: true } }), '', 'guessed plan hidden');
    });

    // ── Review fixes on c9f310b ──
    console.log('review fixes');
    await ok('githubApi: 403 with x-ratelimit-remaining: 0 (and 429) is a rate limit with reset time', async () => {
        const gapi2 = require(path.join(ROOT, 'src', 'githubApi.js'));
        const reset = Math.floor(Date.UTC(2026, 9, 21, 15, 30) / 1000);
        const hdr = (status, h) => ({ status, ok: false, json: async () => ({}), headers: { get: (k) => h[k.toLowerCase()] ?? null } });
        const e1 = gapi2.rateLimitError(hdr(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) }));
        assert.strictEqual(e1.kind, 'rateLimit'); assert.strictEqual(e1.resetAt, new Date(reset * 1000).toISOString()); assert.match(e1.message, /Resets at/);
        assert.strictEqual(gapi2.rateLimitError(hdr(403, { 'x-ratelimit-remaining': '17' })), null, 'plain 403 is not a rate limit');
        assert.ok(gapi2.rateLimitError(hdr(429, { 'retry-after': '30' })).resetAt);
        const mk = (res) => new gapi2.GithubApi({ getToken: async () => 't', getActiveAccount: () => 'octocat' }, { fetchImpl: async () => res, retryDelayMs: 0 });
        const limited = hdr(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) });
        await assert.rejects(() => mk(limited).listCodespaces('octocat'), (e) => e.kind === 'rateLimit');
        await assert.rejects(() => mk(limited).startCodespace('cs-1', 'octocat'), (e) => e.kind === 'rateLimit');
        await assert.rejects(() => mk(limited).stopCodespace('cs-1', 'octocat'), (e) => e.kind === 'rateLimit');
        await assert.rejects(() => mk(limited).createCodespace('octocat/repo-a', 'main', 'octocat'), (e) => e.kind === 'rateLimit');
        const c = eux.classifyError(e1); assert.strictEqual(c.kind, 'rateLimit'); assert.match(c.title, /^GitHub API rate limit reached\. Resets at /);
    });
    await ok('friendlyError matches exact status / exit code fields (true and false positives)', () => {
        const withS = (msg, f) => Object.assign(new Error(msg), f);
        assert.match(friendlyError(withS('x', { status: 404 })), /Only the owner can open/);
        assert.match(friendlyError('HTTP 404: Not Found (https://api.github.com/user/codespaces/x)'), /Only the owner/);
        assert.ok(!/Only the owner/.test(friendlyError('Created codespace in region 404-west for repo4040')), 'bare 404 in text is not a 404');
        assert.ok(!/Only the owner/.test(friendlyError('Repository "octocat/repo-a" not found or not accessible.')), 'repo not found is not codespace not found');
        assert.match(friendlyError(withS('ssh failed', { exitCode: 255 })), /SSH tunnel dropped/);
        assert.match(friendlyError('Command failed with exit code 255'), /SSH tunnel dropped/);
        assert.ok(!/SSH tunnel dropped/.test(friendlyError('Port 2552 forwarded; 255 bytes sent')), 'bare 255 is not an exit code');
        assert.match(friendlyError('You have exceeded your Codespaces spending limit'), /spending or quota limit/);
        assert.match(friendlyError(withS('x', { status: 402 })), /spending or quota limit/);
        assert.ok(!/spending or quota/.test(friendlyError('Maximum retries exceeded while connecting')), '"exceeded" alone is not quota');
        assert.ok(!/spending or quota/.test(friendlyError('Showing billing page')), '"billing" alone is not quota');
        assert.match(friendlyError(withS('x', { status: 401 })), /sign in again/);
        assert.ok(!/sign in again/.test(friendlyError('Listening on port 14010')), 'bare 401 in text is not auth');
        assert.match(friendlyError(withS('Forbidden', { status: 403 })), /HTTP 403/);
        assert.match(friendlyError(withS('x', { status: 429 })), /rate limit/);
    });
    await ok('usage unexpected-response banner: plain copy, [Retry][Details], technical detail only in the log', async () => {
        const logs = [];
        const svc = new us.UsageService({ authManager: { getToken: async () => 't' }, log: (m) => logs.push(m), now: () => Date.UTC(2026, 9, 21, 12), fetchImpl: makeFetch([userOk, csOk, [/usage\/summary/, () => fakeResp(200, { usageItems: 'x' })]]) });
        const u = await svc.getAccountUsage('octocat');
        assert.strictEqual(u.why, "GitHub returned usage data in a format this version doesn't recognise.");
        const card = uv.hubUsageCardHtml(u);
        assert.match(card, /data-ux-action="retry"/); assert.match(card, /data-ux-action="details"/);
        assert.ok(!/usageItems/.test(card + uv.hubUsagePageHtml(u)), 'no technical detail in the UI');
        assert.ok(logs.some(l => /usageItems is missing/.test(l)), 'technical detail is logged');
    });
    await ok('sidebar: cached cards tagged, dimmed, Connect/Start/Stop disabled; single signed-out card without hardcoded hours', () => {
        const Module = require('module'); const orig = Module._resolveFilename;
        Module._resolveFilename = function (r, ...a) { return r === 'vscode' ? 'vscode' : orig.call(this, r, ...a); };
        require.cache.vscode = { id: 'vscode', filename: 'vscode', loaded: true, exports: { window: {}, commands: {}, env: {}, Uri: {}, ViewColumn: {}, workspace: { getConfiguration: () => ({ get: (k, d) => d }) } } };
        try {
            const S = require(path.join(ROOT, 'src', 'sidebarProvider.js')); const SP = S.SidebarProvider || S;
            const sp = Object.create(SP.prototype); sp._usage = null; sp.isFirstRunDismissed = () => true;
            const cs = [{ name: 'cs-a', repository: 'octocat/repo-a', state: 'Available' }, { name: 'cs-b', repository: 'octocat/repo-b', state: 'Shutdown' }];
            const h = sp.buildSidebarHtml([{ account: 'octocat', type: 'gh' }], 'octocat', cs, 'x', {}, false, { errorKind: 'timeout', cachedAt: Date.now() });
            assert.strictEqual((h.match(/cs-card is-(running|stopped) is-cached/g) || []).length, 2);
            assert.strictEqual((h.match(/class="cached-tag"/g) || []).length, 2);
            for (const a of ['connect', 'stop', 'start']) assert.match(h, new RegExp(`data-act="${a}" disabled aria-disabled="true"`));
            const live = sp.buildSidebarHtml([{ account: 'octocat', type: 'gh' }], 'octocat', cs, '', {}, false);
            assert.ok(!/cs-card is-(running|stopped) is-cached|data-act="(connect|stop|start)" disabled/.test(live));
            const w = sp.buildWelcomeHtml({ ghInstalled: true });
            assert.match(w, /You're signed out\./); assert.match(w, /Sign in with gh/);
            assert.ok(!/60 free compute hrs/.test(w)); assert.ok(!/System Health Checklist/.test(w), 'single card when gh is installed');
            const g = sp.buildWelcomeHtml({ ghInstalled: false });
            assert.match(g, /GitHub CLI isn't installed\./); assert.match(g, /id="installGhBtn"/); assert.ok(!/System Health Checklist/.test(g));
        } finally { Module._resolveFilename = orig; delete require.cache.vscode; }
    });

    console.log('error ux follow-ups');
    await ok('rateLimitMessage: one wording with reset time, fallback when unknown/invalid', () => {
        const U = require(path.join(ROOT, 'src', 'utils.js'));
        const at = new Date(Date.UTC(2026, 9, 21, 15, 30));
        const hhmm = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        assert.strictEqual(U.rateLimitMessage(at.toISOString()), `GitHub API rate limit reached. Resets at ${hhmm}.`);
        assert.strictEqual(U.rateLimitMessage(at.getTime()), `GitHub API rate limit reached. Resets at ${hhmm}.`);
        for (const v of [null, undefined, '', 'nonsense']) assert.strictEqual(U.rateLimitMessage(v), 'GitHub API rate limit reached. Try again in a few minutes.');
        assert.strictEqual(U.friendlyError(Object.assign(new Error('x'), { kind: 'rateLimit', resetAt: at.toISOString() })), `GitHub API rate limit reached. Resets at ${hhmm}.`);
        assert.strictEqual(U.friendlyError(Object.assign(new Error('x'), { status: 429 })), 'GitHub API rate limit reached. Try again in a few minutes.');
        const gapi3 = require(path.join(ROOT, 'src', 'githubApi.js'));
        const h = (st, o) => ({ status: st, headers: { get: (k) => (k in o ? o[k] : null) } });
        assert.strictEqual(gapi3.rateLimitError(h(429, {})).message, 'GitHub API rate limit reached. Try again in a few minutes.');
        assert.strictEqual(gapi3.rateLimitError(h(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(at.getTime() / 1000) })).message, `GitHub API rate limit reached. Resets at ${hhmm}.`);
        const src = ['utils.js', 'authManager.js', 'usageService.js', 'errorUx.js', 'githubApi.js'].map(f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8')).join('\n');
        assert.ok(!/Usage can refresh after|Try again after|Wait a few minutes and try again|rate limit reached\. Wait a few minutes/.test(src), 'no old rate-limit wording left');
    });
    await ok('authManager.verifyPat: 429 and exhausted 403 use the unified rate-limit message', async () => {
        const auth = new AuthManager({ globalState: { get: () => undefined, update: () => {} } });
        const orig = global.fetch;
        const at = Date.UTC(2026, 9, 21, 15, 30);
        const hhmm = new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const mk = (st, o) => async () => ({ status: st, ok: false, headers: { get: (k) => (k in o ? o[k] : null) }, json: async () => ({}) });
        try {
            global.fetch = mk(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(at / 1000) });
            await assert.rejects(() => auth.verifyPat('t'), (e) => e.kind === 'rateLimit' && e.message === `GitHub API rate limit reached. Resets at ${hhmm}.`);
            global.fetch = mk(429, {});
            await assert.rejects(() => auth.verifyPat('t'), (e) => e.message === 'GitHub API rate limit reached. Try again in a few minutes.');
            global.fetch = mk(403, { 'x-ratelimit-remaining': '12' });
            assert.strictEqual(await auth.verifyPat('t'), null, 'plain 403 is still a rejected token');
        } finally { global.fetch = orig; }
    });
    await ok('15s timeout is a Warning in both the sidebar and Cloud Hub', () => {
        const Module = require('module'); const orig = Module._resolveFilename;
        Module._resolveFilename = function (r, ...a) { return r === 'vscode' ? 'vscode' : orig.call(this, r, ...a); };
        require.cache.vscode = { id: 'vscode', filename: 'vscode', loaded: true, exports: { window: {}, commands: {}, env: {}, Uri: {}, ViewColumn: {}, workspace: { getConfiguration: () => ({ get: (k, d) => d }) } } };
        try {
            const D = require(path.join(ROOT, 'src', 'dashboardProvider.js')); const DP = D.DashboardProvider || D;
            const hubWarm = DP.accountErrorBanners([{ account: 'octocat', error: "GitHub isn't responding (15s).", errorKind: 'timeout', cachedAt: Date.UTC(2026, 9, 21, 5, 0) }]);
            const hubCold = DP.accountErrorBanners([{ account: 'octocat', error: "GitHub isn't responding (15s).", errorKind: 'timeout' }]);
            for (const h of [hubWarm, hubCold]) { assert.match(h, /ux-warning/); assert.ok(!/ux-critical/.test(h)); assert.match(h, /class="ux-label">Warning</); }
            const S = require(path.join(ROOT, 'src', 'sidebarProvider.js')); const SP = S.SidebarProvider || S;
            const sp = Object.create(SP.prototype); sp._usage = null; sp.isFirstRunDismissed = () => true;
            const cs = [{ name: 'cs-1', repository: 'octocat/repo-a', state: 'Available', branch: 'main', displayName: 'repo-a' }];
            const warm = sp.buildSidebarHtml([{ account: 'octocat', type: 'gh' }], 'octocat', cs, "GitHub isn't responding (15s).", { ghInstalled: true }, false, { errorKind: 'timeout', cachedAt: Date.now() });
            const cold = sp.buildSidebarHtml([{ account: 'octocat', type: 'gh' }], 'octocat', [], "GitHub isn't responding (15s).", { ghInstalled: true }, false, { errorKind: 'timeout' });
            for (const h of [warm, cold]) { assert.match(h, /ux-label">Warning</); assert.ok(!/ux-label">Error</.test(h)); }
        } finally { Module._resolveFilename = orig; delete require.cache.vscode; }
    });
    await ok('gh missing replaces the whole sidebar view with the install card, even when signed in', async () => {
        const Module = require('module'); const orig = Module._resolveFilename;
        Module._resolveFilename = function (r, ...a) { return r === 'vscode' ? 'vscode' : orig.call(this, r, ...a); };
        require.cache.vscode = { id: 'vscode', filename: 'vscode', loaded: true, exports: { window: {}, commands: {}, env: {}, Uri: {}, ViewColumn: {}, workspace: { getConfiguration: () => ({ get: (k, d) => d }) } } };
        const SD = require(path.join(ROOT, 'src', 'systemDoctor.js')); const SDC = SD.SystemDoctor || SD; const origDiag = SDC.diagnose;
        try {
            const S = require(path.join(ROOT, 'src', 'sidebarProvider.js')); const SP = S.SidebarProvider || S;
            const sp = Object.create(SP.prototype);
            let listed = false;
            sp._view = { webview: { html: '' } }; sp._rendered = true; sp._usageService = null; sp.isFirstRunDismissed = () => true;
            sp._authManager = { getAccounts: async () => [{ account: 'octocat', type: 'pat' }], getActiveAccount: () => 'octocat' };
            sp._githubApi = { clearCache: () => {}, listCodespaces: async () => { listed = true; return []; } };
            SDC.diagnose = async () => ({ ghInstalled: false, ghAuthHealth: {} });
            await sp.refresh();
            const h = sp._view.webview.html;
            assert.match(h, /GitHub CLI isn't installed\./); assert.match(h, /Install GitHub CLI/); assert.match(h, /id="recheckBtn"/);
            assert.match(h, /id="patBtn"[^>]*>Use a personal access token instead</); assert.ok(!/Sign in with gh/.test(h), 'no gh sign-in when gh is missing');
            assert.match(h, /getElementById\('installGhBtn'\)[\s\S]{0,160}command: 'openExternal', url: 'https:\/\/cli\.github\.com'/);
            assert.ok(!/cs-card|search|You're signed out/i.test(h.replace(/<style[\s\S]*?<\/style>/g, '')), 'nothing else in the view');
            assert.strictEqual(listed, false, 'no list call without gh');
            SDC.diagnose = async () => ({ ghInstalled: true, ghAuthHealth: { state: 'ok' } });
            await sp.refresh();
            assert.ok(!/GitHub CLI isn't installed/.test(sp._view.webview.html)); assert.strictEqual(listed, true);
        } finally { SDC.diagnose = origDiag; Module._resolveFilename = orig; delete require.cache.vscode; }
    });

    console.log(passed + ' assertions passed' + (process.exitCode ? ' (WITH FAILURES)' : ''));
})();
