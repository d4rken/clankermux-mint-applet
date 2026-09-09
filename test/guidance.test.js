'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const model = require('../usageModel');
const fixtures = require('./publicV1Fixtures');
const examples = name => JSON.parse(fs.readFileSync(path.join(__dirname, 'api-examples', `workload-headroom${name}.json`)));
const build = (response, pacing = fixtures.pacing(), options = {}, now = fixtures.NOW) =>
    model.buildView(fixtures.accounts(), fixtures.status(), fixtures.runway(), pacing, response, options, now);

const cases = [
    ['', ['↑ ~25% room'], ['↓ ~20% pace']],
    ['.partial-coverage', ['Limited evidence'], ['Limited evidence']],
    ['.learning', ['Learning'], ['Learning']],
    ['.structural', ['Limited evidence'], ['Limited evidence']],
    ['.exhausted', ['Out'], ['Out']],
    ['.probe-limit', ['Reaches reset'], ['May run out']],
    ['.no-weekly-deadline', ['Unavailable'], ['Unknown']],
    ['.family-credits', ['Limited evidence'], ['May run out']],
    ['.family-bound', ['Limited evidence', 'Limited evidence'], ['Limited evidence', 'Limited evidence']],
    ['.missing-fable', ['↑ ~25% room'], ['↓ ~20% pace']],
];
for (const [name, primary, longTerm] of cases) {
    test(`renders the published ${name || 'opposing-interval'} example`, () => {
        const response = examples(name);
        const view = model.workloadHeadroomView(response, Date.parse(response.generatedAt));
        assert.deepEqual(view.rows.map(row => row.valueText), primary);
        assert.deepEqual(view.rows.map(row => row.longTerm.valueText), longTerm);
        for (const row of view.rows) {
            for (const forecast of [row, row.longTerm]) {
                if (forecast.valueText === 'Out') assert.equal(forecast.severity, 'critical');
                if (forecast.valueText === 'May run out') assert.equal(forecast.severity, 'warning');
            }
        }
        for (const row of view.rows) {
            for (const forecast of [row, row.longTerm]) {
                if (!['increase', 'reduce'].includes(forecast.guidanceState)) {
                    assert.equal(forecast.percent, null);
                    assert.doesNotMatch(forecast.valueText, /%|plenty|cut hard/i);
                }
            }
        }
    });
}

test('headlines use stable workload keys and never borrow burn-ratio advice', () => {
    const response = fixtures.nextResetWorkloads();
    response.rows.reverse();
    response.rows.forEach(row => { row.label = 'Duplicate'; row.futureField = true; });
    response.rows.find(row => row.dimensionId === 'fable').unopenedAccounts = 1;
    const pacing = fixtures.pacing();
    pacing.classes.forEach(row => { row.burnRatio = 99; });
    const view = build(response, pacing);
    assert.deepEqual(view.paceRows.map(row => [row.key, row.label, row.valueText]), [
        ['class:codex', 'GPT', '↑ ~25% room'],
        ['class:anthropic', 'Claude', '↑ ~25% room'],
        ['family:fable', 'Fable', 'Limited evidence'],
    ]);
    assert.match(view.paceRows[2].detail, /has not used Fable this week/);
    assert.doesNotMatch(view.paceRows[2].detail, /Duplicate/);
    assert.deepEqual(build(response, null).paceRows, view.paceRows);
    assert.equal(build(null, pacing).paceRows.every(row => row.valueText === 'Unknown'), true);
    assert.equal(build(response, pacing, { workloadHeadroomFetchFailed: true }).paceRows.every(row => row.valueText === 'Stale'), true);
});

test('an absent family stays Unknown unless family display is disabled', () => {
    const response = examples('.missing-fable');
    const now = Date.parse(response.generatedAt);
    const row = build(response, null, {}, now).paceRows.find(row => row.key === 'family:fable');
    assert.equal(row.valueText, 'Unknown');
    assert.match(row.detail, /Forecast unavailable/);
    assert.equal(build(response, null, { showScoped: false }, now).paceRows.length, 2);
});

test('every nonnumeric state remains explicit on the panel even if raw numbers exist', () => {
    for (const [guidanceState, label] of [
        ['learning', 'Learning'], ['uncertain', 'Limited evidence'], ['unknown', 'Unknown'],
        ['no_accounts', 'No accounts'], ['other', 'Unknown'], ['future-state', 'Unknown'], [null, 'Unknown'],
    ]) {
        const response = fixtures.nextResetWorkloads();
        response.rows[0].nextReset.guidanceState = guidanceState;
        const row = model.workloadHeadroomView(response, fixtures.NOW).rows[0];
        assert.equal(row.valueText, label);
        assert.equal(model.panelWorkloadLabel(row), guidanceState === 'learning' ? '…' : guidanceState === 'no_accounts' ? 'None' : '?');
        assert.equal(row.percent, null);
    }
});

test('valid family percentages retain their bound marker and overlap explanation', () => {
    for (const [guidanceState, outcomeKind, headroomDirection, label] of [
        ['increase', 'beyond_horizon', 'margin', '↑ ~25% room*'],
        ['reduce', 'runway', 'deficit', '↓ ~25% pace*'],
    ]) {
        const response = fixtures.nextResetWorkloads();
        const family = response.rows[2];
        family.unreadableAccounts = 0;
        Object.assign(family.nextReset, { guidanceState, outcomeKind, headroomDirection, projectionBasis: 'measured' });
        const row = build(response).paceRows[2];
        assert.equal(row.valueText, label);
        assert.match(row.detail, /conservative bound/);
        assert.match(row.detail, /overlaps Claude/);
    }
});

test('unknown intervals, malformed directions and weak evidence cannot produce numeric advice', () => {
    const invalid = [
        { intervalKind: 'future-interval' }, { intervalKind: null },
        { guidanceState: 'reduce' }, { outcomeKind: 'unknown' },
        { projectionBasis: 'structural' }, { projectionBasis: null },
        { headroomDirection: 'other' }, { headroomDirection: null },
        ...[null, '25', true, -1, 0, NaN, Infinity].map(headroomPct => ({ headroomPct })),
    ];
    for (const fields of invalid) {
        const response = fixtures.nextResetWorkloads();
        Object.assign(response.rows[0].nextReset, fields);
        const row = model.workloadHeadroomView(response, fixtures.NOW).rows[0];
        assert.equal(row.percent, null, JSON.stringify(fields));
        assert.equal(row.valueText, 'Unknown');
    }
    for (const headroomBasis of [null, 'other', 'future']) {
        const response = fixtures.nextResetWorkloads();
        response.rows[0].headroomBasis = headroomBasis;
        assert.equal(model.workloadHeadroomView(response, fixtures.NOW).rows[0].percent, null);
    }
});

test('legacy servers retain raw context without advisory percentages', () => {
    const response = fixtures.nextResetWorkloads();
    delete response.intervalKind;
    for (const row of response.rows) {
        delete row.guidanceState;
        delete row.nextReset.guidanceState;
        delete row.nextReset.intervalKind;
    }
    const view = build(response);
    for (const row of view.paceRows) {
        assert.equal(row.valueText, 'Unknown');
        assert.equal(row.percent, null);
        assert.equal(row.longTerm.percent, null);
        assert.match(row.summary, /Raw forecast \(legacy server\)/);
    }
});

test('absence reasons belong to their own interval and do not override guidance state', () => {
    const response = fixtures.nextResetWorkloads();
    const raw = response.rows[0];
    Object.assign(raw, { guidanceState: 'unquantified', headroomPct: null, headroomAbsence: 'bound_broken_by_credits' });
    Object.assign(raw.nextReset, { guidanceState: 'uncertain', headroomPct: null, headroomAbsence: 'learning_accounts' });
    const row = model.workloadHeadroomView(response, fixtures.NOW).rows[0];
    assert.equal(row.valueText, 'Limited evidence');
    assert.match(row.summary, /learning their burn/);
    assert.doesNotMatch(row.summary, /credits/);
    assert.match(row.longTerm.summary, /credits/);
    assert.doesNotMatch(row.longTerm.summary, /learning their burn/);
});

test('weak forecasts label exhaustion times as raw estimates in both intervals', () => {
    const response = examples('.family-bound');
    const row = model.workloadHeadroomView(response, Date.parse(response.generatedAt)).rows[1];
    for (const forecast of [row, row.longTerm]) {
        assert.match(forecast.summary, /Unverified exhaustion estimate:/);
        assert.doesNotMatch(forecast.summary, /Projected exhaustion:/);
    }
    const partial = examples('.partial-coverage');
    const incomplete = model.workloadHeadroomView(partial, Date.parse(partial.generatedAt)).rows[0];
    assert.match(incomplete.longTerm.summary, /Unverified exhaustion estimate/);
    const measured = examples('.probe-limit');
    const unquantified = model.workloadHeadroomView(measured, Date.parse(measured.generatedAt)).rows[0];
    assert.match(unquantified.longTerm.summary, /Projected exhaustion:/);
});


test('rejected numeric advice does not lend confidence to a raw exhaustion time', () => {
    const response = fixtures.nextResetWorkloads();
    const raw = response.rows[1];
    raw.headroomPct = null;
    const rejected = model.workloadHeadroomView(response, fixtures.NOW).rows[1].longTerm;
    assert.equal(rejected.valueText, 'Unknown');
    assert.match(rejected.summary, /Unverified exhaustion estimate:/);
    delete raw.guidanceState;
    const legacy = model.workloadHeadroomView(response, fixtures.NOW).rows[1].longTerm;
    assert.match(legacy.summary, /Unverified exhaustion estimate:/);
    assert.match(legacy.summary, /Raw forecast \(legacy server\)/);
});
