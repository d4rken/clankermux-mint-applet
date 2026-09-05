'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const model = require('../usageModel');
const polling = require('../pollingController');
const fixtures = require('./publicV1Fixtures');
const source = fs.readFileSync(require.resolve('../applet.js'), 'utf8');

function appletHarness() {
    let now = fixtures.NOW;
    let nextTimer = 1;
    const timers = new Map();
    const requests = new Map();
    const imports = {
        ui: { applet: { Applet: class {} }, popupMenu: { PopupBaseMenuItem: class {} } },
        gi: { Gio: { Cancellable: class { cancel() {} } } },
        misc: {},
        mainloop: {
            timeout_add_seconds(seconds, callback) {
                const id = nextTimer++;
                timers.set(id, callback);
                return id;
            },
            source_remove(id) { timers.delete(id); },
        },
    };
    const AppletClass = vm.runInNewContext(`${source}\nClankermuxUsageApplet`, {
        imports,
        Date: class extends Date { static now() { return now; } },
    });
    const applet = Object.create(AppletClass.prototype);
    Object.assign(applet, {
        _model: model,
        _polling: { ensure() {}, stop() {} },
        _outlookSchedule: polling.createOutlookSchedule(),
        _accounts: fixtures.accounts(), _status: fixtures.status(),
        _runway: fixtures.runway(), _pacing: fixtures.pacing(),
        _workloadHeadroom: fixtures.nextResetWorkloads(),
        _lastError: '', _lastRunwayError: '', _lastPacingError: '', _lastWorkloadHeadroomError: '',
        _requestGeneration: 0, _refreshing: false, _destroyed: false,
        requestTimeout: 8,
        menu: { isOpen: false },
        _getJson(path, generation, cancellable, callback) { requests.set(path, callback); },
        _createSession() {},
        _renderPanel() {},
    });
    // Pass the test clock to the real model, as well as to the applet's timers.
    applet._model = {
        ...model,
        buildView(...args) { return model.buildView(...args, now); },
    };
    applet._render();
    return {
        applet, requests, timers,
        advance(ms) { now += ms; },
        reply(path, data, error = null) {
            const callback = requests.get(path);
            assert.ok(callback, `No pending request for ${path}`);
            requests.delete(path);
            callback(error, data);
        },
        replyOutlook(workload = fixtures.nextResetWorkloads()) {
            this.reply('/public/v1/runway', fixtures.runway());
            this.reply('/public/v1/pacing', fixtures.pacing());
            this.reply('/public/v1/workload-headroom', workload);
        },
    };
}

test('forecast-only refresh updates next-reset bars without touching accounts/status freshness', () => {
    const h = appletHarness();
    const oldAccounts = h.applet._accounts;
    h.applet._lastSuccess = fixtures.NOW - 30000;
    h.applet._refresh(false, true);
    assert.deepEqual([...h.requests.keys()], [
        '/public/v1/runway', '/public/v1/pacing', '/public/v1/workload-headroom',
    ]);
    h.replyOutlook();
    assert.equal(h.applet._accounts, oldAccounts);
    assert.equal(h.applet._lastSuccess, fixtures.NOW - 30000);
    assert.equal(h.applet._view.workloads[1].valueText, '+25%');
    assert.equal(h.applet._view.workloads[1].longTerm.valueText, '−40%');
    assert.equal(h.applet._refreshing, false);
    assert.equal(h.timers.size, 0);
    h.applet._refresh(false, true);
    assert.equal(h.requests.size, 0);
});

test('failed workload fetch preserves the last snapshot but suppresses its advice', () => {
    const h = appletHarness();
    const oldWorkload = h.applet._workloadHeadroom;
    h.applet._refresh(false, true);
    h.reply('/public/v1/runway', fixtures.runway());
    h.reply('/public/v1/pacing', fixtures.pacing());
    h.reply('/public/v1/workload-headroom', null, new Error('offline'));
    assert.equal(h.applet._workloadHeadroom, oldWorkload);
    assert.equal(h.applet._view.workloads[1].stale, true);
    assert.equal(h.applet._view.workloads[1].percent, null);
    assert.match(h.applet._view.workloads[1].summary, /Last reading: \+25%/);
    assert.equal(h.applet._view.pacing.stale, false);
    assert.equal(h.applet._lastError, '');
    h.advance(60000);
    h.applet._refresh(false, true);
    assert.equal(h.requests.size, 0);
    h.advance(60000);
    h.applet._refresh(false, true);
    assert.equal(h.requests.size, 3);
});

test('refresh watchdog marks cached forecast feeds stale and ignores late replies', () => {
    const h = appletHarness();
    const oldWorkload = h.applet._workloadHeadroom;
    h.applet._refresh(false, true);
    const watchdog = h.timers.get(h.applet._refreshWatchdogId);
    h.advance(8000);
    watchdog();
    assert.equal(h.applet._refreshing, false);
    assert.equal(h.applet._view.workloads[1].stale, true);
    assert.equal(h.applet._view.pace.stale, true);
    assert.equal(h.applet._view.pacing.stale, true);
    assert.match(h.applet._lastWorkloadHeadroomError, /timed out/);
    h.replyOutlook();
    assert.equal(h.applet._workloadHeadroom, oldWorkload);
    assert.equal(h.applet._view.workloads[1].stale, true);
});

test('deadline crossing requests one forecast refresh even inside the usual minute interval', () => {
    const h = appletHarness();
    const response = fixtures.nextResetWorkloads();
    response.rows[1].nextReset.resetsAt = new Date(fixtures.NOW + 10000).toISOString();
    h.applet._refresh(false, true);
    h.replyOutlook(response);
    h.advance(10000);
    h.applet._render();
    assert.equal(h.applet._view.workloads[1].expired, true);
    h.applet._refresh(false, true);
    assert.equal(h.requests.size, 3);
    h.replyOutlook(response);
    h.advance(1000);
    h.applet._render();
    h.applet._refresh(false, true);
    assert.equal(h.requests.size, 0);
    assert.equal(h.applet._view.workloads[1].expired, true);
});

test('a pacing deadline crossing alone requests one forecast refresh', () => {
    const h = appletHarness();
    const pacing = fixtures.pacing();
    pacing.classes[1].resetsAt = new Date(fixtures.NOW + 10000).toISOString();
    h.applet._refresh(false, true);
    h.reply('/public/v1/runway', fixtures.runway());
    h.reply('/public/v1/pacing', pacing);
    h.reply('/public/v1/workload-headroom', fixtures.nextResetWorkloads());
    h.advance(10000);
    h.applet._render();
    assert.equal(h.applet._view.pacing.classes[1].expired, true);
    assert.equal(h.applet._view.workloads.some(row => row.expired), false);
    h.applet._refresh(false, true);
    assert.equal(h.requests.size, 3);
});

test('stale transitions update an open popup even while the pointer is inside', () => {
    const h = appletHarness();
    h.applet.menu.isOpen = true;
    h.applet._menuPointerInside = true;
    h.applet._menuSignature = h.applet._menuStateSignature();
    let rebuilt = false;
    h.applet._renderMenu = () => { rebuilt = true; };
    h.advance(180000);
    h.applet._render();
    assert.equal(rebuilt, true);
    assert.equal(h.applet._view.workloads[1].stale, true);
});

test('a pacing deadline crossing with fresh headroom updates an open popup while the pointer is inside', () => {
    const h = appletHarness();
    const pacing = fixtures.pacing();
    pacing.classes[0].resetsAt = new Date(fixtures.NOW + 10000).toISOString();
    h.applet._refresh(false, true);
    h.reply('/public/v1/runway', fixtures.runway());
    h.reply('/public/v1/pacing', pacing);
    h.reply('/public/v1/workload-headroom', fixtures.nextResetWorkloads());
    assert.equal(h.applet._view.paceRows[0].source, 'pacing');
    h.applet.menu.isOpen = true;
    h.applet._menuPointerInside = true;
    h.applet._menuSignature = h.applet._menuStateSignature();
    let rebuilt = false;
    h.applet._renderMenu = () => { rebuilt = true; };
    h.advance(10000);
    h.applet._render();
    assert.equal(h.applet._view.paceRows[0].source, 'headroom');
    assert.equal(h.applet._view.pacing.classes[0].expired, true);
    assert.equal(rebuilt, true);
});

test('ordinary account polling stays available during forecast backoff', () => {
    const h = appletHarness();
    h.applet._outlookSchedule.begin(fixtures.NOW);
    h.applet._outlookSchedule.complete(fixtures.NOW, true);
    h.applet._refresh();
    assert.deepEqual([...h.requests.keys()], ['/public/v1/accounts', '/public/v1/status']);
    h.reply('/public/v1/accounts', { schema: 'clankermux.public.accounts.v1', accounts: fixtures.accounts() });
    h.reply('/public/v1/status', fixtures.status());
    assert.equal(h.applet._lastSuccess, fixtures.NOW);
    assert.equal(h.applet._refreshing, false);
});

test('removing the applet cleans up its independent forecast clock', () => {
    const h = appletHarness();
    h.applet._forecastClockId = 987;
    h.timers.set(987, () => {});
    h.applet.on_applet_removed_from_panel();
    assert.equal(h.timers.has(987), false);
    assert.equal(h.applet._forecastClockId, 0);
    assert.equal(h.applet._destroyed, true);
});
