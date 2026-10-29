'use strict';

const assert = require('assert');
const vscode = require('vscode');

async function runExtensionHostSmokeTest() {
    const extensionId = 'nirbhay-hiwse.antigravity-codespaces';
    const extension = vscode.extensions.getExtension(extensionId);
    assert.ok(extension, `Expected extension ${extensionId} to be loaded in the test host`);

    await extension.activate();
    assert.strictEqual(extension.isActive, true, 'extension activation should complete');

    const commands = await vscode.commands.getCommands(true);
    const expectedCommands = [
        'antigravity-codespaces.openDashboard',
        'antigravity-codespaces.quickConnect',
        'antigravity-codespaces.setupDoctor',
        'antigravity-codespaces.reconnectLast',
        'antigravity-codespaces.openPortUrl'
    ];
    for (const command of expectedCommands) {
        assert.ok(commands.includes(command), `Expected registered command ${command}`);
    }

    // The no-argument URL command is a no-op and cannot launch an external URL.
    await vscode.commands.executeCommand('antigravity-codespaces.openPortUrl');

    // The clean test profile has no saved Codespace; this exercises the handler's
    // safe empty-state path without starting or contacting a Codespace.
    await vscode.commands.executeCommand('antigravity-codespaces.reconnectLast');

    console.log('PASS extension activates, registers core commands, and handles safe no-op paths');
}

module.exports = { run: runExtensionHostSmokeTest };
