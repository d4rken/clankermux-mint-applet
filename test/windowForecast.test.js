'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../usageModel');
const f = require('./publicV1Fixtures');
const { NOW } = f;
const HOUR = 3600000;
const at = offset => new Date(NOW + offset).toISOString();
function account(forecast = {}) {
    return { measurementState: 'fresh', windows: [{ kind: 'seven_day', utilizationPct: 30,
        observedAt: at(-30000), resetsAt: at(48 * HOUR),
        forecast: { outcome: 'exhausts_before_reset', quality: 'supported', reason: null,
            exhaustsAt: at(2 * HOUR), reassessAt: null, ...forecast } }] };
}
const view = (a, now = NOW) => model.accountWindows(a, true, 80, now)[0];

test('new forecast outcomes use quality, not retired prediction fields', () => {
    assert.equal(view(account()).forecastText, 'out ~2h');
    assert.equal(view(account()).forecastQuality, 'supported');
    assert.equal(view(account({ quality: 'limited' })).forecastSeverity, 'warning');
    assert.match(view(account({ quality: 'limited' })).forecastDescription, /Limited evidence/);
    assert.equal(view(account({ outcome: 'exhausted', exhaustsAt: null })).forecastText, 'out');
    assert.equal(view(account({ outcome: 'lasts_until_reset', exhaustsAt: null })).willExhaust, false);
});

test('raw exhaustion at/after reset and invalid timestamps never warn', () => {
    for (const exhaustsAt of [at(48 * HOUR), at(49 * HOUR), null, 'invalid']) {
        const w=view(account({exhaustsAt})); assert.equal(w.willExhaust,null);assert.equal(w.forecastText,'—');
    }
});

test('unknown reason labels do not advance when reassessAt passes', () => {
    for(const [reason,text] of [['no_usage','no usage'],['unstarted','unstarted'],['short_history','learning']]) {
        const a=account({outcome:'unknown',quality:'unavailable',reason,reassessAt:at(-HOUR),exhaustsAt:null});
        if(reason==='unstarted')a.windows[0].resetsAt=null;
        assert.equal(view(a).forecastText,text);assert.equal(view(a).willExhaust,null);
    }
});

test('missing/unknown forecast shapes, qualities and reasons remain unavailable', () => {
    for(const forecast of [null,undefined,{}, {outcome:'future'}, {outcome:'unknown',reason:'future'},
        {outcome:'exhausts_before_reset',quality:'future',exhaustsAt:at(HOUR)},
        {outcome:'lasts_until_reset',quality:'supported',reason:'future'}]) {
        const a=account();a.windows[0].forecast=forecast;assert.equal(view(a).forecastText,'—');
    }
});

test('stale observations and elapsed resets suppress estimates without zeroing usage', () => {
    const a=account();a.measurementState='stale';assert.equal(view(a).forecastText,'—');
    a.measurementState='fresh';a.windows[0].observedAt=at(-180000);assert.equal(view(a).forecastText,'—');
    a.windows[0].observedAt=at(48*HOUR);assert.equal(view(a,NOW+48*HOUR).forecastText,'—');
    assert.equal(view(a,NOW+48*HOUR).percent,30);
});

test('server partial-learning example retains useful weekly evidence', () => {
    const p=f.example('accounts.partial-learning');
    const windows=model.accountWindows(p.accounts[0],true,80,Date.parse(p.generatedAt));
    assert.deepEqual(windows.map(w=>w.percent),[0,60]);
    assert.equal(windows[0].forecastText,'no usage');assert.equal(windows[0].willExhaust,null);
    assert.equal(windows[1].forecastQuality,'supported');assert.match(windows[1].forecastText,/^out ~1d/);
});
