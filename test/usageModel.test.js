'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../usageModel');

const NOW = Date.parse('2026-07-20T12:00:00Z');

test('normalizes configured server URLs', () => {
    assert.equal(model.normalizeBaseUrl(' proxy.example.test:8080/ '), 'http://proxy.example.test:8080');
    assert.equal(model.normalizeBaseUrl('https://example.test///'), 'https://example.test');
    assert.equal(model.normalizeBaseUrl(''), '');
});

test('refresh cycles settle once after every request completes', () => {
    const cycle = model.createRefreshCycle(2);
    assert.equal(cycle.completeOne(), false);
    assert.equal(cycle.completeOne(), true);
    assert.equal(cycle.completeOne(), false);
    assert.equal(cycle.expire(), false);
});

test('expired refresh cycles ignore late request completions', () => {
    const cycle = model.createRefreshCycle(2);
    assert.equal(cycle.completeOne(), false);
    assert.equal(cycle.expire(), true);
    assert.equal(cycle.expire(), false);
    assert.equal(cycle.completeOne(), false);
});

test('does not turn missing utilization into zero usage', () => {
    assert.equal(model.clampPercent(null), null);
    assert.equal(model.clampPercent(undefined), null);
    assert.equal(model.clampPercent(0), 0);
});

test('extracts standard and model-scoped usage windows', () => {
    const windows = model.accountWindows({
        usageData: {
            five_hour: { utilization: 14, resets_at: '2026-07-20T13:00:00Z' },
            seven_day: { utilization: 60, resets_at: '2026-07-21T03:00:00Z' },
            limits: [
                { kind: 'weekly_all', percent: 60, scope: null },
                {
                    kind: 'weekly_scoped',
                    percent: 100,
                    resets_at: '2026-07-21T03:00:00Z',
                    scope: { model: { display_name: 'Fable' } },
                    is_active: true,
                },
            ],
        },
    });

    assert.deepEqual(windows.map(window => [window.label, window.percent]), [
        ['5 hour', 14],
        ['7 day', 60],
        ['Fable', 100],
    ]);
    assert.equal(windows[2].scoped, true);
    assert.equal(windows[2].active, true);
});

test('uses stale usage when the live poll has not produced data', () => {
    const windows = model.accountWindows({
        usageData: null,
        staleUsage: { seven_day: { utilization: 42 } },
    });
    assert.equal(windows.length, 1);
    assert.equal(windows[0].percent, 42);
    assert.equal(windows[0].stale, true);
});

test('keeps missing reset timestamps null instead of converting them to Unix epoch', () => {
    const windows = model.accountWindows({
        usageData: {
            five_hour: { utilization: 0, resets_at: null },
        },
        prediction: {
            fiveHour: {
                predictedAtReset: null,
                resetsAtMs: null,
                state: 'stable',
            },
        },
    }, true, NOW);

    assert.equal(windows.length, 1);
    assert.equal(windows[0].resetsAt, null);
    assert.equal(model.formatReset(windows[0].resetsAt, NOW), '');
});

test('uses a valid prediction reset timestamp when live usage omits it', () => {
    const resetMs = NOW + 60 * 60_000;
    const windows = model.accountWindows({
        usageData: {
            five_hour: { utilization: 10, resets_at: null },
        },
        prediction: {
            fiveHour: { predictedAtReset: 20, resetsAtMs: resetMs },
        },
    }, true, NOW);

    assert.equal(windows[0].resetsAt, new Date(resetMs).toISOString());
});

test('builds pool summary from health and prioritizes the primary account', () => {
    const accounts = [
        {
            name: 'Main', provider: 'anthropic', isPrimary: false,
            usageData: { seven_day: { utilization: 51 } },
        },
        {
            name: 'Backup', provider: 'codex', isPrimary: true,
            usageData: { seven_day: { utilization: 71 } },
        },
    ];
    const health = {
        status: 'ok',
        pool: { configured: 4, routable: 3, paused: 1, rate_limited: 0, usage_exhausted: 0 },
        accounts_detail: [],
    };
    const view = model.buildView(accounts, health, {}, NOW);

    assert.equal(view.accounts[0].name, 'Backup');
    assert.deepEqual([view.pool.routable, view.pool.configured], [3, 4]);
    assert.deepEqual(view.usagePools.map(pool => [pool.label, pool.usedPercent]), [['7d', 61]]);
});

test('aggregates quota capacity as an equal-account pool', () => {
    const accounts = [
        {
            windows: [
                { key: 'five_hour', label: '5 hour', percent: 10, projectedAtReset: 20, willExhaust: false, forecastConfidence: 'high' },
                { key: 'seven_day', label: '7 day', percent: 70, projectedAtReset: 90, willExhaust: false, forecastConfidence: 'high' },
            ],
        },
        {
            windows: [
                { key: 'five_hour', label: '5 hour', percent: 30, projectedAtReset: 40, willExhaust: false, forecastConfidence: 'high' },
                { key: 'seven_day', label: '7 day', percent: 50, projectedAtReset: 80, willExhaust: false, forecastConfidence: 'high' },
            ],
        },
    ];

    const pools = model.aggregateUsagePools(accounts, 80, NOW);
    assert.deepEqual(pools.map(pool => [pool.label, pool.usedPercent, pool.remainingPercent]), [
        ['5h', 20, 80],
        ['7d', 60, 40],
    ]);
    assert.ok(pools.every(pool => pool.usedPercent + pool.remainingPercent === 100));
    assert.equal(pools[0].severity, 'normal');
    assert.equal(pools[1].projectedPercent, 85);
    assert.equal(pools[1].severity, 'warning');
});

test('one account at risk does not color a healthy combined pool orange', () => {
    const projected = [100, 20, 20, 20];
    const accounts = projected.map((value, index) => ({
        windows: [{
            key: 'seven_day',
            label: '7 day',
            percent: index === 0 ? 90 : 10,
            projectedAtReset: value,
            willExhaust: index === 0,
            forecastConfidence: 'high',
        }],
    }));

    const pool = model.aggregateUsagePools(accounts, 80, NOW)[0];
    assert.equal(pool.atRiskCount, 1);
    assert.equal(pool.projectedPercent, 40);
    assert.equal(pool.severity, 'normal');
});

test('combined pool is red only when every account is confidently forecast to exhaust', () => {
    const accounts = ['A', 'B', 'C'].map(name => ({
        name,
        windows: [{
            key: 'seven_day',
            label: '7 day',
            percent: 70,
            projectedAtReset: 100,
            willExhaust: true,
            forecastConfidence: 'high',
        }],
    }));
    const pool = model.aggregateUsagePools(accounts, 80, NOW)[0];
    assert.equal(pool.certainExhaustCount, 3);
    assert.equal(pool.severity, 'critical');

    accounts[2].windows[0].forecastConfidence = 'low';
    assert.equal(model.aggregateUsagePools(accounts, 80, NOW)[0].severity, 'warning');
});

test('scoped limits such as Fable form their own pool', () => {
    const accounts = [
        { windows: [{ key: 'scope:fable', label: 'Fable', percent: 100, projectedAtReset: 100, willExhaust: true, forecastConfidence: 'estimated' }] },
        { windows: [{ key: 'scope:fable', label: 'Fable', percent: 50, projectedAtReset: 80, willExhaust: false, forecastConfidence: 'estimated' }] },
    ];
    const pool = model.aggregateUsagePools(accounts, 80, NOW)[0];
    assert.equal(pool.label, 'Fable');
    assert.equal(pool.accountCount, 2);
    assert.equal(pool.usedPercent, 75);
    assert.equal(pool.projectedPercent, 90);
    assert.equal(pool.severity, 'warning');
});

test('hides unused scoped families from panel pools', () => {
    const pools = [
        { key: 'five_hour', label: '5h', scoped: false, usedPercent: 0 },
        { key: 'scope:spark', label: 'Codex Spark', scoped: true, usedPercent: 0 },
        { key: 'scope:fable', label: 'Fable', scoped: true, usedPercent: 1 },
    ];

    assert.deepEqual(model.panelUsagePools(pools).map(pool => pool.label), ['5h', 'Fable']);
    assert.equal(pools.length, 3);
});

test('account state gives paused, token, and rate limits priority', () => {
    assert.equal(model.accountState({ paused: true, pauseReason: 'Manual' }, null, NOW).key, 'paused');
    assert.equal(model.accountState({ tokenStatus: 'expired' }, null, NOW).key, 'error');
    assert.equal(model.accountState({ rateLimitedUntil: '2026-07-20T12:10:00Z' }, null, NOW).key, 'limited');
    assert.equal(model.accountState({}, { status: 'usage_exhausted' }, NOW).label, 'Usage exhausted');
    assert.equal(model.accountState({}, { status: 'available' }, NOW).key, 'available');
});

test('recognizes Clankermux epoch-millisecond provider overloads', () => {
    const overloadedUntil = NOW + 60_000;
    const state = model.accountState({ providerOverloadedUntil: overloadedUntil }, null, NOW);

    assert.deepEqual(state, {
        key: 'overloaded',
        label: 'Provider overloaded',
        until: overloadedUntil,
    });
    assert.equal(model.accountState({ providerOverloadedUntil: NOW - 1 }, null, NOW).key, 'available');
});

test('groups provider overloads and corrects the effective routable count', () => {
    const overloadedUntil = NOW + 60_000;
    const accounts = ['Main', 'Backup'].map(name => ({
        name,
        provider: 'anthropic',
        providerOverloadKey: 'anthropic-upstream',
        providerOverloadedUntil: overloadedUntil,
    }));
    const health = {
        status: 'ok',
        pool: { configured: 2, routable: 2 },
        accounts_detail: accounts.map(account => ({ name: account.name, status: 'available' })),
    };

    const view = model.buildView(accounts, health, {}, NOW);
    assert.equal(view.pool.routable, 0);
    assert.deepEqual(view.providerOverloads, [{
        key: 'anthropic-upstream',
        provider: 'Anthropic',
        until: overloadedUntil,
        accountCount: 2,
    }]);
    assert.ok(view.accounts.every(account => account.state.key === 'overloaded'));
});

test('keeps fallback-provider accounts available during an overload', () => {
    const overloadedUntil = NOW + 60_000;
    const accounts = [
        ...['Claude A', 'Claude B'].map(name => ({
            name,
            provider: 'anthropic',
            providerOverloadKey: 'anthropic-upstream',
            providerOverloadedUntil: overloadedUntil,
        })),
        ...['Codex A', 'Codex B'].map(name => ({ name, provider: 'codex' })),
    ];
    const health = {
        status: 'ok',
        pool: { configured: 4, routable: 4 },
        accounts_detail: accounts.map(account => ({ name: account.name, status: 'available' })),
    };

    const view = model.buildView(accounts, health, {}, NOW);
    assert.equal(view.pool.routable, 2);
    assert.deepEqual(
        view.accounts.filter(account => account.state.key === 'available').map(account => account.provider),
        ['Codex', 'Codex']
    );
});

test('formats reset times compactly', () => {
    assert.equal(model.formatReset('2026-07-20T12:45:00Z', NOW), 'in 45m');
    assert.equal(model.formatReset(NOW + 45 * 60_000, NOW), 'in 45m');
    assert.equal(model.formatReset('2026-07-21T14:00:00Z', NOW), 'in 1d 2h');
    assert.equal(model.formatReset('2026-07-20T11:59:00Z', NOW), 'reset due');
    assert.equal(model.formatReset(null, NOW), '');
});

test('formats refresh timestamps in local time', () => {
    const localTime = new Date(2026, 6, 20, 14, 5, 9).getTime();
    assert.equal(model.formatTimestamp(localTime), '2026-07-20 14:05:09');
    assert.equal(model.formatTimestamp('not-a-date'), '');
    assert.equal(model.formatTimestamp(null), '');
});
