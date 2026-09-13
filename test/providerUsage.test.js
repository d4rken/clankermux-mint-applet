'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../usageModel');
const fixtures = require('./publicV1Fixtures');
const { NOW } = fixtures;

function account(provider, weekly, family = null, extra = {}) {
    return {
        provider, measurementState: 'fresh',
        windows: [
            { kind: 'five_hour', scopeId: null, utilizationPct: 100 },
            { kind: 'seven_day', scopeId: null, utilizationPct: weekly,
                observedAt: new Date(NOW - 60000).toISOString(), resetsAt: new Date(NOW + 86400000).toISOString() },
            { kind: 'weekly_scoped', scopeId: 'fable', utilizationPct: family,
                observedAt: new Date(NOW - 60000).toISOString(), resetsAt: new Date(NOW + 86400000).toISOString() },
        ],
        ...extra,
    };
}

test('usage averages accounts within each provider and keeps family usage separate', () => {
    const rows = model.providerUsageRows([
        account('codex', 25), account('codex', 75),
        account('anthropic', 20, 90), account('anthropic', 40, 100),
    ], true, NOW);
    assert.deepEqual(rows.map(row => row.valueText), ['50%', '30%', '95%']);
    assert.deepEqual(rows.map(row => row.accountCount), [2, 2, 2]);
    assert.match(rows[0].tooltip, /50% weekly used · 2\/2 accounts/);
});

test('paused accounts still contribute and missing readings never count as zero', () => {
    const rows = model.providerUsageRows([
        account('codex', 80, null, { availability: { state: 'paused' } }),
        account('codex', null), account('anthropic', 0),
    ], true, NOW);
    assert.equal(rows[0].valueText, '80%*');
    assert.match(rows[0].tooltip, /1\/2 accounts · partial/);
    assert.equal(rows[1].valueText, '0%');
    assert.equal(rows[2].valueText, '?');
    assert.equal(model.providerUsageRows([], true, NOW)[0].valueText, 'None');
});

test('averages before rounding and counts each account once despite extra windows', () => {
    const a = account('codex', 10.4);
    a.windows.push({ ...a.windows[1], utilizationPct: 99 });
    assert.equal(model.providerUsageRows([a, account('codex', 10.5)], false, NOW)[0].percent, 10);
    assert.equal(model.providerUsageRows([a], false, NOW).length, 2);
});

test('only explicitly inapplicable accounts are excluded from coverage', () => {
    const fresh = account('codex', 80);
    const inapplicable = account('codex', null, null, { measurementState: 'not_applicable', windows: [] });
    const row = model.providerUsageRows([fresh, inapplicable], false, NOW)[0];
    assert.equal(row.valueText, '80%');
    assert.equal(row.severity, 'warning');
    assert.match(row.tooltip, /1\/1 accounts/);
    assert.equal(model.providerUsageRows([fresh, { ...inapplicable, measurementState: 'fresh' }], false, NOW)[0].valueText, '80%*');
    const missingFamily = account('anthropic', 20, null);
    missingFamily.windows.pop();
    const family = model.providerUsageRows([account('anthropic', 30, 90), missingFamily], true, NOW)[2];
    assert.equal(family.valueText, '90%*');
    assert.match(family.tooltip, /1\/2 accounts · partial/);
});

test('cached usage is marked without suppressing observed percentages', () => {
    for (const change of [
        a => { a.measurementState = 'stale'; },
        a => { a.windows[1].resetsAt = new Date(NOW).toISOString(); },
        a => { a.windows[1].observedAt = null; },
    ]) {
        const a = account('codex', 83);
        change(a);
        const row = model.providerUsageRows([a], false, NOW)[0];
        assert.equal(row.valueText, '83%*');
        assert.equal(row.severity, 'unknown');
        assert.match(row.tooltip, /cached/);
    }
    assert.equal(model.providerUsageRows([account('codex', 83)], false, NOW, true)[0].valueText, '83%*');
});
