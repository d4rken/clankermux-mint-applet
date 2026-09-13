'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../usageModel');
const fixtures = require('./publicV1Fixtures');
const { NOW } = fixtures;

test('normalizes server URL and safely handles missing usage', () => {
    assert.equal(model.normalizeBaseUrl(' host:8080/ '), 'http://host:8080');
    assert.equal(model.clampPercent(null), null);
    assert.equal(model.clampPercent(undefined), null);
    assert.equal(model.clampPercent(0), 0);
});

test('refresh cycle settles once on completion or timeout', () => {
    const cycle = model.createRefreshCycle(3);
    assert.equal(cycle.completeOne(), false);
    assert.equal(cycle.completeOne(), false);
    assert.equal(cycle.completeOne(), true);
    assert.equal(cycle.expire(), false);
    const timeout = model.createRefreshCycle(2);
    assert.equal(timeout.expire(), true);
    assert.equal(timeout.completeOne(), false);
});

test('account availability and credentials stay separate from forecasts', () => {
    assert.equal(model.accountState(fixtures.accounts()[0]).key, 'available');
    assert.equal(model.accountState({ availability: { state: 'future' } }).key, 'error');
    assert.deepEqual(model.accountState({ availability: { state: 'rate_limited', reason: 'queueing', availableAt: 'later' } }),
        { key: 'limited', label: 'Rate limited · Queueing', until: 'later' });
    assert.equal(model.credentialNotice({ credential: { state: 'valid' } }), null);
    assert.equal(model.credentialNotice({ credential: { state: 'invalid' } }).key, 'error');
    assert.equal(model.measurementNotice({ measurementState: 'stale' }), 'cached usage');
});

test('window bars preserve observations, omit missing usage and respect family visibility', () => {
    assert.deepEqual(model.accountWindows(fixtures.accounts()[0], true, 80, NOW).map(w => w.percent), [90,60,40]);
    assert.equal(model.accountWindows(fixtures.accounts()[0], false, 80, NOW).length, 2);
    assert.equal(model.accountWindows(fixtures.accounts()[2], true, 80, NOW).length, 1);
});

test('replacement status uses configured/paused and keeps original account order', () => {
    const accounts = fixtures.accounts();
    const view = model.buildView(accounts, fixtures.status({ serviceState: 'ready', accounts: { configured: 9, paused: 2 } }), fixtures.workloads(), {}, NOW);
    assert.deepEqual(view.pool, { configured: 9, paused: 2 });
    assert.equal(view.serviceState, 'ready');
    assert.deepEqual(view.accounts.map(a => a.id), accounts.map(a => a.id));
    assert.equal(model.buildView([], {}, null, {}, NOW).pool.configured, null);
});

test('formatting handles invalid timestamps and does not advance elapsed resets', () => {
    assert.equal(model.formatReset('invalid', NOW), '');
    assert.equal(model.formatReset(NOW, NOW), 'reset due');
    assert.equal(model.formatReset(NOW + 3600000, NOW), 'in 1h');
    assert.equal(model.formatDuration(2 * 86400000), '2d');
});
