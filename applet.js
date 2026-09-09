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
        height: 7,
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
        text: window.forecastText,
        style_class: `clankermux-forecast ${window.forecastSeverity}`,
        y_align: Clutter.ActorAlign.CENTER,
    }));
    row.add_child(new St.Label({
        text: model.formatReset(window.resetsAt, nowMs),
        style_class: 'clankermux-reset',
        y_align: Clutter.ActorAlign.CENTER,
    }));
    row.set_accessible_name(`${window.label}: ${window.percent}%. ${window.forecastDescription}. ` +
        `Reset ${model.formatReset(window.resetsAt, nowMs)}`);
    return row;
}

function createWorkloadIcon(row, iconDirectory) {
    return new St.Icon({
        gicon: Gio.icon_new_for_string(`${iconDirectory}/${row.icon}-symbolic.svg`),
        icon_type: St.IconType.SYMBOLIC,
        icon_size: 16,
        y_align: Clutter.ActorAlign.CENTER,
    });
}

function createPanelWorkload(row, iconDirectory) {
    const meter = new St.BoxLayout({ style_class: 'clankermux-panel-workload' });
    meter.add_child(createWorkloadIcon(row, iconDirectory));
    meter._clankermuxValue = new St.Label({ y_align: Clutter.ActorAlign.CENTER });
    meter.add_child(meter._clankermuxValue);
    return meter;
}

function updatePanelWorkload(meter, row, displayValue) {
    meter._clankermuxValue.set_text(displayValue);
    meter._clankermuxValue.set_style_class_name(`clankermux-panel-pace-value ${row.severity}`);
    meter.set_accessible_name(`${row.label}: ${row.valueText}`);
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
        heading.add_child(new St.Label({
            text: account.state.label,
            style_class: `clankermux-state ${account.stateClass}`,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        outer.add_child(heading);

        const notices = [
            account.state.until ? `retry ${model.formatReset(account.state.until, nowMs)}` : '',
            account.credential ? account.credential.label : '',
            account.measurementNotice || '',
        ].filter(Boolean);
        if (notices.length) {
            outer.add_child(new St.Label({
                text: notices.join(' · '),
                style_class: `clankermux-state ${account.stateClass}`,
            }));
        }

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
        this._iconDirectory = `${metadata.path}/icons`;
        this._metadata = metadata;
        this._pollingModule = polling;
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
        this._pacing = null;
        this._workloadHeadroom = null;
        this._statusReceivedAt = 0;
        this._runwayReceivedAt = 0;
        this._pacingReceivedAt = 0;
        this._workloadHeadroomReceivedAt = 0;
        this._outlookSchedule = polling.createOutlookSchedule();
        this._lastRunwayError = '';
        this._lastPacingError = '';
        this._lastWorkloadHeadroomError = '';
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
        this._panelWorkloadBox = new St.BoxLayout({ style_class: 'clankermux-panel-workloads' });
        this._panelEmptyLabel = new St.Label({
            text: 'pace …',
            style_class: 'clankermux-panel-loading',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._panelWorkloads = new Map();
        this._panelContent.add_child(this._panelWorkloadBox);
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
            this._render();
            this._renderMenu();
        });

        this.settings = new Settings.AppletSettings(this, UUID, instanceId);
        this.settings.bind('api-url', 'apiUrl', this._onConnectionSettingsChanged.bind(this));
        this.settings.bind('refresh-interval', 'refreshInterval', this._onPollingSettingsChanged.bind(this));
        this.settings.bind('request-timeout', 'requestTimeout', this._onConnectionSettingsChanged.bind(this));
        this.settings.bind('show-scoped-limits', 'showScopedLimits', this._render.bind(this));
        this.settings.bind('default-candidate-first', 'defaultCandidateFirst', this._render.bind(this));

        this._createSession();
        this._schedulePolling();
        this._forecastClockId = Mainloop.timeout_add_seconds(1, () => {
            try {
                this._render();
                this._refresh(false, true);
            } catch (error) {
                this._onPollingError(error);
            }
            return !this._destroyed;
        });
        this._render();
        this._refresh(true);
    }

    _createSession() {
        if (this._session)
            this._session.abort();
        this._session = new Soup.Session();
        this._session.timeout = Number(this.requestTimeout || 8);
        this._session.user_agent = `${UUID}/1.6`;
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
        this._pacing = null;
        this._workloadHeadroom = null;
        this._statusReceivedAt = 0;
        this._runwayReceivedAt = 0;
        this._pacingReceivedAt = 0;
        this._workloadHeadroomReceivedAt = 0;
        this._outlookSchedule = this._pollingModule.createOutlookSchedule();
        this._lastRunwayError = '';
        this._lastPacingError = '';
        this._lastWorkloadHeadroomError = '';
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

    _refresh(forceOutlook = false, outlookOnly = false) {
        if (this._refreshing || this._destroyed)
            return;
        const expiredKey = [
            ...(this._view?.workloads || []).filter(row => row.expired)
                .map(row => `${row.key}:${row.resetsAt}`),
            ...(this._view?.pacing?.classes || []).filter(item => item.expired)
                .map(item => `class:${item.classId}:${item.resetsAt}`),
        ].sort().join('|');
        const fetchOutlook = this._outlookSchedule.begin(Date.now(), forceOutlook, expiredKey);
        if (outlookOnly && !fetchOutlook)
            return;
        this._refreshing = true;
        const generation = ++this._requestGeneration;
        const cycle = this._model.createRefreshCycle((outlookOnly ? 0 : 2) + (fetchOutlook ? 3 : 0));
        const timeoutSeconds = Math.max(2, Number(this.requestTimeout || 8));
        const cancellable = new Gio.Cancellable();
        this._refreshCancellable = cancellable;
        let accountsResult = null;
        let statusResult = null;
        let runwayResult = null;
        let pacingResult = null;
        let workloadHeadroomResult = null;
        let accountsError = null;
        let statusError = null;
        let runwayError = null;
        let pacingError = null;
        let workloadHeadroomError = null;
        let statusReceivedAt = 0;
        let runwayReceivedAt = 0;
        let pacingReceivedAt = 0;
        let workloadHeadroomReceivedAt = 0;

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

            if (!outlookOnly) {
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
            }
            if (fetchOutlook) {
                runwayError = runwayError || validate(
                    runwayResult,
                    'clankermux.public.runway.v1',
                    'runway',
                    data => Boolean(data.coverage) && Boolean(data.worstStatedOutcome) &&
                        Object.prototype.hasOwnProperty.call(data.worstStatedOutcome, 'headroomPct') &&
                        Object.prototype.hasOwnProperty.call(data.worstStatedOutcome, 'headroomDirection')
                );
                pacingError = pacingError || validate(
                    pacingResult,
                    'clankermux.public.pacing.v1',
                    'pacing',
                    data => Array.isArray(data.classes)
                );
                workloadHeadroomError = workloadHeadroomError || validate(
                    workloadHeadroomResult,
                    'clankermux.public.workload-headroom.v1',
                    'workload headroom',
                    data => Array.isArray(data.rows)
                );
            }

            if (!outlookOnly && !accountsError)
                this._accounts = accountsResult.accounts;
            if (!outlookOnly && !statusError) {
                this._status = statusResult;
                this._statusReceivedAt = statusReceivedAt || Date.now();
            }
            if (fetchOutlook) {
                if (!runwayError) {
                    this._runway = runwayResult;
                    this._runwayReceivedAt = runwayReceivedAt || Date.now();
                    this._lastRunwayError = '';
                } else {
                    this._lastRunwayError = this._errorMessage(runwayError);
                }
                if (!pacingError) {
                    this._pacing = pacingResult;
                    this._pacingReceivedAt = pacingReceivedAt || Date.now();
                    this._lastPacingError = '';
                } else {
                    this._lastPacingError = this._errorMessage(pacingError);
                }
                if (!workloadHeadroomError) {
                    this._workloadHeadroom = workloadHeadroomResult;
                    this._workloadHeadroomReceivedAt = workloadHeadroomReceivedAt || Date.now();
                    this._lastWorkloadHeadroomError = '';
                } else {
                    this._lastWorkloadHeadroomError = this._errorMessage(workloadHeadroomError);
                }
            }

            if (fetchOutlook)
                this._outlookSchedule.complete(Date.now(), Boolean(runwayError || pacingError || workloadHeadroomError));
            if (!outlookOnly && !accountsError && !statusError) {
                this._lastSuccess = Date.now();
                this._lastError = '';
            } else if (!outlookOnly) {
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
            const timeoutError = `Refresh timed out after ${timeoutSeconds}s`;
            if (!outlookOnly)
                this._lastError = timeoutError;
            if (fetchOutlook) {
                this._lastRunwayError = timeoutError;
                this._lastPacingError = timeoutError;
                this._lastWorkloadHeadroomError = timeoutError;
                this._outlookSchedule.complete(Date.now(), true);
            }
            this._createSession();
            this._render();
            return false;
        });

        if (!outlookOnly) {
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
        }
        if (fetchOutlook) {
            this._getJson('/public/v1/runway', generation, cancellable, (error, data) => {
                runwayError = error;
                runwayResult = data;
                runwayReceivedAt = Date.now();
                complete();
            });
            this._getJson('/public/v1/pacing', generation, cancellable, (error, data) => {
                pacingError = error;
                pacingResult = data;
                pacingReceivedAt = Date.now();
                complete();
            });
            this._getJson('/public/v1/workload-headroom', generation, cancellable, (error, data) => {
                workloadHeadroomError = error;
                workloadHeadroomResult = data;
                workloadHeadroomReceivedAt = Date.now();
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
        this._view = this._model.buildView(
            this._accounts,
            this._status,
            this._runway,
            this._pacing,
            this._workloadHeadroom,
            {
                showScoped: this.showScopedLimits !== false,
                defaultCandidateFirst: this.defaultCandidateFirst !== false,
                statusReceivedAt: this._statusReceivedAt,
                runwayReceivedAt: this._runwayReceivedAt,
                pacingReceivedAt: this._pacingReceivedAt,
                workloadHeadroomReceivedAt: this._workloadHeadroomReceivedAt,
                runwayFetchFailed: Boolean(this._lastRunwayError),
                pacingFetchFailed: Boolean(this._lastPacingError),
                workloadHeadroomFetchFailed: Boolean(this._lastWorkloadHeadroomError),
            }
        );
        this._renderPanel();
        if (this.menu.isOpen && this._menuStateSignature() !== this._menuSignature)
            this._requestMenuRebuild();
    }

    _renderPanel() {
        if (!this._accounts) {
            this._panelEmptyLabel.set_text(this._lastError ? 'pace !' : 'pace …');
            this._panelEmptyLabel.visible = true;
            for (const meter of this._panelWorkloads.values())
                meter.visible = false;
            this.set_applet_tooltip(this._lastError || 'Loading Clankermux usage…');
            return;
        }

        const paceRows = this._view.paceRows;
        const visibleKeys = new Set(paceRows.map(row => row.key));
        for (const [key, meter] of this._panelWorkloads)
            meter.visible = visibleKeys.has(key);
        for (const row of paceRows) {
            const displayValue = this._model.panelWorkloadLabel(
                row
            );
            let meter = this._panelWorkloads.get(row.key);
            if (!meter) {
                meter = createPanelWorkload(row, this._iconDirectory);
                this._panelWorkloads.set(row.key, meter);
                this._panelWorkloadBox.add_child(meter);
            }
            updatePanelWorkload(meter, row, displayValue);
            meter.visible = true;
        }
        this._panelEmptyLabel.visible = false;

        const lines = ['Until next weekly reset'];
        for (const row of paceRows)
            lines.push(this._model.workloadTooltipLine(row));
        if (paceRows.some(row => row.valueText.includes('*')))
            lines.push('* Conservative family bound');
        if (this._lastError || this._lastWorkloadHeadroomError)
            lines.push('Refresh failed');
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
                window.exhaustsAt,
                window.willExhaust,
                window.forecastDescription,
                window.forecastSeverity,
                window.severity,
                window.stale,
                window.forecastConfidence,
            ]),
        ]);
        return JSON.stringify([
            Boolean(this._accounts),
            this._model.normalizeBaseUrl(this.apiUrl),
            view?.pool || null,
            accounts,
            this._lastError || '',
            this._lastSuccess || 0,
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

        let subtitle = `${this._view.pool.defaultRoutable} of ${this._view.pool.configured} accounts available`;
        if (this._lastError)
            subtitle += ' · cached';
        subtitle += ` · ${this._lastRefreshText()}`;
        this.menu.addMenuItem(new InfoMenuItem('Clankermux usage', subtitle));

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
            return 'never refreshed';
        const timestamp = this._model.formatTimestamp(this._lastSuccess);
        const age = this._model.formatDuration(Date.now() - this._lastSuccess);
        return `updated ${timestamp} (${age} ago)`;
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
        if (this._forecastClockId) {
            Mainloop.source_remove(this._forecastClockId);
            this._forecastClockId = 0;
        }
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
