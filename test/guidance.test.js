'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../usageModel');
const f = require('./publicV1Fixtures');
const view = payload => model.workloadsView(payload, f.NOW);
const claude = payload => view(payload).find(r => r.key === 'class:anthropic');

test('server examples render estimates, partial coverage, search limits and family exhaustion', () => {
    const expected = [ ['workloads', '↓ ~40% pace'], ['workloads.partial', 'Risk'],
        ['workloads.increase-limit', 'Room'], ['workloads.reduction-limit', 'Risk'] ];
    for (const [name, text] of expected) assert.equal(claude(f.example(name)).panelText, text);
    const family = view(f.example('workloads.family')).find(r => r.key === 'family:fable');
    assert.equal(family.valueText, 'Weekly exhausted');
    assert.equal(family.parentWorkloadId, 'class:anthropic');
    assert.equal(family.availability.availableAccounts, 0);
    assert.match(model.workloadTooltipLine(family), /overlaps Claude/);
});

test('joins stable IDs, never label or order; missing family is omitted', () => {
    const payload = f.workloads(); payload.workloads.reverse(); payload.workloads.forEach(w => {w.label = 'wrong';});
    assert.deepEqual(view(payload).map(r => r.key), ['class:codex','class:anthropic','family:fable']);
    assert.equal(view(f.example('workloads')).length, 2);
    assert.equal(model.workloadsView(payload, f.NOW, false, false).length, 2);
});

test('only estimate state renders signed percentages, including zero and family bound', () => {
    for (const state of ['unavailable','other','future','increase_limit','reduction_limit']) {
        const p=f.workloads(); p.workloads[1].weekly.pace.state=state;
        assert.equal(view(p)[0].percent, null);
        assert.doesNotMatch(view(p)[0].panelText, /%/);
    }
    for (const [changePct,text] of [[25,'↑ ~25% room'],[-20,'↓ ~20% pace'],[0,'~0% pace']]) {
        const p=f.workloads();p.workloads[1].weekly.pace.changePct=changePct;
        assert.equal(view(p)[0].panelText,text);
    }
    const p=f.workloads();p.workloads[1].weekly.pace.qualification='conservative_bound';
    assert.equal(view(p)[0].panelText, '↑ ~25% room*');
});

test('invalid numeric, quality, coverage or qualification withholds adjustment', () => {
    for (const mutation of [
        w=>{w.pace.changePct=null;},w=>{w.pace.changePct='25';},w=>{w.pace.changePct=Infinity;},
        w=>{w.pace.qualification='future';},w=>{w.quality='limited';},w=>{w.quality='future';},
        w=>{w.coverage.modeledAccounts=1;w.coverage.idleAccounts=1;},w=>{delete w.coverage.modeledAccounts;},
        w=>{w.outcome='future';},w=>{w.pace.reason='future';},
    ]) {const p=f.workloads();mutation(p.workloads[1].weekly);assert.equal(view(p)[0].percent,null);}
});

test('five-hour learning does not participate in weekly evidence or pace', () => {
    const accounts=f.example('accounts.partial-learning').accounts;
    const result=model.buildView(accounts,f.status(),f.workloads(),{},f.NOW);
    assert.equal(result.accounts[0].windows[0].forecastText,'no usage');
    assert.equal(result.paceRows[1].percent,-40);
});

test('coverage categories are disjoint and partial exhaustion is qualified', () => {
    const p=f.example('workloads.partial'); const row=claude(p);
    assert.match(model.forecastSummary(row,f.NOW), /Subset risk.*1\/2 modeled · 1 idle/);
    assert.equal(row.percent,null);
    p.workloads[0].weekly.outcome='exhausted';
    assert.equal(claude(p).valueText,'Subset exhausted');
    p.workloads[0].weekly.coverage.learningAccounts=1;
    assert.equal(claude(p).valueText,'Unavailable');
});

test('weekly freshness uses computedAt AND evidence, availability has its own clock', () => {
    for (const field of ['computedAt','evidenceObservedAt']) {
        for (const time of [null,new Date(f.NOW-180000).toISOString()]) {
            const p=f.workloads();p.generatedAt=f.NOW_ISO;p.workloads[1].weekly[field]=time;
            const r=view(p)[0];assert.equal(r.panelText,'Stale');assert.equal(r.percent,null);
            assert.equal(r.availability.availableAccounts,1);
        }
    }
    const p=f.workloads();p.workloads[1].availability.computedAt=new Date(f.NOW-180000).toISOString();
    assert.equal(view(p)[0].availability.text,'stale');assert.equal(view(p)[0].percent,25);
});

test('expired/missing/unknown periods withhold advice and never imply recovery', () => {
    for (const period of [null,{}, {startsAt:f.NOW_ISO,endsAt:'bad',endReason:'next_weekly_reset'},
        {startsAt:new Date(f.NOW-60000).toISOString(),endsAt:f.NOW_ISO,endReason:'next_weekly_reset'},
        {startsAt:f.NOW_ISO,endsAt:new Date(f.NOW+60000).toISOString(),endReason:'future'}]) {
        const p=f.workloads();p.workloads[1].weekly.period=period;assert.equal(view(p)[0].percent,null);
    }
    const p=f.workloads();p.workloads[1].weekly.period.endsAt=f.NOW_ISO;
    assert.equal(view(p)[0].valueText,'Expired');assert.equal(view(p)[0].availability.availableAccounts,1);
});

test('availability handles missing/unknown and paid fallback independently from exhausted weekly quota', () => {
    const p=f.workloads();const raw=p.workloads[1];raw.weekly.outcome='exhausted';raw.weekly.pace.state='unavailable';
    assert.equal(view(p)[0].panelText,'Out');assert.equal(view(p)[0].availability.text,'1');
    raw.availability.unknownAccounts=2;assert.equal(view(p)[0].availability.text,'1 + ?');
    delete raw.availability.availableAccounts;assert.equal(view(p)[0].availability.text,'unavailable');
    assert.equal(view(p)[0].panelText,'Out');
});

test('fetch failure invalidates cached advice without zeroing either capacity', () => {
    const rows=model.workloadsView(f.workloads(),f.NOW,true);
    assert.equal(rows[0].panelText,'Stale');assert.equal(rows[0].availability.text,'stale');
    assert.equal(rows[0].availability.availableAccounts,undefined);
});

test('no accounts and no subscription quota remain distinct without a deadline', () => {
    for(const [outcome,text] of [['no_accounts','No active accounts'],['not_applicable','No weekly quota']]) {
        const p=f.workloads();const w=p.workloads[1].weekly;w.outcome=outcome;w.period=null;
        w.coverage={eligibleAccounts:0,modeledAccounts:0,idleAccounts:0,learningAccounts:0,unavailableAccounts:0};w.evidenceObservedAt=null;
        assert.equal(view(p)[0].valueText,text);assert.equal(view(p)[0].percent,null);
    }
});


test('search-limit states never overwrite a contradictory weekly outcome', () => {
    const p = f.workloads();
    const w = p.workloads[1].weekly;
    w.pace.state = 'reduction_limit';
    assert.equal(view(p)[0].valueText, 'Reaches reset');
    assert.equal(view(p)[0].panelText, 'Holds');
    w.outcome = 'exhausts_before_end';
    w.exhaustsAt = new Date(f.NOW + 3600000).toISOString();
    w.pace.state = 'increase_limit';
    assert.equal(view(p)[0].valueText, 'Weekly risk');
    assert.equal(view(p)[0].panelText, 'Risk');
    assert.doesNotMatch(model.workloadTooltipLine(view(p)[0]), /Tested/);
    w.pace.state = 'reduction_limit';
    assert.match(model.workloadTooltipLine(view(p)[0]), /Tested cut insufficient/);
});

test('limited weekly evidence is qualified in the summary without adding panel text', () => {
    const p = f.workloads();
    p.workloads[1].weekly.quality = 'limited';
    const row = view(p)[0];
    assert.equal(row.percent, null);
    assert.equal(row.panelText, 'Holds');
    assert.match(model.forecastSummary(row, f.NOW), /Reaches reset · limited · 2\/2 modeled/);
    const stale = model.workloadsView(p, f.NOW + 180000)[0];
    assert.doesNotMatch(model.forecastSummary(stale, f.NOW + 180000), /limited/);
});

test('resource clocks are independent and stale evidence survives a new envelope', () => {
    for (const skew of [-90000, 90000]) {
        const opts = { accountsGeneratedAt: f.NOW_ISO, accountsReceivedAt: f.NOW + skew,
            workloadsGeneratedAt: f.NOW_ISO, workloadsReceivedAt: f.NOW + skew };
        let result = model.buildView(f.accounts(), f.status(), f.workloads(), opts, f.NOW + skew);
        assert.equal(result.nowMs, f.NOW);
        assert.equal(result.paceRows[0].percent, 25);
        assert.equal(result.accounts[0].windows[1].forecastQuality, 'supported');
        opts.workloadsGeneratedAt = new Date(f.NOW + 180000).toISOString();
        result = model.buildView(f.accounts(), f.status(), f.workloads(), opts, f.NOW + skew);
        assert.equal(result.nowMs, f.NOW);
        assert.equal(result.workloadsNowMs, f.NOW + 180000);
        assert.equal(result.paceRows[0].panelText, 'Stale');
        assert.equal(result.providerUsageRows[0].stale, false);
        const p = f.workloads();
        p.workloads[1].weekly.period.endsAt = new Date(f.NOW + 1000).toISOString();
        opts.workloadsGeneratedAt = f.NOW_ISO;
        result = model.buildView(f.accounts(), f.status(), p, opts, f.NOW + skew + 2000);
        assert.equal(result.paceRows[0].valueText, 'Expired');
        assert.equal(result.paceRows[0].availability.text, '1');
    }
});
