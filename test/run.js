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
    await ok('friendlyError guides 404/boot/ssh-server/drop cases', () => {
        assert.match(friendlyError('HTTP 404: Not Found'), /Only the owner can open/i);
        assert.match(friendlyError('timed out while waiting for the codespace to start'), /still booting/i);
        assert.match(friendlyError('failed to start SSH server: check if SSH is installed'), /devcontainer.*sshd/i);
        assert.match(friendlyError('Connection closed exit 255'), /RUNNING/i);
    });
    await ok('listCodespaces failure paths stay guided', async () => {
        // Pure aggregate builder (deterministic, no network/gh needed).
        const err = GithubApi.buildListError('ghost', new Error('net down'), new Error('cli boom'));
        assert.match(err.message, /Couldn't load Codespaces for "ghost"/);
        assert.match(err.message, /press Refresh/i);
        // Bogus token must reject (401-auth when online, aggregate when offline).
        const api = new GithubApi({ getActiveAccount: () => '', getToken: async () => 'bogus-invalid-token-xyz' });
        await assert.rejects(api.listCodespaces('ghost'), /expired|Couldn't load/);
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
        assert.strictEqual(removedKeys, 1);
        assert.ok(cfg.includes('Host github.com'), 'user block must survive');
        assert.ok(cfg.includes('Host myserver'), 'user block must survive');
        assert.ok(cfg.includes('# CS_ENTRY:keep-1'), 'marked block must survive');
        assert.ok(!cfg.includes('codespaces.auto'), 'phantom keys must go');
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
        }
        const dash = fs.readFileSync(path.join(ROOT, 'src', 'dashboardProvider.js'), 'utf8');
        assert.ok(dash.includes('vscode.getState()') && dash.includes('vscode.setState('), 'dashboard must preserve UI state');
    });

    console.log(passed + ' assertions passed' + (process.exitCode ? ' (WITH FAILURES)' : ''));
})();
