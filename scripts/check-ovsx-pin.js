'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));

function fail(message) {
    console.error(`Open VSX publisher pin check failed: ${message}`);
    process.exitCode = 1;
}

const version = manifest.devDependencies && manifest.devDependencies.ovsx;
const parts = typeof version === 'string' ? version.split('.') : [];
if (parts.length !== 3 || parts.some(part => !part || !Number.isInteger(Number(part)) || String(Number(part)) !== part)) {
    fail('ovsx must use an exact stable version');
} else {
    const rootLock = lock.packages && lock.packages[''];
    const publisher = lock.packages && lock.packages['node_modules/ovsx'];
    const resolved = `https://registry.npmjs.org/ovsx/-/ovsx-${version}.tgz`;
    if (!rootLock || !rootLock.devDependencies || rootLock.devDependencies.ovsx !== version) {
        fail('package.json and package-lock.json do not agree on the publisher version');
    }
    if (!publisher || publisher.version !== version || publisher.resolved !== resolved) {
        fail('package lock does not pin the expected official ovsx package tarball');
    }
    const integrity = publisher && publisher.integrity;
    const digest = typeof integrity === 'string' && integrity.startsWith('sha512-')
        ? integrity.slice('sha512-'.length)
        : '';
    const decodedDigest = Buffer.from(digest, 'base64');
    if (!digest || decodedDigest.length !== 64 || decodedDigest.toString('base64') !== digest) {
        fail('package lock is missing a valid SHA-512 publisher integrity');
    }
}

if (process.exitCode) process.exit(process.exitCode);
console.log(`Open VSX publisher pin verified: ovsx@${version} (SHA-512 lock integrity).`);
