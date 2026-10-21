#!/usr/bin/env node
/**
 * POC: parse GitHub billing API responses exactly as the extension does and
 * print the numbers to compare with github.com/settings/billing.
 *   node scripts/usage-poc.js [summary.json] [daily.json] [plan]
 * Defaults to the saved fixtures in test/fixtures (plan: pro).
 * Live: gh api "/users/<login>/settings/billing/usage/summary?year=YYYY&month=M" > s.json
 *       gh api "/users/<login>/settings/billing/usage?year=YYYY&month=M" > d.json
 */
const fs = require('fs');
const path = require('path');
const us = require('../src/usageService');
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const fx = path.join(__dirname, '..', 'test', 'fixtures');
const sum = read(process.argv[2] || path.join(fx, 'billing-usage-summary.json'));
const day = read(process.argv[3] || path.join(fx, 'billing-usage-daily.json'));
const plan = us.resolvePlan(process.argv[4] || 'pro');
const s = us.parseSummary(sum);
const d = us.parseDaily(day);
const m = (v) => '$' + v.toFixed(2);
console.log(`Plan ${plan.label}`);
console.log(`Compute  ${s.computeCoreHours.toFixed(1)} / ${plan.coreHours} core-hrs (${m(s.computeAmount)} of ${m(plan.coreHours * us.CORE_HOUR_PRICE)})`);
console.log(`Storage  ${s.storageGbMonths.toFixed(2)} / ${plan.storageGb} GB-month (${m(s.storageAmount)} of ${m(plan.storageGb * us.STORAGE_PRICE_PER_GB_MONTH)})`);
console.log(`Billing  ${m(s.grossAmount)} consumed · -${m(s.discountAmount)} discount · ${m(s.netAmount)} billable`);
if (s.unknownSkus.length) console.log(`Unrecognised SKUs: ${s.unknownSkus.join(', ')}`);
console.log('Repositories:');
for (const r of d.repos) console.log(`  ${r.repo.padEnd(20)} ${r.coreHours.toFixed(1).padStart(6)} core-hrs  ${m(r.amount)}`);
