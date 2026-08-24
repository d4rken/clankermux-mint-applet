const Applet = imports.ui.applet;
const ByteArray = imports.byteArray;
const Clutter = imports.gi.Clutter;
const FileUtils = imports.misc.fileUtils;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Mainloop = imports.mainloop;
const PopupMenu = imports.ui.popupMenu;
const Settings = imports.ui.settings;
const Soup = imports.gi.Soup;
const St = imports.gi.St;

const UUID = 'clankermux-usage@d4rken';
const PROGRESS_WIDTH = 116;
const RUNWAY_REFRESH_MS = 5 * 60 * 1000;

function createProgressTrack(percent, severity, width, styleClass = 'clankermux-progress-track') {
    const track = new St.Bin({
        style_class: styleClass,
        width,
        y_align: St.Align.MIDDLE,
    });
    track.set_fill(false, false);
    track.set_alignment(St.Align.START, St.Align.MIDDLE);
    const fillWidth = percent <= 0 ? 0 : Math.max(2, Math.round(width * percent / 100));
    const fill = new St.Widget({
        style_class: `clankermux-progress-fill ${severity}`,
        width: fillWidth,
        height: styleClass === 'clankermux-panel-progress-track' ? 8 : 7,
    });
    track.set_child(fill);
    track._clankermuxFill = fill;
    return track;
}

function updateProgressTrack(track, percent, severity, width) {
    const fillWidth = percent <= 0 ? 0 : Math.max(2, Math.round(width * percent / 100));
    track.set_width(width);
    track._clankermuxFill.set_width(fillWidth);
    track._clankermuxFill.set_style_class_name(`clankermux-progress-fill ${severity}`);
}

class InfoMenuItem extends PopupMenu.PopupBaseMenuItem {
    constructor(title, subtitle = '', styleClass = '') {
        super({ reactive: false });
        const box = new St.BoxLayout({ vertical: true, style_class: `clankermux-info ${styleClass}` });
        box.add_child(new St.Label({ text: title, style_class: 'clankermux-info-title' }));
        if (subtitle)
            box.add_child(new St.Label({ text: subtitle, style_class: 'clankermux-info-subtitle' }));
        this.addActor(box, { expand: true });
    }
}

function createUsageBar(window, model, nowMs) {
    const row = new St.BoxLayout({ vertical: false, style_class: 'clankermux-usage-row' });

    const label = new St.Label({
        text: window.label,
        style_class: window.scoped ? 'clankermux-limit-label scoped' : 'clankermux-limit-label',
        y_align: Clutter.ActorAlign.CENTER,
    });
    row.add_child(label);

    row.add_child(createProgressTrack(window.percent, window.severity, PROGRESS_WIDTH));

    row.add_child(new St.Label({
        text: `${window.percent}%`,
        style_class: 'clankermux-percent',
        y_align: Clutter.ActorAlign.CENTER,
    }));
    row.add_child(new St.Label({
        text: window.projectedAtReset === null ? '' : `→${Math.round(window.projectedAtReset)}%`,
        style_class: `clankermux-forecast ${window.severity}`,
        y_align: Clutter.ActorAlign.CENTER,
    }));
    row.add_child(new St.Label({
        text: model.formatReset(window.resetsAt, nowMs),
        style_class: 'clankermux-reset',
        y_align: Clutter.ActorAlign.CENTER,
    }));
    return row;
}

function createPanelMeter(pool, width, showPercentages) {
    const meter = new St.BoxLayout({ style_class: 'clankermux-panel-meter' });
    meter._clankermuxLabel = new St.Label({
        style_class: 'clankermux-panel-meter-label',
        y_align: Clutter.ActorAlign.CENTER,
    });
    meter.add_child(meter._clankermuxLabel);
    meter._clankermuxTrack = createProgressTrack(
        pool.usedPercent,
        pool.severity,
        width,
        'clankermux-panel-progress-track'
    );
    meter.add_child(meter._clankermuxTrack);
    meter._clankermuxPercent = new St.Label({ y_align: Clutter.ActorAlign.CENTER });
    meter.add_child(meter._clankermuxPercent);
    updatePanelMeter(meter, pool, width, showPercentages);
    return meter;
}

function updatePanelMeter(meter, pool, width, showPercentages) {
    meter._clankermuxLabel.set_text(pool.label);
    updateProgressTrack(meter._clankermuxTrack, pool.usedPercent, pool.severity, width);
    meter._clankermuxPercent.set_text(`${pool.usedPercent}%`);
    meter._clankermuxPercent.set_style_class_name(`clankermux-panel-percent ${pool.severity}`);
    meter._clankermuxPercent.visible = showPercentages;
}

class PoolSummaryMenuItem extends PopupMenu.PopupBaseMenuItem {
    constructor(pools, model, nowMs) {
        super({ reactive: false });
        const outer = new St.BoxLayout({ vertical: true, style_class: 'clankermux-pools' });
        outer.add_child(new St.Label({ text: 'Pool usage', style_class: 'clankermux-account-name' }));
        outer.add_child(new St.Label({
            text: 'Server-reported mean across accounts that supplied each quota window',
            style_class: 'clankermux-info-subtitle',
        }));

        for (const pool of pools) {
            const row = new St.BoxLayout({ style_class: 'clankermux-pool-row' });
            row.add_child(new St.Label({
                text: pool.label,
                style_class: 'clankermux-pool-label',
                y_align: Clutter.ActorAlign.CENTER,
            }));
            row.add_child(createProgressTrack(pool.usedPercent, pool.severity, 170));
            row.add_child(new St.Label({
                text: `${pool.usedPercent}%`,
                style_class: 'clankermux-percent',
                y_align: Clutter.ActorAlign.CENTER,
            }));
            const unknown = pool.unknownCount ? ` · ${pool.unknownCount} unknown` : '';
            const nextReset = model.formatReset(pool.nextResetAt, nowMs) || '–';
            row.add_child(new St.Label({
                text: `${pool.accountCount} acct${pool.accountCount === 1 ? '' : 's'}${unknown} · next ${nextReset}`,
                style_class: 'clankermux-reset pooled',
                y_align: Clutter.ActorAlign.CENTER,
            }));
            outer.add_child(row);
        }
        this.addActor(outer, { expand: true });
    }
}

class AccountMenuItem extends PopupMenu.PopupBaseMenuItem {
    constructor(account, model, nowMs) {
        super({ reactive: false });
        const outer = new St.BoxLayout({ vertical: true, style_class: 'clankermux-account' });

        const heading = new St.BoxLayout({ vertical: false, style_class: 'clankermux-account-heading' });
        heading.add_child(new St.Label({
            text: account.name,
            style_class: 'clankermux-account-name',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        if (account.defaultCandidate) {
            heading.add_child(new St.Label({
                text: 'DEFAULT',
                style_class: 'clankermux-primary-badge',
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }
        heading.add_child(new St.Label({
            text: account.provider,
            style_class: 'clankermux-provider',
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        outer.add_child(heading);

        const stateParts = [account.state.label];
        if (account.state.until)
            stateParts.push(`retry ${model.formatReset(account.state.until, nowMs)}`);
        if (account.credential)
            stateParts.push(account.credential.label);
        if (account.measurementNotice)
            stateParts.push(account.measurementNotice);
        outer.add_child(new St.Label({
            text: stateParts.join(' · '),
            style_class: `clankermux-state ${account.stateClass}`,
        }));

        if (account.windows.length) {
            for (const window of account.windows)
                outer.add_child(createUsageBar(window, model, nowMs));
        } else {
            outer.add_child(new St.Label({
                text: 'Usage data not available yet',
                style_class: 'clankermux-no-usage',
            }));
        }
        this.addActor(outer, { expand: true });
    }
}

class ClankermuxUsageApplet extends Applet.Applet {
    constructor(metadata, orientation, panelHeight, instanceId, model, polling) {
        super(orientation, panelHeight, instanceId);
        this._metadata = metadata;
        this._model = model;
        this._destroyed = false;
        this._pollId = 0;
        this._pollWatchdogId = 0;
        this._refreshWatchdogId = 0;
        this._refreshCancellable = null;
        this._requestGeneration = 0;
        this._refreshing = false;
        this._accounts = null;
        this._status = null;
        this._runway = null;
        this._statusReceivedAt = 0;
        this._runwayReceivedAt = 0;
        this._lastRunwayAttempt = 0;
        this._lastRunwayError = '';
        this._view = null;
        this._lastSuccess = 0;
        this._lastError = '';
        this._menuSignature = '';
        this._menuPointerInside = false;
        this._menuRebuildPending = false;

        this._polling = polling.create({
            addTimeoutSeconds: (seconds, callback) => Mainloop.timeout_add_seconds(seconds, callback),
            removeSource: id => Mainloop.source_remove(id),
            sourceExists: id => this._sourceExists(id),
            intervalSeconds: () => Math.max(10, Number(this.refreshInterval || 30)),
            watchdogIntervalSeconds: () => {
                const interval = Math.max(10, Number(this.refreshInterval || 30));
                return Math.min(30, interval);
            },
            poll: () => this._refresh(),
            onError: error => this._onPollingError(error),
            onSourcesChanged: sources => {
                this._pollId = sources.pollId;
                this._pollWatchdogId = sources.watchdogId;
            },
        });

        this.setAllowedLayout(Applet.AllowedLayout.HORIZONTAL);
        this._panelContent = new St.BoxLayout({ style_class: 'clankermux-panel-content' });
        this._panelRunwayLabel = new St.Label({
            text: 'Clankermux …',
            style_class: 'clankermux-panel-loading',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._panelEmptyLabel = new St.Label({
            text: 'quota –',
            style_class: 'clankermux-panel-loading',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._panelEmptyLabel.visible = false;
        this._panelMeters = new Map();
        this._panelContent.add_child(this._panelRunwayLabel);
        this._panelContent.add_child(this._panelEmptyLabel);
        this.actor.add(this._panelContent, { y_align: St.Align.MIDDLE, y_fill: false });
        this.set_applet_tooltip('Loading Clankermux usage…');

        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager.addMenu(this.menu);
        this.menu.actor.connect('enter-event', () => {
            this._menuPointerInside = true;
            return false;
        });
        this.menu.actor.connect('leave-event', () => {
            this._menuPointerInside = false;
            if (this._menuRebuildPending && this.menu.isOpen) {
                this._menuRebuildPending = false;
                this._renderMenu();
            }
            return false;
        });
        this.menu.connect('open-state-changed', (menu, open) => {
            if (!open) {
                this._menuPointerInside = false;
                this._menuRebuildPending = false;
                return;
            }
            this._polling.ensure();
            this._renderMenu();
        });

        this.settings = new Settings.AppletSettings(this, UUID, instanceId);
        this.settings.bind('api-url', 'apiUrl', this._onConnectionSettingsChanged.bind(this));
        this.settings.bind('refresh-interval', 'refreshInterval', this._onPollingSettingsChanged.bind(this));
        this.settings.bind('request-timeout', 'requestTimeout', this._onConnectionSettingsChanged.bind(this));
        this.settings.bind('runway-warning-hours', 'runwayWarningHours', this._render.bind(this));
        this.settings.bind('panel-bar-width', 'panelBarWidth', this._render.bind(this));
        this.settings.bind('show-panel-percentages', 'showPanelPercentages', this._render.bind(this));
        this.settings.bind('show-scoped-limits', 'showScopedLimits', this._render.bind(this));
        this.settings.bind('default-candidate-first', 'defaultCandidateFirst', this._render.bind(this));

        this._createSession();
        this._schedulePolling();
        this._render();
        this._refresh(true);
    }

    _createSession() {
        if (this._session)
            this._session.abort();
        this._session = new Soup.Session();
        this._session.timeout = Number(this.requestTimeout || 8);
        this._session.user_agent = `${UUID}/1.5`;
    }

    _onConnectionSettingsChanged() {
        if (!this.settings)
            return;
        this._requestGeneration++;
        this._cancelActiveRefresh();
        this._refreshing = false;
        this._accounts = null;
        this._status = null;
        this._runway = null;
        this._statusReceivedAt = 0;
        this._runwayReceivedAt = 0;
        this._lastRunwayAttempt = 0;
        this._lastRunwayError = '';
        this._lastSuccess = 0;
        this._lastError = '';
        this._createSession();
        this._render();
        this._refresh(true);
    }

    _onPollingSettingsChanged() {
        if (!this.settings)
            return;
        this._schedulePolling();
    }

    _schedulePolling() {
        this._polling.restart();
    }

    _sourceExists(id) {
        const context = GLib.MainContext.default();
        if (!context || typeof context.find_source_by_id !== 'function')
            return true;
        return Boolean(context.find_source_by_id(id));
    }

    _onPollingError(error) {
        global.logError(error, `${UUID}: scheduled refresh failed; polling will continue`);
    }

    _cancelActiveRefresh() {
        if (this._refreshWatchdogId) {
            Mainloop.source_remove(this._refreshWatchdogId);
            this._refreshWatchdogId = 0;
        }
        if (this._refreshCancellable) {
            this._refreshCancellable.cancel();
            this._refreshCancellable = null;
        }
    }

    _getJson(path, generation, cancellable, callback) {
        const baseUrl = this._model.normalizeBaseUrl(this.apiUrl);
        if (!baseUrl) {
            callback(new Error('Server URL is empty'), null, 0);
            return;
        }

        let message;
        try {
            message = Soup.Message.new('GET', `${baseUrl}${path}`);
            if (!message)
                throw new Error('Invalid server URL');
            message.get_request_headers().append('Accept', 'application/json');
        } catch (error) {
            callback(error, null, 0);
            return;
        }

        try {
            this._session.send_and_read_async(
                message,
                Soup.MessagePriority.NORMAL,
                cancellable,
                (session, result) => {
                    if (this._destroyed || generation !== this._requestGeneration)
                        return;
                    let data = null;
                    let error = null;
                    let status = 0;
                    try {
                        status = message.get_status();
                        const bytes = session.send_and_read_finish(result);
                        const body = ByteArray.toString(bytes.get_data());
                        data = JSON.parse(body);
                        if (status < 200 || status >= 300)
                            error = new Error(`HTTP ${status}: ${message.get_reason_phrase()}`);
                    } catch (caught) {
                        error = caught;
                    }
                    callback(error, data, status);
                }
            );
        } catch (error) {
            callback(error, null, 0);
        }
    }

    _refresh(forceRunway = false) {
        if (this._refreshing || this._destroyed)
            return;
        this._refreshing = true;
        const generation = ++this._requestGeneration;
        const fetchRunway = forceRunway || !this._lastRunwayAttempt ||
            Date.now() - this._lastRunwayAttempt >= RUNWAY_REFRESH_MS;
        const cycle = this._model.createRefreshCycle(fetchRunway ? 3 : 2);
        const timeoutSeconds = Math.max(2, Number(this.requestTimeout || 8));
        const cancellable = new Gio.Cancellable();
        this._refreshCancellable = cancellable;
        let accountsResult = null;
        let statusResult = null;
        let runwayResult = null;
        let accountsError = null;
        let statusError = null;
        let runwayError = null;
        let statusReceivedAt = 0;
        let runwayReceivedAt = 0;

        const validate = (data, schema, label, shape) => {
            if (!data || typeof data !== 'object')
                return new Error(`Unexpected ${label} response`);
            if (data.schema !== schema)
                return new Error(`Unsupported ${label} schema: ${data.schema || 'missing'}`);
            if (!shape(data))
                return new Error(`Unexpected ${label} response`);
            return null;
        };

        const complete = () => {
            if (!cycle.completeOne() || this._destroyed || generation !== this._requestGeneration)
                return;
            if (this._refreshWatchdogId) {
                Mainloop.source_remove(this._refreshWatchdogId);
                this._refreshWatchdogId = 0;
            }
            this._refreshCancellable = null;
            this._refreshing = false;

            accountsError = accountsError || validate(
                accountsResult,
                'clankermux.public.accounts.v1',
                'accounts',
                data => Array.isArray(data.accounts)
            );
            statusError = statusError || validate(
                statusResult,
                'clankermux.public.status.v1',
                'status',
                data => Boolean(data.pool)
            );
            if (fetchRunway) {
                runwayError = runwayError || validate(
                    runwayResult,
                    'clankermux.public.runway.v1',
                    'runway',
                    data => Boolean(data.coverage)
                );
            }

            if (!accountsError)
                this._accounts = accountsResult.accounts;
            if (!statusError) {
                this._status = statusResult;
                this._statusReceivedAt = statusReceivedAt || Date.now();
            }
            if (fetchRunway) {
                if (!runwayError) {
                    this._runway = runwayResult;
                    this._runwayReceivedAt = runwayReceivedAt || Date.now();
                    this._lastRunwayError = '';
                } else {
                    this._lastRunwayError = this._errorMessage(runwayError);
                }
            }

            if (!accountsError && !statusError) {
                this._lastSuccess = Date.now();
                this._lastError = '';
            } else {
                const failures = [accountsError, statusError]
                    .filter(Boolean)
                    .map(error => this._errorMessage(error));
                this._lastError = failures.join(' · ');
            }
            this._render();
        };

        this._refreshWatchdogId = Mainloop.timeout_add_seconds(timeoutSeconds, () => {
            this._refreshWatchdogId = 0;
            if (this._destroyed || generation !== this._requestGeneration || !cycle.expire())
                return false;

            this._requestGeneration++;
            this._refreshing = false;
            this._refreshCancellable = null;
            cancellable.cancel();
            this._lastError = `Refresh timed out after ${timeoutSeconds}s`;
            this._createSession();
            this._render();
            return false;
        });

        this._getJson('/public/v1/accounts', generation, cancellable, (error, data) => {
            accountsError = error;
            accountsResult = data;
            complete();
        });
        this._getJson('/public/v1/status', generation, cancellable, (error, data) => {
            statusError = error;
            statusResult = data;
            statusReceivedAt = Date.now();
            complete();
        });
        if (fetchRunway) {
            this._lastRunwayAttempt = Date.now();
            this._getJson('/public/v1/runway', generation, cancellable, (error, data) => {
                runwayError = error;
                runwayResult = data;
                runwayReceivedAt = Date.now();
                complete();
            });
        }
    }

    _errorMessage(error) {
        const message = String(error?.message || error || 'Connection failed');
        if (message.includes('Could not connect'))
            return 'Could not connect to Clankermux';
        return message;
    }

    _render() {
        if (!this._model || !this.menu)
            return;
        this._polling.ensure();
        this._view = this._model.buildView(this._accounts, this._status, this._runway, {
            showScoped: this.showScopedLimits !== false,
            defaultCandidateFirst: this.defaultCandidateFirst !== false,
            runwayWarningHours: Number(this.runwayWarningHours || 72),
            statusReceivedAt: this._statusReceivedAt,
            runwayReceivedAt: this._runwayReceivedAt,
        });
        this._renderPanel();
        if (this.menu.isOpen && this._menuStateSignature() !== this._menuSignature)
            this._requestMenuRebuild();
    }

    _renderPanel() {
        if (!this._accounts) {
            this._panelRunwayLabel.set_text(this._lastError ? 'Clankermux !' : 'Clankermux …');
            this._panelRunwayLabel.set_style_class_name(
                this._lastError ? 'clankermux-panel-error' : 'clankermux-panel-loading'
            );
            this._panelEmptyLabel.visible = false;
            for (const meter of this._panelMeters.values())
                meter.visible = false;
            this.set_applet_tooltip(this._lastError || 'Loading Clankermux usage…');
            return;
        }

        const availabilityDegraded = this._view.pool.defaultRoutable < this._view.pool.configured;
        const availabilityMarker = availabilityDegraded
            ? ` · ${this._view.pool.defaultRoutable}/${this._view.pool.configured}!`
            : '';
        const overloadMarker = this._view.providerOverloads.length ? ' ⏳' : '';
        let runwaySeverity = this._view.runway.severity;
        if (this._view.pool.defaultRoutable === 0)
            runwaySeverity = 'critical';
        else if ((availabilityDegraded || this._view.providerOverloads.length) && runwaySeverity === 'normal')
            runwaySeverity = 'warning';
        this._panelRunwayLabel.set_text(
            `${this._view.runway.panelText}${availabilityMarker}${overloadMarker}`
        );
        this._panelRunwayLabel.set_style_class_name(
            `clankermux-panel-runway ${runwaySeverity}`
        );
        const barWidth = Math.max(30, Number(this.panelBarWidth || 52));
        const panelPools = this._model.panelUsagePools(this._view.usagePools);
        const visibleKeys = new Set(panelPools.map(pool => pool.key));
        for (const [key, meter] of this._panelMeters)
            meter.visible = visibleKeys.has(key);
        for (const pool of panelPools) {
            let meter = this._panelMeters.get(pool.key);
            if (!meter) {
                meter = createPanelMeter(
                    pool,
                    barWidth,
                    this.showPanelPercentages !== false
                );
                this._panelMeters.set(pool.key, meter);
                this._panelContent.add_child(meter);
            } else {
                updatePanelMeter(
                    meter,
                    pool,
                    barWidth,
                    this.showPanelPercentages !== false
                );
            }
            meter.visible = true;
        }
        this._panelEmptyLabel.visible = !panelPools.length;

        const lines = [
            `Quota runway: ${this._view.runway.value}`,
            this._view.runway.summary,
            `Coverage: ${this._view.runway.coverageText}`,
            `Availability: ${this._view.pool.defaultRoutable} of ${this._view.pool.configured} accounts in the default routing context`,
        ];
        for (const overload of this._view.providerOverloads) {
            const scope = overload.providerWide ? 'provider-wide' : 'provider or model scope';
            const retry = overload.until
                ? ` · retry ${this._model.formatReset(overload.until, this._view.nowMs)}`
                : overload.probeActive ? ' · recovery probe active' : '';
            lines.push(`${overload.provider} ${scope} overload ${overload.state}${retry}`);
        }
        for (const pool of this._view.usagePools) {
            const unknown = pool.unknownCount ? ` · ${pool.unknownCount} unknown` : '';
            lines.push(`${pool.label}: ${pool.usedPercent}% mean usage across ${pool.accountCount} accounts${unknown}`);
        }
        if (this._lastRunwayError)
            lines.push(`Last runway refresh failed: ${this._lastRunwayError}`);
        if (this._lastError)
            lines.push(`Last refresh failed: ${this._lastError}`);
        else if (this._lastSuccess)
            lines.push(`Updated ${this._model.formatDuration(Date.now() - this._lastSuccess)} ago`);
        this.set_applet_tooltip(lines.join('\n'));
    }

    _menuStateSignature() {
        const view = this._view;
        const accounts = (view?.accounts || []).map(account => [
            account.id,
            account.name,
            account.provider,
            account.defaultCandidate,
            account.state.key,
            account.state.label,
            account.state.until || null,
            account.credential?.label || null,
            account.measurementNotice || null,
            account.stale,
            account.windows.map(window => [
                window.key,
                window.label,
                window.percent,
                window.resetsAt,
                window.projectedAtReset,
                window.severity,
                window.stale,
                window.forecastConfidence,
            ]),
        ]);
        const pools = (view?.usagePools || []).map(pool => [
            pool.key,
            pool.accountCount,
            pool.unknownCount,
            pool.usedPercent,
            pool.severity,
            pool.nextResetAt,
        ]);
        const overloads = (view?.providerOverloads || []).map(overload => [
            overload.key,
            overload.until,
            overload.accountCount,
        ]);
        return JSON.stringify([
            Boolean(this._accounts),
            this._model.normalizeBaseUrl(this.apiUrl),
            view?.pool || null,
            view?.runway || null,
            accounts,
            pools,
            overloads,
            this._lastError || '',
            this._lastRunwayError || '',
            this._lastSuccess ? 1 : 0,
            this._refreshing ? 1 : 0,
        ]);
    }

    _requestMenuRebuild() {
        if (this._menuPointerInside) {
            this._menuRebuildPending = true;
            return;
        }
        this._renderMenu();
    }

    _renderMenu() {
        this._menuSignature = this._menuStateSignature();
        this.menu.removeAll();
        if (!this._accounts) {
            const details = [
                this._lastError || this._model.normalizeBaseUrl(this.apiUrl),
                this._lastRefreshText(),
            ].filter(Boolean).join('\n');
            this.menu.addMenuItem(new InfoMenuItem(
                this._lastError ? 'Clankermux is unavailable' : 'Loading usage…',
                details,
                this._lastError ? 'error' : ''
            ));
            this._addMenuActions();
            return;
        }

        let subtitle = `${this._view.pool.defaultRoutable} of ${this._view.pool.configured} accounts available in the default routing context`;
        if (this._lastError)
            subtitle += ' · showing cached data';
        subtitle += `\n${this._lastRefreshText()}`;
        this.menu.addMenuItem(new InfoMenuItem('Clankermux usage', subtitle));

        const runwayDetails = [
            this._view.runway.summary,
            `Coverage: ${this._view.runway.coverageText}`,
            `Model horizon: ${this._view.runway.horizonText}`,
        ];
        if (this._view.runway.ageMs !== null)
            runwayDetails.push(`Projection updated: ${this._model.formatDuration(this._view.runway.ageMs)} ago`);
        if (this._view.runway.causes.length)
            runwayDetails.push(`Cause: ${this._view.runway.causes.join(' + ')}`);
        if (this._lastRunwayError)
            runwayDetails.push(`Last runway refresh failed: ${this._lastRunwayError}`);
        const runwayStyle = this._view.runway.severity === 'critical'
            ? 'error'
            : this._view.runway.severity === 'warning' ? 'warning' : '';
        this.menu.addMenuItem(new InfoMenuItem(
            `Quota runway · ${this._view.runway.value}`,
            runwayDetails.join('\n'),
            runwayStyle
        ));
        for (const overload of this._view.providerOverloads) {
            const scope = overload.providerWide ? 'Provider-wide breaker' : 'Provider/model breaker';
            const recovery = overload.until
                ? `retry ${this._model.formatReset(overload.until, this._view.nowMs)}`
                : overload.probeActive ? 'recovery probe active' : 'awaiting recovery probe';
            this.menu.addMenuItem(new InfoMenuItem(
                `${overload.provider} overload ${overload.state}`,
                `${scope} · ${overload.accountCount} account${overload.accountCount === 1 ? '' : 's'} · ${recovery}`,
                'overload'
            ));
        }
        if (this._view.usagePools.length)
            this.menu.addMenuItem(new PoolSummaryMenuItem(
                this._view.usagePools,
                this._model,
                this._view.nowMs
            ));
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        for (const account of this._view.accounts)
            this.menu.addMenuItem(new AccountMenuItem(account, this._model, this._view.nowMs));

        if (!this._view.accounts.length)
            this.menu.addMenuItem(new InfoMenuItem('No accounts configured'));
        if (this._lastError)
            this.menu.addMenuItem(new InfoMenuItem('Refresh failed', this._lastError, 'error'));
        this._addMenuActions();
    }

    _lastRefreshText() {
        if (!this._lastSuccess)
            return 'Last refreshed: Never';
        const timestamp = this._model.formatTimestamp(this._lastSuccess);
        const age = this._model.formatDuration(Date.now() - this._lastSuccess);
        return `Last refreshed: ${timestamp} (${age} ago)`;
    }

    _addMenuActions() {
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const refreshItem = new PopupMenu.PopupIconMenuItem(
            this._refreshing ? 'Refreshing…' : 'Refresh now',
            'view-refresh-symbolic',
            St.IconType.SYMBOLIC
        );
        refreshItem.setSensitive(!this._refreshing);
        refreshItem.connect('activate', () => this._refresh(true));
        this.menu.addMenuItem(refreshItem);

        const dashboardItem = new PopupMenu.PopupIconMenuItem(
            'Open dashboard',
            'web-browser-symbolic',
            St.IconType.SYMBOLIC
        );
        dashboardItem.connect('activate', () => {
            const url = this._model.normalizeBaseUrl(this.apiUrl);
            if (url)
                Gio.app_info_launch_default_for_uri(url, global.create_app_launch_context());
        });
        this.menu.addMenuItem(dashboardItem);
    }

    on_applet_clicked() {
        this.menu.toggle();
        if (this.menu.isOpen && (!this._lastSuccess || Date.now() - this._lastSuccess > 15000))
            this._refresh();
    }

    on_applet_removed_from_panel() {
        this._destroyed = true;
        this._requestGeneration++;
        this._cancelActiveRefresh();
        this._polling.stop();
        if (this._session)
            this._session.abort();
        if (this.settings)
            this.settings.finalize();
    }
}

function main(metadata, orientation, panelHeight, instanceId) {
    const model = FileUtils.requireModule('usageModel.js', metadata.path, metadata, 'applet');
    const polling = FileUtils.requireModule('pollingController.js', metadata.path, metadata, 'applet');
    return new ClankermuxUsageApplet(metadata, orientation, panelHeight, instanceId, model, polling);
}
