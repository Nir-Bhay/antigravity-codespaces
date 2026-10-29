#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runTests } = require('@vscode/test-electron');

const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.homedir(), '.agh-'));
const userDataDir = path.join(scratch, 'user-data');
const extensionsDir = path.join(scratch, 'extensions');
const ghConfigDir = path.join(scratch, 'gh-config');
for (const directory of [userDataDir, extensionsDir, ghConfigDir]) {
    fs.mkdirSync(directory, { recursive: true });
}

// Keep the smoke test isolated from a developer or CI runner's sign-in state.
for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) {
    delete process.env[name];
}
process.env.GH_CONFIG_DIR = ghConfigDir;
process.env.GH_PROMPT_DISABLED = '1';

async function main() {
    try {
        const version = process.env.VSCODE_TEST_VERSION || 'stable';
        console.log(`Launching isolated VS Code Extension Development Host (${version}).`);
        await runTests({
            extensionDevelopmentPath: root,
            extensionTestsPath: path.join(root, 'test', 'extension-host', 'smoke.js'),
            version,
            launchArgs: [
                '--disable-gpu',
                '--no-sandbox',
                '--disable-workspace-trust',
                '--disable-extensions',
                `--user-data-dir=${userDataDir}`,
                `--extensions-dir=${extensionsDir}`,
                path.join(root, 'test', 'fixtures', 'extension-host-workspace')
            ]
        });
        console.log('VS Code Extension Development Host smoke test passed.');
    } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
}

main().catch((error) => {
    console.error('VS Code Extension Development Host smoke test failed.');
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});
