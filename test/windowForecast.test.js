'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../usageModel');
const fixtures = require('./publicV1Fixtures');
const { NOW } = fixtures;
const at = offset => new Date(NOW + offset).toISOString();
const HOUR = 3600000;

function account(forecast = {}) {
    return {
        measurementState: 'fresh',
        windows: [{
            kind: 'seven_day', utilizationPct: 30, observedAt: at(-30000),
            resetsAt: at(48 * HOUR), prediction: null,
            forecast: { state: 'projected', reason: null, exhaustsAt: at(2 * HOUR), lowConfidence: false, ...forecast },
        }],
    };
}
const view = (a, now = NOW) => model.accountWindows(a, true, 80, now)[0];

test('weekly forecast works with null prediction and qualifies low confidence', () => {
    const high = view(account());
    assert.equal(high.forecastText, 'out ~2h');
    assert.equal(high.willExhaust, true);
    assert.equal(high.severity, 'critical');
    const low = view(account({ lowConfidence: true }));
    assert.equal(low.forecastConfidence, 'low');
    assert.equal(low.forecastSeverity, 'warning');
    assert.match(low.forecastDescription, /Low-confidence/);
});

test('raw exhaustion at or after reset never warns and null does not imply capacity', () => {
    for (const exhaustsAt of [at(48 * HOUR), at(49 * HOUR), null]) {
        const w = view(account({ exhaustsAt }));
        assert.equal(w.willExhaust, false);
        assert.equal(w.forecastText, '—');
        assert.equal(w.severity, 'normal');
    }
});

test('learning reasons stay learning after readyAt, independently of weekly estimates', () => {
    for (const reason of ['no_usage', 'unstarted', 'short_history']) {
        const a = account();
        a.windows.unshift({
            kind: 'five_hour', utilizationPct: 0, observedAt: at(-30000),
            resetsAt: reason === 'unstarted' ? null : at(3 * HOUR),
            forecast: { state: 'learning', reason, readyAt: at(-HOUR), exhaustsAt: null, lowConfidence: null },
        });
        const windows = model.accountWindows(a, true, 80, NOW);
        assert.equal(windows[0].forecastText, { no_usage: 'no usage', unstarted: 'unstarted', short_history: 'learning' }[reason]);
        assert.equal(windows[0].willExhaust, null);
        assert.equal(windows[1].forecastText, 'out ~2h');
    }
});

test('missing and future forecast enums never revive regression predictions', () => {
    for (const forecast of [null, undefined, {}, { state: 'future' },
        { state: 'learning', reason: 'future' }, { state: 'projected', reason: 'future' }]) {
        const a = account();
        a.windows[0].forecast = forecast;
        a.windows[0].prediction = { willExhaustBeforeReset: true, predictedUtilizationAtResetPct: 100, exhaustsAt: at(HOUR) };
        const w = view(a);
        assert.equal(w.forecastText, '—');
        assert.equal(w.willExhaust, null);
        assert.equal(w.severity, 'normal');
    }
});

test('invalid timestamps, stale measurements and elapsed resets suppress forecasts', () => {
    for (const field of ['resetsAt', 'observedAt']) {
        for (const value of [null, 'invalid']) {
            const a = account();
            a.windows[0][field] = value;
            assert.equal(view(a).forecastText, '—');
        }
    }
    assert.equal(view(account({ exhaustsAt: 'invalid' })).forecastText, '—');
    const stale = account();
    stale.measurementState = 'stale';
    assert.equal(view(stale).forecastText, '—');
    assert.equal(view(account(), NOW + 48 * HOUR).forecastText, '—');
    assert.equal(view(account(), NOW + 2 * HOUR).forecastText, 'out ~now');
});

test('buildView applies its clock to account window deadline transitions', () => {
    const result = model.buildView([account()], null, null, null, null, {}, NOW + 48 * HOUR);
    assert.equal(result.accounts[0].windows[0].forecastText, '—');
});

test('server example retains idle session learning alongside a weekly estimate', () => {
    const example = require('./api-examples/accounts.partial-learning.json');
    const windows = model.accountWindows(example.accounts[0], true, 80, Date.parse(example.generatedAt));
    assert.deepEqual(windows.map(w => w.percent), [0, 60]);
    assert.equal(windows[0].forecastText, 'no usage');
    assert.equal(windows[0].forecastDescription, 'No usage measured');
    assert.equal(windows[0].willExhaust, null);
    assert.equal(windows[1].willExhaust, true);
    assert.equal(windows[1].forecastConfidence, 'high');
    assert.equal(windows[1].forecastSeverity, 'critical');
    assert.match(windows[1].forecastText, /^out ~1d/);
});

test('compact learning label requires learning to explain all excluded coverage', () => {
    const response = fixtures.nextResetWorkloads();
    const raw = response.rows[0];
    Object.assign(raw, { eligibleAccounts: 5, unreadableAccounts: 2, learningAccounts: 2 });
    Object.assign(raw.nextReset, { guidanceState: 'uncertain', projectionBasis: 'measured', headroomAbsence: 'beyond_probe_range' });
    let row = model.workloadHeadroomView(response, NOW).rows[0];
    assert.equal(model.panelWorkloadLabel(row), 'Learn');
    assert.match(model.workloadTooltipLine(row), /3\/5 modeled · 2 learning/);
    assert.match(model.workloadTooltipLine(row), /outside tested pace range/);
    raw.learningAccounts = 1;
    row = model.workloadHeadroomView(response, NOW).rows[0];
    assert.equal(model.panelWorkloadLabel(row), '?');
    raw.learningAccounts = 2;
    raw.nextReset.projectionBasis = 'structural';
    row = model.workloadHeadroomView(response, NOW).rows[0];
    assert.equal(model.panelWorkloadLabel(row), '?');
});

test('probe limits explain missing advice without becoming panel percentages', () => {
    const response = fixtures.nextResetWorkloads();
    response.paceProbe = { maximumReductionPct: 40, maximumIncreasePct: 60, stepPct: 1 };
    const raw = response.rows[0];
    for (const [outcomeKind, explanation, label] of [
        ['runway', /modeled out even at −40% rate/, 'Risk'],
        ['beyond_horizon', /no failure at tested \+60% rate/, 'Holds'],
    ]) {
        Object.assign(raw.nextReset, { guidanceState: 'unquantified', headroomAbsence: 'beyond_probe_range', outcomeKind });
        const row = model.workloadHeadroomView(response, NOW).rows[0];
        assert.equal(model.panelWorkloadLabel(row), label);
        assert.match(model.workloadTooltipLine(row), explanation);
        assert.equal(row.percent, null);
    }
});
