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

function createPaceTrack(signal, width, styleClass = 'clankermux-pace-track') {
    const track = new St.BoxLayout({ style_class: styleClass, width });
    const halfWidth = Math.max(1, Math.floor(width / 2));
    track._clankermuxLeft = new St.Bin({ style_class: 'clankermux-pace-half left', width: halfWidth });
    track._clankermuxLeft.set_fill(false, false);
    track._clankermuxLeft.set_alignment(St.Align.END, St.Align.MIDDLE);
    track._clankermuxRight = new St.Bin({ style_class: 'clankermux-pace-half right', width: halfWidth });
    track._clankermuxRight.set_fill(false, false);
    track._clankermuxRight.set_alignment(St.Align.START, St.Align.MIDDLE);
    track._clankermuxLeftFill = new St.Widget({ height: 8 });
    track._clankermuxRightFill = new St.Widget({ height: 8 });
    track._clankermuxLeft.set_child(track._clankermuxLeftFill);
    track._clankermuxRight.set_child(track._clankermuxRightFill);
    track.add_child(track._clankermuxLeft);
    track.add_child(track._clankermuxRight);
    updatePaceTrack(track, signal, width);
    return track;
}

function updatePaceTrack(track, signal, width) {
    const halfWidth = Math.max(1, Math.floor(width / 2));
    const fillWidth = signal.fillPercent <= 0
        ? 0
        : Math.max(2, Math.round(halfWidth * signal.fillPercent / 100));
    track.set_width(width);
    track._clankermuxLeft.set_width(halfWidth);
    track._clankermuxRight.set_width(halfWidth);
    track._clankermuxLeftFill.set_width(signal.side === 'left' ? fillWidth : 0);
    track._clankermuxRightFill.set_width(signal.side === 'right' ? fillWidth : 0);
    const style = `clankermux-pace-fill ${signal.severity}`;
    track._clankermuxLeftFill.set_style_class_name(style);
    track._clankermuxRightFill.set_style_class_name(style);
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

function createPanelWorkload(row, width, displayValue) {
    const meter = new St.BoxLayout({ style_class: 'clankermux-panel-workload' });
    meter._clankermuxLabel = new St.Label({
        style_class: 'clankermux-panel-workload-label',
        y_align: Clutter.ActorAlign.CENTER,
    });
    meter.add_child(meter._clankermuxLabel);
    meter._clankermuxTrack = createPaceTrack(row, width, 'clankermux-panel-pace-track');
    meter.add_child(meter._clankermuxTrack);
    meter._clankermuxValue = new St.Label({ y_align: Clutter.ActorAlign.CENTER });
    meter.add_child(meter._clankermuxValue);
    updatePanelWorkload(meter, row, width, displayValue);
    return meter;
}

function updatePanelWorkload(meter, row, width, displayValue) {
    meter._clankermuxLabel.set_text(row.label);
    updatePaceTrack(meter._clankermuxTrack, row, width);
    meter._clankermuxValue.set_text(displayValue);
    meter._clankermuxValue.set_style_class_name(`clankermux-panel-pace-value ${row.severity}`);
    meter._clankermuxValue.visible = Boolean(displayValue);
}

class PaceSummaryMenuItem extends PopupMenu.PopupBaseMenuItem {
    constructor(paceRows) {
        super({ reactive: false });
        const outer = new St.BoxLayout({ vertical: true, style_class: 'clankermux-workloads' });
        outer.add_child(new St.Label({ text: 'Pacing', style_class: 'clankermux-account-name' }));
        for (const row of paceRows) {
            const line = new St.BoxLayout({ style_class: 'clankermux-workload-row' });
            line.add_child(new St.Label({
                text: row.label,
                style_class: 'clankermux-workload-label',
                y_align: Clutter.ActorAlign.CENTER,
            }));
            if (row.binding) {
                line.add_child(new St.Label({
                    text: 'BINDING',
                    style_class: 'clankermux-bound-badge',
                }));
            }
            line.add_child(createPaceTrack(row, 150));
            line.add_child(new St.Label({
                text: row.valueText,
                style_class: `clankermux-workload-value ${row.severity}`,
                y_align: Clutter.ActorAlign.CENTER,
            }));
            outer.add_child(line);
            outer.add_child(new St.Label({
                text: row.detail,
                style_class: 'clankermux-info-subtitle',
            }));
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
        this.settings.bind('runway-warning-hours', 'runwayWarningHours', this._render.bind(this));
        this.settings.bind('panel-bar-width', 'panelBarWidth', this._render.bind(this));
        this.settings.bind('show-panel-percentages', 'showPanelPercentages', this._render.bind(this));
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
        const expiredKey = (this._view?.paceRows || [])
            .filter(row => row.expired).map(row => `${row.key}:${row.resetsAt}`).sort().join('|');
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
        const oldForecastState = this._forecastState();
        this._view = this._model.buildView(
            this._accounts,
            this._status,
            this._runway,
            this._pacing,
            this._workloadHeadroom,
            {
                showScoped: this.showScopedLimits !== false,
                defaultCandidateFirst: this.defaultCandidateFirst !== false,
                runwayWarningHours: Number(this.runwayWarningHours || 72),
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
        if (this.menu.isOpen && this._menuStateSignature() !== this._menuSignature) {
            if (oldForecastState !== this._forecastState())
                this._renderMenu();
            else
                this._requestMenuRebuild();
        }
    }

    _forecastState() {
        return JSON.stringify([
            this._view?.pace.stale, this._view?.pacing.stale, this._view?.workloadHeadroom.stale,
            (this._view?.paceRows || []).map(row => [row.key, row.stale, row.expired]),
        ]);
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

        const barWidth = Math.max(30, Number(this.panelBarWidth || 52));
        const paceRows = this._view.paceRows;
        const visibleKeys = new Set(paceRows.map(row => row.key));
        for (const [key, meter] of this._panelWorkloads)
            meter.visible = visibleKeys.has(key);
        for (const row of paceRows) {
            const displayValue = this._model.panelWorkloadLabel(
                row,
                this.showPanelPercentages === true
            );
            let meter = this._panelWorkloads.get(row.key);
            if (!meter) {
                meter = createPanelWorkload(row, barWidth, displayValue);
                this._panelWorkloads.set(row.key, meter);
                this._panelWorkloadBox.add_child(meter);
            } else {
                updatePanelWorkload(meter, row, barWidth, displayValue);
            }
            meter.visible = true;
        }
        const paceUnavailable = this._lastPacingError || this._lastWorkloadHeadroomError;
        this._panelEmptyLabel.set_text(paceUnavailable ? 'pace !' : 'pace –');
        this._panelEmptyLabel.visible = !paceRows.length;

        const lines = [];
        for (const row of paceRows)
            lines.push(`${row.label}: ${row.valueText}${row.binding ? ' · binding' : ''} · ${row.detail}`);
        const runway = this._view.runway;
        if (runway.available) {
            const causes = runway.causes.length ? ` · ${runway.causes.join(' + ')}` : '';
            const coverage = runway.complete ? '' : ` · ${runway.coverageText}`;
            lines.push(`Runway: ${runway.value} · ${runway.summary}${causes}${coverage}`);
        }
        const degraded = this._view.accounts
            .filter(account => account.state.key !== 'available')
            .map(account => `${account.name}: ${account.state.label}`);
        lines.push(
            `Accounts: ${this._view.pool.defaultRoutable} of ${this._view.pool.configured} available` +
            `${degraded.length ? ` · ${degraded.join(', ')}` : ''}`
        );
        for (const overload of this._view.providerOverloads) {
            const scope = overload.providerWide ? 'provider-wide' : 'provider or model scope';
            const retry = overload.until
                ? ` · retry ${this._model.formatReset(overload.until, this._view.nowMs)}`
                : overload.probeActive ? ' · recovery probe active' : '';
            lines.push(`${overload.provider} ${scope} overload ${overload.state}${retry}`);
        }
        const forecastErrors = [...new Set([
            this._lastRunwayError, this._lastPacingError, this._lastWorkloadHeadroomError,
        ].filter(Boolean))];
        if (forecastErrors.length)
            lines.push(`Forecast refresh failed: ${forecastErrors.join(' · ')}`);
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
        const overloads = (view?.providerOverloads || []).map(overload => [
            overload.key,
            overload.until,
            overload.accountCount,
        ]);
        return JSON.stringify([
            Boolean(this._accounts),
            this._model.normalizeBaseUrl(this.apiUrl),
            view?.pool || null,
            view?.paceRows || null,
            view?.runway || null,
            accounts,
            overloads,
            this._lastError || '',
            this._lastRunwayError || '',
            this._lastPacingError || '',
            this._lastWorkloadHeadroomError || '',
            this._lastSuccess ? 1 : 0,
            this._refreshing ? 1 : 0,
        ], (key, value) => key === 'ageMs' ? undefined : value);
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

        if (this._view.paceRows.length) {
            this.menu.addMenuItem(new PaceSummaryMenuItem(this._view.paceRows));
        } else {
            this.menu.addMenuItem(new InfoMenuItem(
                'Pacing unavailable',
                this._lastPacingError || this._lastWorkloadHeadroomError || 'No workloads reported'
            ));
        }

        const failedFeeds = [
            ['Runway', this._lastRunwayError, this._runway, this._runwayReceivedAt],
            ['Class pacing', this._lastPacingError, this._pacing, this._pacingReceivedAt],
            ['Workload headroom', this._lastWorkloadHeadroomError,
                this._workloadHeadroom, this._workloadHeadroomReceivedAt],
        ].filter(([, error]) => Boolean(error));
        if (failedFeeds.length) {
            const cached = failedFeeds.filter(([, , resource]) => Boolean(resource)).length;
            const details = failedFeeds.map(([label, error, resource, receivedAt]) => {
                const timestamp = this._model.formatTimestamp(receivedAt);
                const age = this._model.formatDuration(Date.now() - receivedAt);
                return `${label}: ${error} · ` +
                    `${resource ? `last success ${timestamp} (${age} ago)` : 'no cached reading'}`;
            });
            this.menu.addMenuItem(new InfoMenuItem(
                cached === failedFeeds.length ? 'Forecasts cached' :
                    cached === 0 ? 'Forecasts unavailable' : 'Forecasts partly cached',
                details.join('\n'),
                'warning'
            ));
        }

        const runway = this._view.runway;
        const runwayDetails = [
            runway.summary,
            runway.causes.length ? `Cause: ${runway.causes.join(' + ')}` : '',
            runway.available && !runway.complete ? runway.coverageText : '',
        ].filter(Boolean);
        const runwayStyle = runway.severity === 'critical'
            ? 'error'
            : runway.severity === 'warning' ? 'warning' : '';
        this.menu.addMenuItem(new InfoMenuItem(
            `Runway${runway.stale ? ' · stale' : ''} · ${runway.value}`,
            runwayDetails.join(' · '),
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
