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

test('curl argv ignores curlrc, follows redirects and keeps the URL last', () => {
    const args = model.curlArgs('http://x/public/v1/status', 8, 'ua');
    assert.equal(args[1], '--disable');
    assert.ok(args.includes('--location'));
    assert.equal(args[args.indexOf('--max-time') + 1], '8');
    assert.deepEqual(args.slice(-2), ['--', 'http://x/public/v1/status']);
});

test('curl results map exit codes, HTTP status and the status trailer', () => {
    const connect = 'Could not connect to Clankermux';
    const cases = [
        [[0, '{"a":1}\n200', ''], { status: 200, data: { a: 1 }, error: null }],
        [[0, '{\n"a": [1,\n2]\n}\n200', ''], { status: 200, data: { a: [1, 2] }, error: null }],
        [[0, '<html>Bad Gateway</html>\n502', ''], { status: 502, data: null, error: 'HTTP 502' }],
        [[0, '\n404', ''], { status: 404, data: null, error: 'HTTP 404' }],
        [[0, '{"a":1}', ''], { status: 0, data: null, error: 'Malformed curl output' }],
        [[0, '{"a":1}\nabc', ''], { status: 0, data: null, error: 'Malformed curl output' }],
        [[0, 'nope\n200', ''], { status: 200, data: null, error: 'Invalid JSON response' }],
        [[7, '', 'curl: (7) Failed to connect to 127.0.0.1 port 8080: Connection refused\n'], { status: 0, data: null, error: connect }],
        [[6, '', 'curl: (6) Could not resolve host: nas\n'], { status: 0, data: null, error: connect }],
        [[28, '', 'curl: (28) Operation timed out after 8001 milliseconds\n'], { status: 0, data: null, error: 'Refresh timed out after 8s' }],
        [[35, '', 'curl: (35) TLS connect error\nsecond line\n'], { status: 0, data: null, error: 'TLS connect error' }],
        [[52, '', ''], { status: 0, data: null, error: 'curl exited with status 52' }],
        [[-1, '', ''], { status: 0, data: null, error: 'curl exited with status -1' }],
    ];
    for (const [[exit, stdout, stderr], expected] of cases)
        assert.deepEqual(model.parseCurlResult(exit, stdout, stderr, 8), expected);
    assert.equal(model.parseCurlResult(56, '', `curl: (56) ${'x'.repeat(300)}`, 8).error.length, 160);
});
