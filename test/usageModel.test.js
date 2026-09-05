'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../usageModel');
const fixtures = require('./publicV1Fixtures');

const { NOW } = fixtures;

test('normalizes configured server URLs', () => {
    assert.equal(model.normalizeBaseUrl(' proxy.example.test:8080/ '), 'http://proxy.example.test:8080');
    assert.equal(model.normalizeBaseUrl('https://example.test///'), 'https://example.test');
    assert.equal(model.normalizeBaseUrl(''), '');
});

test('refresh cycles settle once after every request completes', () => {
    const cycle = model.createRefreshCycle(3);
    assert.equal(cycle.completeOne(), false);
    assert.equal(cycle.completeOne(), false);
    assert.equal(cycle.completeOne(), true);
    assert.equal(cycle.completeOne(), false);
    assert.equal(cycle.expire(), false);
});

test('expired refresh cycles ignore late request completions', () => {
    const cycle = model.createRefreshCycle(3);
    assert.equal(cycle.completeOne(), false);
    assert.equal(cycle.expire(), true);
    assert.equal(cycle.completeOne(), false);
});

test('does not turn missing utilization into zero usage', () => {
    assert.equal(model.clampPercent(null), null);
    assert.equal(model.clampPercent(undefined), null);
    assert.equal(model.clampPercent(0), 0);
});

test('extracts public-v1 windows and their server predictions', () => {
    const windows = model.accountWindows(fixtures.accounts()[0]);

    assert.deepEqual(windows.map(window => [window.key, window.label, window.percent]), [
        ['five_hour', '5-hour', 90],
        ['seven_day', 'Weekly', 60],
        ['scope:fable', 'Fable', 40],
    ]);
    assert.equal(windows[0].projectedAtReset, 95);
    assert.equal(windows[0].forecastConfidence, 'high');
    assert.equal(windows[0].severity, 'warning');
    assert.equal(windows[2].scoped, true);
});

test('omits unreadable windows instead of presenting them as zero', () => {
    const windows = model.accountWindows(fixtures.accounts()[2]);
    assert.deepEqual(windows.map(window => window.key), ['seven_day']);
});

test('hides scoped and otherwise-scoped windows when configured', () => {
    const account = fixtures.accounts()[0];
    account.windows.push({
        kind: 'other', scopeId: 'seven_day_oauth_apps', label: 'Claude Code weekly',
        utilizationPct: 25, resetsAt: null, observedAt: null, prediction: null,
    });

    assert.deepEqual(
        model.accountWindows(account, false).map(window => window.key),
        ['five_hour', 'seven_day']
    );
});

test('low-confidence exhaustion is warning rather than critical', () => {
    const window = model.accountWindows(fixtures.accounts()[1])[0];
    assert.equal(window.willExhaust, true);
    assert.equal(window.forecastConfidence, 'low');
    assert.equal(window.severity, 'warning');
});

test('maps availability, reasons, and recovery instants', () => {
    const state = model.accountState(fixtures.accounts()[1]);
    assert.deepEqual(state, {
        key: 'limited',
        label: 'Rate limited · Queueing',
        until: '2026-08-24T12:30:00.000Z',
    });
    assert.equal(model.accountState(fixtures.accounts()[0]).key, 'available');
});

test('keeps credential health separate from account availability', () => {
    assert.equal(model.credentialNotice(fixtures.accounts()[0]), null);
    assert.deepEqual(model.credentialNotice(fixtures.accounts()[1]), {
        key: 'available',
        label: 'Credential refreshable',
    });
    assert.equal(model.credentialNotice({ credential: { state: 'invalid' } }).key, 'error');
    assert.equal(model.credentialNotice({ credential: { state: 'not_applicable' } }), null);
});

test('renders explicit measurement states', () => {
    assert.equal(model.measurementNotice(fixtures.accounts()[0]), null);
    assert.equal(model.measurementNotice(fixtures.accounts()[1]), 'cached usage');
    assert.equal(model.measurementNotice({ measurementState: 'missing' }), 'usage missing');
    assert.equal(model.measurementNotice({ measurementState: 'not_applicable' }), null);
});

test('uses server-provided pool aggregates without recomputing account means', () => {
    const pools = model.usagePools(fixtures.status());
    assert.deepEqual(pools.map(pool => [pool.label, pool.usedPercent, pool.accountCount, pool.unknownCount]), [
        ['5h', 38, 2, 1],
        ['7d', 50, 3, 0],
        ['Fable', 70, 2, 0],
    ]);

    // Account A and B's 5-hour values average to 50, proving 38 came from status.
    const accountMean = (fixtures.accounts()[0].windows[0].utilizationPct +
        fixtures.accounts()[1].windows[0].utilizationPct) / 2;
    assert.equal(accountMean, 50);
    assert.equal(pools[0].usedPercent, 38);
});

test('can suppress provider-scoped pool aggregates', () => {
    assert.deepEqual(model.usagePools(fixtures.status(), false).map(pool => pool.label), ['5h', '7d']);
});

test('recognizes open and half-open provider overload breakers', () => {
    const current = fixtures.status();
    current.providers[0].anyOverload = {
        state: 'half_open', until: null, probeActive: true,
    };
    current.providers[0].providerWideOverload = {
        state: 'open', until: '2026-08-24T12:20:00.000Z', probeActive: false,
    };

    assert.deepEqual(model.providerOverloads(current, fixtures.accounts()), [{
        key: 'anthropic',
        provider: 'Anthropic',
        state: 'half_open',
        until: null,
        probeActive: true,
        providerWide: true,
        accountCount: 2,
    }]);
});

test('builds the public-v1 view and prioritizes the default candidate', () => {
    const view = model.buildView(
        fixtures.accounts(), fixtures.status(), fixtures.runway(),
        fixtures.pacing(), fixtures.workloadHeadroom(),
        { statusReceivedAt: NOW, runwayReceivedAt: NOW }, NOW
    );

    assert.equal(view.accounts[0].name, 'Account A');
    assert.equal(view.accounts[0].defaultCandidate, true);
    assert.deepEqual([view.pool.defaultRoutable, view.pool.configured], [2, 3]);
    assert.deepEqual(view.usagePools.map(pool => pool.usedPercent), [38, 50, 70]);
    assert.equal(view.pace.action, 'CUT');
    assert.deepEqual(view.workloads.map(row => row.label), ['Claude', 'GPT', 'Fable']);
    assert.equal(view.pacing.classes[1].fiveHour.summary, '5-hour usage is not reported');
});

test('maps signed pool headroom onto a centered pace signal', () => {
    const margin = fixtures.runway({
        worstStatedOutcome: {
            kind: 'beyond_horizon', exhaustsAt: null, causes: [],
            headroomPct: 31, headroomDirection: 'margin',
        },
    });
    const room = model.paceView(margin, NOW, NOW);
    assert.deepEqual(
        [room.action, room.valueText, room.side, room.fillPercent, room.severity],
        ['ROOM', '+31%', 'right', 62, 'normal']
    );

    const cut = model.paceView(fixtures.runway(), NOW, NOW);
    assert.deepEqual(
        [cut.action, cut.valueText, cut.side, cut.fillPercent, cut.severity],
        ['CUT', '−18%', 'left', 36, 'warning']
    );
});

test('reads null pool headroom from the outcome kind instead of treating it as zero', () => {
    const cases = [
        ['beyond_horizon', 'REACHES HORIZON', 'none', 0, 'unknown'],
        ['runway', 'MAY EXHAUST', 'none', 0, 'unknown'],
        ['out_now', 'OUT', 'left', 100, 'critical'],
        ['unknown', 'NO READING', 'none', 0, 'unknown'],
        ['no_accounts', 'NO ACCOUNTS', 'none', 0, 'unknown'],
        ['other', 'NO READING', 'none', 0, 'unknown'],
    ];
    for (const [kind, action, side, fillPercent, severity] of cases) {
        const pace = model.paceView(fixtures.runway({
            worstStatedOutcome: {
                kind, exhaustsAt: null, causes: [],
                headroomPct: null, headroomDirection: null,
            },
        }), NOW, NOW);
        assert.deepEqual(
            [pace.action, pace.side, pace.fillPercent, pace.severity],
            [action, side, fillPercent, severity]
        );
    }
});

test('does not infer pace when an older runway payload lacks headroom fields', () => {
    const response = fixtures.runway();
    delete response.worstStatedOutcome.headroomPct;
    delete response.worstStatedOutcome.headroomDirection;

    const pace = model.paceView(response, NOW, NOW);
    assert.equal(pace.action, 'NO READING');
    assert.equal(pace.side, 'none');
});

test('describes an absent runway resource as unavailable', () => {
    const pace = model.paceView(null, NOW, NOW);
    const runway = model.runwayView(null, [], 72, NOW, NOW);

    assert.equal(pace.action, 'NO READING');
    assert.equal(pace.coverageText, 'Runway unavailable');
    assert.equal(pace.available, false);
    assert.equal(runway.summary, 'Quota runway is unavailable');
    assert.equal(runway.coverageText, 'Runway unavailable');
});

test('qualifies incomplete pool headroom without changing its direction', () => {
    const pace = model.paceView(fixtures.runway({
        coverage: { activeKeyCount: 3, statedKeyCount: 2, unobservedKeyCount: 1 },
        worstStatedOutcome: {
            kind: 'beyond_horizon', exhaustsAt: null, causes: [],
            headroomPct: 20, headroomDirection: 'margin',
        },
    }), NOW, NOW);
    assert.equal(pace.action, 'ROOM*');
    assert.equal(pace.side, 'right');
    assert.equal(pace.incomplete, true);
});

test('maps exact classes and conservative family bounds without conflating them', () => {
    const rows = model.workloadHeadroomView(fixtures.workloadHeadroom(), NOW, NOW).rows;
    assert.deepEqual(
        rows.map(row => [row.label, row.longTerm.valueText, row.basis, row.incomplete]),
        [
            ['Claude', '+30%', 'exact', false],
            ['GPT', '+41%', 'exact', false],
            ['Fable', '–', 'bound', true],
        ]
    );
    assert.equal(rows[2].depthText, '2 eligible · 1 unreadable · 1 spent');
    assert.equal(rows[2].longTerm.projectionLabel, 'Early / structural estimate');
});

test('describes a family deficit as a safe cut rather than an exact threshold', () => {
    const response = fixtures.workloadHeadroom({
        rows: [{
            dimensionKind: 'family', dimensionId: 'fable', label: 'Fable',
            outcomeKind: 'runway', exhaustsAt: '2026-08-25T00:00:00.000Z',
            headroomPct: 40, headroomDirection: 'deficit',
            headroomBasis: 'conservative_bound', headroomAbsence: null,
            projectionBasis: 'measured', eligibleAccounts: 2,
            unreadableAccounts: 0, spentAccounts: 0,
        }],
    });
    const [row] = model.workloadHeadroomView(response, NOW, NOW).rows;
    assert.equal(row.longTerm.valueText, '−40% bound');
    assert.match(row.longTerm.summary, /Conservative cut/);
});

test('structural evidence takes priority over long-term headroom absence reasons', () => {
    const base = {
        dimensionKind: 'family', dimensionId: 'fable', label: 'Fable',
        headroomPct: null, headroomDirection: null,
        headroomBasis: 'conservative_bound', projectionBasis: 'structural',
        eligibleAccounts: 2, unreadableAccounts: 0, spentAccounts: 0,
    };
    const cases = [
        [{ outcomeKind: 'beyond_horizon', headroomAbsence: 'beyond_probe_range' }, 'EARLY'],
        [{ outcomeKind: 'runway', headroomAbsence: 'beyond_probe_range' }, 'EARLY'],
        [{ outcomeKind: 'runway', headroomAbsence: 'bound_broken_by_credits' }, 'EARLY'],
        [{ outcomeKind: 'unknown', headroomAbsence: 'not_projected' }, 'NO READING'],
        [{ outcomeKind: 'beyond_horizon', headroomAbsence: 'other' }, 'EARLY'],
    ];
    for (const [fields, expected] of cases) {
        const response = fixtures.workloadHeadroom({ rows: [{ ...base, ...fields }] });
        assert.equal(model.workloadHeadroomView(response, NOW, NOW).rows[0].longTerm.action, expected);
    }
});

test('fails closed when a workload headroom basis is unknown', () => {
    const response = fixtures.workloadHeadroom({
        rows: [{
            dimensionKind: 'family', dimensionId: 'fable', label: 'Fable',
            outcomeKind: 'beyond_horizon', exhaustsAt: null,
            headroomPct: 30, headroomDirection: 'margin',
            headroomBasis: 'other', headroomAbsence: null,
            projectionBasis: 'measured', eligibleAccounts: 2,
            unreadableAccounts: 0, spentAccounts: 0,
        }],
    });
    const [row] = model.workloadHeadroomView(response, NOW, NOW).rows;

    assert.equal(row.longTerm.action, 'NO READING');
    assert.equal(row.longTerm.valueText, '–');
    assert.equal(row.basisLabel, 'Unknown basis');
});

test('keeps workload state words off the compact panel', () => {
    const rows = model.workloadHeadroomView(fixtures.workloadHeadroom(), NOW, NOW).rows;
    assert.equal(model.panelWorkloadLabel(rows[0]), '');
    assert.equal(model.panelWorkloadLabel(rows[0], true), '');

    const deficitResponse = fixtures.workloadHeadroom({
        rows: [{
            dimensionKind: 'class', dimensionId: 'anthropic', label: 'Claude',
            outcomeKind: 'runway', exhaustsAt: '2026-08-25T00:00:00.000Z',
            headroomPct: 20, headroomDirection: 'deficit',
            headroomBasis: 'exact', headroomAbsence: null,
            projectionBasis: 'measured', eligibleAccounts: 2,
            unreadableAccounts: 0, spentAccounts: 0,
        }],
    });
    const [deficit] = model.workloadHeadroomView(deficitResponse, NOW, NOW).rows;
    assert.equal(model.panelWorkloadLabel(deficit), '');

    const response = fixtures.workloadHeadroom({
        rows: [{
            dimensionKind: 'family', dimensionId: 'fable', label: 'Fable',
            outcomeKind: 'runway', exhaustsAt: null,
            headroomPct: null, headroomDirection: null,
            headroomBasis: 'conservative_bound', headroomAbsence: 'beyond_probe_range',
            projectionBasis: 'structural', eligibleAccounts: 2,
            unreadableAccounts: 0, spentAccounts: 0,
        }],
    });
    const [exceptional] = model.workloadHeadroomView(response, NOW, NOW).rows;
    assert.equal(exceptional.side, 'none');
    assert.equal(exceptional.fillPercent, 0);
    assert.equal(exceptional.longTerm.action, 'EARLY');
    assert.equal(model.panelWorkloadLabel(exceptional), '');
    assert.equal(model.panelWorkloadLabel(exceptional, true), '');
    assert.equal(model.panelWorkloadLabel({
        action: 'NO BOUND', valueText: '–', percent: null, direction: null,
    }, true), '');
    assert.equal(model.panelWorkloadLabel({
        action: 'NO READING', valueText: '–', percent: null, direction: null,
    }, true), '');
});

test('uses server pacing tones and preserves absent burn and five-hour readings', () => {
    const view = model.pacingView(fixtures.pacing(), fixtures.accounts(), NOW, NOW);
    assert.equal(view.bindingClassId, 'codex');
    assert.deepEqual(
        view.classes.map(item => [item.label, item.binding, item.severity, item.burnText]),
        [
            ['Claude', false, 'normal', '1.08× sustainable pace'],
            ['GPT', true, 'warning', 'Pace not stated'],
        ]
    );
    assert.equal(view.classes[0].leastUsedAccountName, 'Account A');
    assert.equal(view.classes[1].fiveHour.unread, true);
    assert.equal(view.classes[1].fiveHour.summary, '5-hour usage is not reported');
    assert.equal(view.classes[1].fiveHour.severity, 'unknown');
});

test('keeps the pool five-hour tone separate from unread class measurements', () => {
    const response = fixtures.pacing({ fiveHourOutlookTone: 'destructive' });
    const view = model.pacingView(response, fixtures.accounts(), NOW, NOW);

    assert.equal(view.fiveHourSeverity, 'critical');
    assert.equal(view.classes[1].fiveHour.unread, true);
    assert.equal(view.classes[1].fiveHour.severity, 'unknown');
});

test('finite runway becomes the compact panel headline and resolves its cause', () => {
    const view = model.runwayView(fixtures.runway(), [
        { id: 'account-c', name: 'Account C' },
    ], 72, NOW, NOW);

    assert.equal(view.value, '4d');
    assert.equal(view.severity, 'normal');
    assert.equal(view.coverageText, '2 of 2 active keys observed');
    assert.deepEqual(view.causes, ['Account C · weekly']);
});

test('runway warning threshold is expressed in hours', () => {
    const response = fixtures.runway({
        worstStatedOutcome: {
            kind: 'runway',
            exhaustsAt: new Date(NOW + 48 * 60 * 60 * 1000).toISOString(),
            causes: [],
        },
    });
    assert.equal(model.runwayView(response, [], 72, NOW, NOW).severity, 'warning');
    assert.equal(model.runwayView(response, [], 24, NOW, NOW).severity, 'normal');
});

test('omits a runway quantisation band when both endpoints are equal', () => {
    const instant = new Date(NOW + 4 * 24 * 60 * 60 * 1000).toISOString();
    const response = fixtures.runway({
        worstStatedOutcome: {
            kind: 'runway', exhaustsAt: instant, causes: [],
            earliestExhaustsAt: instant, latestExhaustsAt: instant,
        },
    });

    assert.equal(model.runwayView(response, [], 72, NOW, NOW).bandText, '');
});

test('incomplete runway coverage is visibly qualified', () => {
    const response = fixtures.runway({
        coverage: { activeKeyCount: 3, statedKeyCount: 2, unobservedKeyCount: 1 },
        worstStatedOutcome: { kind: 'beyond_horizon', exhaustsAt: null, causes: [] },
    });
    const view = model.runwayView(response, [], 72, NOW, NOW);

    assert.equal(view.severity, 'warning');
    assert.match(view.coverageText, /1 unobserved/);
});

test('renders every non-finite runway outcome honestly', () => {
    const cases = [
        ['out_now', 'OUT', 'critical'],
        ['beyond_horizon', '>14d', 'normal'],
        ['unknown', '–', 'warning'],
        ['no_accounts', '–', 'critical'],
        ['other', '?', 'warning'],
    ];
    for (const [kind, value, severity] of cases) {
        const response = fixtures.runway({
            worstStatedOutcome: { kind, exhaustsAt: null, causes: [] },
        });
        const view = model.runwayView(response, [], 72, NOW, NOW);
        assert.deepEqual([view.value, view.severity], [value, severity]);
    }
});

test('server clock advances from the local receive instant', () => {
    assert.equal(
        model.anchoredNow(fixtures.NOW_ISO, NOW + 1000, NOW + 61_000),
        NOW + 60_000
    );
});

test('formats reset times and timestamps compactly', () => {
    assert.equal(model.formatReset('2026-08-24T12:45:00.000Z', NOW), 'in 45m');
    assert.equal(model.formatReset('2026-08-25T14:00:00.000Z', NOW), 'in 1d 2h');
    assert.equal(model.formatReset(null, NOW), '');
    assert.equal(model.formatTimestamp('not-a-date'), '');
});


test('next-reset room and long-term deficit remain independent', () => {
    const view = model.workloadHeadroomView(fixtures.nextResetWorkloads(), NOW, NOW);
    const row = view.rows.find(row => row.key === 'class:codex');
    assert.equal(row.action, 'ROOM');
    assert.equal(row.valueText, '+25%');
    assert.equal(row.intervalLabel, 'Until next weekly reset');
    assert.match(row.resetText, /in 1d/);
    assert.equal(row.longTerm.action, 'CUT');
    assert.equal(row.longTerm.valueText, '−40%');
    assert.equal(row.longTerm.intervalLabel, 'Long-term pace · 14 days');
    assert.equal(model.panelWorkloadLabel(row, true), '+25%');
});

test('long-term interval comes from horizonMs and must be known for advice', () => {
    const response = fixtures.nextResetWorkloads({ horizonMs: 3.5 * 86400000 });
    assert.equal(model.workloadHeadroomView(response, NOW).rows[0].longTerm.intervalLabel,
        'Long-term pace · 3.5 days');
    response.horizonMs = null;
    const row = model.workloadHeadroomView(response, NOW).rows[0];
    assert.equal(row.action, 'ROOM');
    assert.equal(row.longTerm.percent, null);
    assert.match(row.longTerm.summary, /interval unavailable/);
});

test('old, null and invalid next-reset deadlines leave long-term context available', () => {
    for (const nextReset of [undefined, null, {}, { resetsAt: 'not-a-date' }, { resetsAt: null }, { resetsAt: 1e20 }, { resetsAt: '100000000000000000000' }]) {
        const response = fixtures.nextResetWorkloads();
        response.rows[1].nextReset = nextReset;
        const row = model.workloadHeadroomView(response, NOW).rows[1];
        assert.equal(row.summary, 'Next-reset forecast unavailable');
        assert.equal(row.fillPercent, 0);
        assert.equal(row.resetText, '');
        assert.equal(row.longTerm.action, 'CUT');
    }
});

test('next-reset deadline expires between polls without inferring quota recovery', () => {
    const response = fixtures.nextResetWorkloads();
    const deadline = NOW + 30000;
    response.rows[1].nextReset.resetsAt = new Date(deadline).toISOString();
    assert.equal(model.workloadHeadroomView(response, deadline - 1, NOW).rows[1].action, 'ROOM');
    const row = model.workloadHeadroomView(response, deadline, NOW).rows[1];
    assert.equal(row.expired, true);
    assert.equal(row.action, 'EXPIRED');
    assert.equal(row.fillPercent, 0);
    assert.equal(row.resetsAt, new Date(deadline).toISOString());
    assert.match(row.resetText, /expired/);
    assert.equal(model.panelWorkloadLabel(row), 'Expired');
    assert.equal(row.longTerm.action, 'CUT');
});

test('both intervals withhold advice without measured evidence', () => {
    for (const projectionBasis of ['structural', null, undefined, 'other', 'future-basis']) {
        for (const headroomPct of [25, null]) {
            const response = fixtures.nextResetWorkloads();
            Object.assign(response.rows[1], { projectionBasis, headroomPct });
            Object.assign(response.rows[1].nextReset, { projectionBasis, headroomPct });
            const row = model.workloadHeadroomView(response, NOW).rows[1];
            for (const forecast of [row, row.longTerm]) {
                assert.equal(forecast.percent, null);
                assert.equal(forecast.side, 'none');
                assert.equal(forecast.fillPercent, 0);
                assert.match(forecast.summary, projectionBasis === 'structural' ? /Early \/ structural/ : /Evidence unavailable/);
            }
        }
    }
});

test('measured null headroom states the outcome without extreme bars or zero substitution', () => {
    for (const outcomeKind of ['runway', 'beyond_horizon']) {
        const response = fixtures.nextResetWorkloads();
        const fields = {
            headroomPct: null, headroomDirection: null, outcomeKind,
            exhaustsAt: outcomeKind === 'runway' ? '2026-08-24T20:00:00.000Z' : null,
        };
        Object.assign(response.rows[1], fields, { headroomAbsence: 'beyond_probe_range' });
        Object.assign(response.rows[1].nextReset, fields);
        const row = model.workloadHeadroomView(response, NOW).rows[1];
        for (const forecast of [row, row.longTerm]) {
            assert.equal(forecast.percent, null);
            assert.equal(forecast.fillPercent, 0);
            assert.equal(forecast.side, 'none');
            assert.match(forecast.summary, outcomeKind === 'runway' ? /Required cut unavailable/ : /Pace margin unavailable/);
            if (outcomeKind === 'runway')
                assert.match(forecast.summary, /Projected exhaustion:/);
        }
        assert.match(row.summary, /next reset/);
        assert.match(row.longTerm.summary, /stated model horizon/);
    }
});

test('long-term absence reasons do not leak into the next-reset interpretation', () => {
    const response = fixtures.nextResetWorkloads();
    const raw = response.rows[2];
    Object.assign(raw, { projectionBasis: 'measured', headroomPct: null,
        headroomDirection: null, headroomAbsence: 'bound_broken_by_credits' });
    raw.nextReset.projectionBasis = 'measured';
    const row = model.workloadHeadroomView(response, NOW).rows[2];
    assert.equal(row.valueText, '≥+25%');
    assert.match(row.summary, /conservative bound/);
    assert.match(row.longTerm.summary, /Pace margin unavailable/);
    assert.equal(row.depthText, '2 eligible · 1 unreadable · 1 spent');
    assert.match(row.coverageCaveat, /lower bounds on runway/);
});

test('unrecognized outcomes stay neutral while no_accounts and out_now have distinct meanings', () => {
    for (const outcomeKind of ['unknown', 'other', 'future-kind', 'no_accounts', 'out_now']) {
        const response = fixtures.nextResetWorkloads();
        Object.assign(response.rows[1], { outcomeKind });
        Object.assign(response.rows[1].nextReset, { outcomeKind });
        const row = model.workloadHeadroomView(response, NOW).rows[1];
        for (const forecast of [row, row.longTerm]) {
            assert.equal(forecast.percent, null);
            if (outcomeKind === 'out_now') {
                assert.equal(forecast.action, 'OUT');
                assert.equal(forecast.summary, 'Available modeled capacity exhausted');
            } else {
                assert.equal(forecast.fillPercent, 0);
                assert.equal(forecast.summary, outcomeKind === 'no_accounts'
                    ? 'No active accounts for this workload' : 'Forecast unavailable');
            }
        }
    }
});

test('invalid percentages and unknown directions cannot produce signed advice', () => {
    for (const headroomPct of [NaN, Infinity, -10, '25', true, {}, []]) {
        const response = fixtures.nextResetWorkloads();
        response.rows[0].nextReset.headroomPct = headroomPct;
        const row = model.workloadHeadroomView(response, NOW).rows[0];
        assert.equal(row.percent, null);
        assert.equal(row.fillPercent, 0);
    }
    for (const headroomDirection of [null, 'other', 'future-direction', 'deficit']) {
        const response = fixtures.nextResetWorkloads();
        response.rows[0].nextReset.headroomDirection = headroomDirection;
        assert.equal(model.workloadHeadroomView(response, NOW).rows[0].percent, null);
    }
    const response = fixtures.nextResetWorkloads();
    response.rows[0].nextReset.headroomPct = 0;
    assert.equal(model.workloadHeadroomView(response, NOW).rows[0].valueText, '+0%');
});

test('forecast age uses computation time even when a cached snapshot is just received', () => {
    const response = fixtures.nextResetWorkloads();
    const now = NOW + 180000;
    assert.equal(model.workloadHeadroomView(response, now - 1, now - 1).stale, false);
    const view = model.workloadHeadroomView(response, now, now);
    assert.equal(view.ageMs, 180000);
    assert.equal(view.stale, true);
    assert.equal(view.generatedAt, fixtures.NOW_ISO);
    assert.match(view.freshnessText, /Stale · Forecast computed:/);
    const row = view.rows[1];
    assert.equal(row.action, 'STALE');
    assert.equal(row.fillPercent, 0);
    assert.match(row.summary, /Last reading: \+25%/);
    assert.match(row.longTerm.summary, /Last reading: −40%/);
    assert.equal(model.panelWorkloadLabel(row), 'Stale');
});

test('a fetch failure immediately marks only the failed forecast feeds stale', () => {
    const view = model.buildView(fixtures.accounts(), fixtures.status(), fixtures.runway(),
        fixtures.pacing(), fixtures.nextResetWorkloads(), { workloadHeadroomFetchFailed: true }, NOW);
    assert.equal(view.workloads[1].stale, true);
    assert.equal(view.pace.stale, false);
    assert.equal(view.pacing.stale, false);
    const allFailed = model.buildView(fixtures.accounts(), fixtures.status(), fixtures.runway(),
        fixtures.pacing(), fixtures.nextResetWorkloads(), {
            workloadHeadroomFetchFailed: true, runwayFetchFailed: true, pacingFetchFailed: true,
        }, NOW);
    assert.equal(allFailed.pace.action, 'STALE');
    assert.equal(allFailed.runway.severity, 'unknown');
    assert.equal(allFailed.pacing.classes[0].severity, 'unknown');
    assert.equal(allFailed.pacing.classes[0].burnSeverity, 'unknown');
    const recovered = model.workloadHeadroomView(fixtures.nextResetWorkloads(), NOW, NOW, false);
    assert.equal(recovered.rows[1].action, 'ROOM');
});

test('missing computation timestamps suppress advice', () => {
    for (const generatedAt of [undefined, null, 'invalid']) {
        const view = model.workloadHeadroomView(fixtures.nextResetWorkloads({ generatedAt }), NOW, NOW);
        assert.equal(view.stale, true);
        assert.equal(view.ageMs, null);
        assert.equal(view.rows[0].percent, null);
        assert.match(view.freshnessText, /computed: unknown/);
    }
});

test('paused accounts and banked credits never change the server workload forecast', () => {
    const accounts = fixtures.accounts();
    accounts[2].availability = { state: 'paused' };
    accounts[2].bankedResets = 2;
    const response = fixtures.nextResetWorkloads();
    const view = model.buildView(accounts, fixtures.status(), fixtures.runway(), fixtures.pacing(), response, {}, NOW);
    const row = view.workloads.find(row => row.key === 'class:codex');
    assert.equal(row.valueText, '+25%');
    assert.equal(row.eligibleAccounts, 1);
    assert.equal(view.accounts.find(account => account.id === 'account-c').state.key, 'paused');
});

test('stable workload IDs survive reordering, duplicate labels and additive fields', () => {
    const response = fixtures.nextResetWorkloads();
    response.rows.reverse();
    response.rows.forEach(row => { row.label = 'Same label'; row.futureField = { nested: true }; });
    const view = model.workloadHeadroomView(response, NOW);
    assert.equal(view.rows.find(row => row.key === 'class:codex').longTerm.valueText, '−40%');
    response.rows = response.rows.filter(row => row.dimensionId !== 'codex');
    assert.equal(model.workloadHeadroomView(response, NOW).rows.some(row => row.key === 'class:codex'), false);
    response.rows.push({ dimensionKind: 'other', dimensionId: 'future' }, { dimensionKind: 'class' });
    assert.equal(model.workloadHeadroomView(response, NOW).rows.length, 2);
});
