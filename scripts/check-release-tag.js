#!/usr/bin/env node

const { version } = require('../package.json');
const tag = process.argv[2] || process.env.GITHUB_REF_NAME;

if (!tag) {
  console.error('Provide the release tag as an argument or set GITHUB_REF_NAME.');
  process.exit(2);
}

const expectedTag = `v${version}`;
if (tag !== expectedTag) {
  console.error(`Release tag ${tag} does not match package version ${expectedTag}.`);
  process.exit(1);
}

console.log(`Release tag ${tag} matches package version ${version}.`);
