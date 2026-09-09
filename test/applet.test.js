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
    class Actor {
        constructor(properties = {}) { Object.assign(this, properties); this.children = []; this.visible = true; }
        add_child(child) { this.children.push(child); }
        set_text(text) { this.text = text; }
        set_style_class_name(name) { this.style_class = name; }
        set_accessible_name(name) { this.accessible_name = name; }
    }
    class MenuItem {
        constructor() { this.actor = new Actor(); }
        addActor(child) { this.actor.add_child(child); }
    }
    const imports = {
        ui: { applet: { Applet: class {} }, popupMenu: { PopupBaseMenuItem: MenuItem } },
        gi: {
            Gio: { Cancellable: class { cancel() {} }, icon_new_for_string(path) { return path; } },
            St: { BoxLayout: Actor, Label: Actor, Icon: Actor, IconType: { SYMBOLIC: 1 } },
            Clutter: { ActorAlign: { CENTER: 1 } },
        },
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
    const { AppletClass, SummaryClass } = vm.runInNewContext(`${source}\n({ AppletClass: ClankermuxUsageApplet, SummaryClass: ForecastSummaryMenuItem })`, {
        imports,
        Date: class extends Date { static now() { return now; } },
    });
    const applet = Object.create(AppletClass.prototype);
    Object.assign(applet, {
        _model: model,
        _polling: { ensure() {}, stop() {} },
        _outlookSchedule: polling.createOutlookSchedule(),
        _accounts: fixtures.accounts(), _status: fixtures.status(),
        _workloads: fixtures.workloads(),
        _lastError: '', _lastWorkloadsError: '',
        _lastAccountsError: '',
        _requestGeneration: 0, _refreshing: false, _destroyed: false,
        requestTimeout: 8,
        _panelEmptyLabel: new Actor(), _panelWorkloadBox: new Actor(), _panelWorkloads: new Map(),
        set_applet_tooltip(text) { this.tooltip = text; },
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
        renderPanel() { AppletClass.prototype._renderPanel.call(applet); },
        createSummary() { return new SummaryClass(applet._view.paceRows, model, now, '/icons'); },
        advance(ms) { now += ms; },
        reply(path, data, error = null) {
            const callback = requests.get(path);
            assert.ok(callback, `No pending request for ${path}`);
            requests.delete(path);
            callback(error, data);
        },
        replyOutlook(workload = fixtures.workloads()) {
            this.reply('/public/v1/workloads', workload);
        },
    };
}

test('panel mode switches between actual usage and guidance while reusing icons', () => {
    const h = appletHarness();
    h.applet._accounts.forEach(account => { account.measurementState = 'fresh'; });
    h.applet._render();
    h.renderPanel();
    const meters = [...h.applet._panelWorkloads.values()];
    assert.deepEqual(meters.map(m => m._clankermuxValue.text), ['10%', '70%', '70%']);
    assert.match(h.applet.tooltip, /Weekly usage · equal account average/);
    h.applet.panelDisplay = 'forecast';
    h.renderPanel();
    assert.equal(h.applet._panelWorkloads.get('class:codex'), meters[0]);
    assert.equal(meters[0]._clankermuxValue.text, '↑ ~25% room');
    assert.match(h.applet.tooltip, /Until next weekly reset/);
    h.applet.panelDisplay = 'usage';
    h.applet.showScopedLimits = false;
    h.applet._render();
    h.renderPanel();
    assert.equal(meters[2].visible, false);
    assert.equal(meters[0]._clankermuxValue.text, '10%');
});

test('summary immediately withdraws stale or expired advice without rebuilding hovered bars', () => {
    for (const expired of [false, true]) {
        const h = appletHarness();
        if (expired) {
            h.applet._workloads.workloads[1].weekly.period.endsAt = new Date(fixtures.NOW + 1000).toISOString();
            h.applet._render();
        }
        const summary = h.createSummary();
        h.applet._forecastSummaryItem = summary;
        h.applet.menu.isOpen = true;
        h.applet._menuPointerInside = true;
        h.applet._menuSignature = h.applet._menuStateSignature();
        h.applet._renderMenu = () => { assert.fail('Hovered account bars must not be rebuilt'); };
        h.advance(expired ? 2000 : 180000);
        h.applet._render();
        assert.match(summary._lines.get('class:codex').label.text, expired ? /^GPT: Expired/ : /^GPT: Stale/);
        assert.match(summary.actor.accessible_name, expired ? /GPT: Expired/ : /GPT: Stale/);
        assert.equal(summary._lines.get('class:codex').available.text, expired ? '1' : 'stale');
        }
});

test('status failures do not mark fresh account usage cached, but account failures do', () => {
    const h = appletHarness();
    h.applet._outlookSchedule.begin(fixtures.NOW);
    h.applet._outlookSchedule.complete(fixtures.NOW, false);
    h.applet._refresh();
    h.reply('/public/v1/accounts', { schema: 'clankermux.public.accounts.v1', accounts: fixtures.accounts() });
    h.reply('/public/v1/status', null, new Error('status offline'));
    assert.equal(h.applet._lastAccountsError, '');
    assert.equal(h.applet._view.providerUsageRows[0].valueText, '10%');
    h.applet._refresh();
    h.reply('/public/v1/accounts', null, new Error('accounts offline'));
    h.reply('/public/v1/status', fixtures.status());
    assert.equal(h.applet._view.providerUsageRows[0].valueText, '10%*');
    const failure = h.applet._lastAccountsError;
    h.applet._refresh(true, true);
    h.replyOutlook();
    assert.equal(h.applet._lastAccountsError, failure);
});

test('a full refresh timeout marks retained account usage cached', () => {
    const h = appletHarness();
    h.applet._refresh();
    h.timers.get(h.applet._refreshWatchdogId)();
    assert.match(h.applet._lastAccountsError, /timed out/);
    assert.equal(h.applet._view.providerUsageRows[0].valueText, '10%*');
});

test('account popup signature follows new window forecasts', () => {
    const h = appletHarness();
    const before = h.applet._menuStateSignature();
    h.applet._accounts[0].windows[1].forecast = {
        outcome: 'exhausts_before_reset', quality: 'supported', reason: null,
        exhaustsAt: new Date(fixtures.NOW + 3600000).toISOString(), reassessAt: null,
    };
    h.applet._render();
    assert.notEqual(h.applet._menuStateSignature(), before);
    assert.equal(h.applet._view.accounts.find(a => a.id === 'account-a').windows[1].forecastText, 'out ~1h');
    const projected = h.applet._menuStateSignature();
    h.advance(60000);
    h.applet._render();
    assert.equal(h.applet._menuStateSignature(), projected);
    h.applet._accounts[0].windows[1].forecast.exhaustsAt = new Date(fixtures.NOW + 7200000).toISOString();
    h.applet._render();
    assert.notEqual(h.applet._menuStateSignature(), projected);
});

test('forecast-only refresh updates next-reset bars without touching accounts/status freshness', () => {
    const h = appletHarness();
    const oldAccounts = h.applet._accounts;
    h.applet._lastSuccess = fixtures.NOW - 30000;
    h.applet._refresh(false, true);
    assert.deepEqual([...h.requests.keys()], [
        '/public/v1/workloads',
    ]);
    h.replyOutlook();
    assert.equal(h.applet._accounts, oldAccounts);
    assert.equal(h.applet._lastSuccess, fixtures.NOW - 30000);
    assert.equal(h.applet._view.paceRows[0].panelText, '↑ ~25% room');
    assert.equal(h.applet._refreshing, false);
    assert.equal(h.timers.size, 0);
    h.applet._refresh(false, true);
    assert.equal(h.requests.size, 0);
});

test('failed workload fetch preserves the last snapshot but suppresses its advice', () => {
    const h = appletHarness();
    const oldWorkload = h.applet._workloads;
    h.applet._refresh(false, true);
    h.reply('/public/v1/workloads', null, new Error('offline'));
    assert.equal(h.applet._workloads, oldWorkload);
    assert.equal(h.applet._view.paceRows[1].stale, true);
    assert.equal(h.applet._view.paceRows[1].percent, null);
    assert.equal(h.applet._lastError, '');
    h.advance(19999);
    h.applet._refresh(false, true);
    assert.equal(h.requests.size, 0);
    h.advance(1);
    h.applet._refresh(false, true);
    assert.equal(h.requests.size, 1);
});

test('refresh watchdog marks cached forecast feeds stale and ignores late replies', () => {
    const h = appletHarness();
    const oldWorkload = h.applet._workloads;
    h.applet._refresh(false, true);
    const watchdog = h.timers.get(h.applet._refreshWatchdogId);
    h.advance(8000);
    watchdog();
    assert.equal(h.applet._refreshing, false);
    assert.equal(h.applet._view.paceRows[1].stale, true);
    assert.match(h.applet._lastWorkloadsError, /timed out/);
    h.replyOutlook();
    assert.equal(h.applet._workloads, oldWorkload);
    assert.equal(h.applet._view.paceRows[1].stale, true);
});

test('deadline crossing requests one forecast refresh even inside the usual polling interval', () => {
    const h = appletHarness();
    const response = fixtures.workloads();
    response.workloads[1].weekly.period.endsAt = new Date(fixtures.NOW + 1000).toISOString();
    h.applet._refresh(false, true);
    h.replyOutlook(response);
    h.advance(1000);
    h.applet._render();
    assert.equal(h.applet._view.paceRows[0].expired, true);
    h.applet._refresh(false, true);
    assert.equal(h.requests.size, 1);
    h.replyOutlook(response);
    h.advance(1000);
    h.applet._render();
    h.applet._refresh(false, true);
    assert.equal(h.requests.size, 0);
    assert.equal(h.applet._view.paceRows[0].expired, true);
});

test('forecast staleness does not rebuild the account popup while hovered', () => {
    const h = appletHarness();
    h.applet.menu.isOpen = true;
    h.applet._menuPointerInside = true;
    h.applet._menuSignature = h.applet._menuStateSignature();
    let rebuilt = false;
    h.applet._renderMenu = () => { rebuilt = true; };
    h.advance(180000);
    h.applet._render();
    assert.equal(rebuilt, false);
    assert.equal(h.applet._view.paceRows[1].stale, true);
});

test('guidance changes do not rebuild the account popup while hovered', () => {
    const h = appletHarness();
    h.applet.menu.isOpen = true;
    h.applet._menuPointerInside = true;
    h.applet._menuSignature = h.applet._menuStateSignature();
    let rebuilt = false;
    h.applet._renderMenu = () => { rebuilt = true; };
    const response = fixtures.workloads();
    response.workloads[1].weekly.quality = 'unavailable';
    h.applet._refresh(false, true);
    h.replyOutlook(response);
    assert.equal(h.applet._view.paceRows[0].valueText, 'Unavailable');
    assert.equal(rebuilt, false);
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


test('availability changes in place through polling while account bars are hovered', () => {
    const h = appletHarness();
    const summary = h.createSummary();
    h.applet._forecastSummaryItem = summary;
    h.applet.menu.isOpen = true;
    h.applet._menuPointerInside = true;
    h.applet._menuSignature = h.applet._menuStateSignature();
    h.applet._renderMenu = () => assert.fail('Hovered bars rebuilt');
    h.applet._refresh(false, true);
    const payload = fixtures.workloads();
    payload.workloads[1].availability.availableAccounts = 2;
    h.replyOutlook(payload);
    assert.equal(summary._lines.get('class:codex').available.text, '2');
    assert.match(summary.actor.accessible_name, /2 available now/);
});

test('receipt clocks handle client skew and repeated cached envelopes without renewing evidence', () => {
    const h = appletHarness();
    h.advance(90000);
    h.applet._refresh();
    h.reply('/public/v1/accounts', { schema: 'clankermux.public.accounts.v1', generatedAt: fixtures.NOW_ISO, accounts: fixtures.accounts() });
    h.advance(2000);
    h.reply('/public/v1/status', fixtures.status());
    const payload = fixtures.workloads();
    payload.generatedAt = fixtures.NOW_ISO;
    h.replyOutlook(payload);
    assert.equal(h.applet._view.nowMs, fixtures.NOW + 2000);
    assert.equal(h.applet._view.workloadsNowMs, fixtures.NOW);
    assert.equal(h.applet._view.paceRows[0].percent, 25);
    h.advance(180000);
    h.applet._refresh(true, true);
    h.replyOutlook(payload);
    assert.equal(h.applet._view.paceRows[0].panelText, 'Stale');
    assert.equal(h.applet._view.paceRows[0].availability.text, 'stale');
});

test('account errors withhold forecasts, preserve usage and defer hovered popup rebuilding', () => {
    const h = appletHarness();
    h.applet._refresh();
    h.reply('/public/v1/accounts', { schema: 'clankermux.public.accounts.v1', accounts: fixtures.accounts() });
    h.reply('/public/v1/status', null, new Error('status offline'));
    h.replyOutlook();
    assert.equal(h.applet._view.accounts[0].windows[1].forecastQuality, 'supported');
    h.applet.menu.isOpen = true;
    h.applet._menuPointerInside = true;
    h.applet._menuSignature = h.applet._menuStateSignature();
    h.applet._renderMenu = () => assert.fail('Hovered bars rebuilt');
    h.applet._refresh();
    h.reply('/public/v1/accounts', null, new Error('accounts offline'));
    h.reply('/public/v1/status', fixtures.status());
    const account = h.applet._view.accounts[0];
    assert.equal(account.windows[1].percent, 60);
    assert.equal(account.windows[1].forecastText, '—');
    assert.equal(account.measurementNotice, 'cached usage');
    assert.equal(h.applet._menuRebuildPending, true);
});
