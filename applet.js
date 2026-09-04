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
const OUTLOOK_REFRESH_MS = 60 * 1000;

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
    meter._clankermuxBasis = new St.Label({
        text: 'B',
        style_class: 'clankermux-bound-badge',
        y_align: Clutter.ActorAlign.CENTER,
    });
    meter.add_child(meter._clankermuxBasis);
    meter._clankermuxTrack = createPaceTrack(row, width, 'clankermux-panel-pace-track');
    meter.add_child(meter._clankermuxTrack);
    meter._clankermuxValue = new St.Label({ y_align: Clutter.ActorAlign.CENTER });
    meter.add_child(meter._clankermuxValue);
    updatePanelWorkload(meter, row, width, displayValue);
    return meter;
}

function updatePanelWorkload(meter, row, width, displayValue) {
    meter._clankermuxLabel.set_text(`${row.label}${row.incomplete ? '*' : ''}`);
    meter._clankermuxBasis.set_text(row.basis === 'bound' ? 'B' : '?');
    meter._clankermuxBasis.visible = row.basis !== 'exact';
    updatePaceTrack(meter._clankermuxTrack, row, width);
    meter._clankermuxValue.set_text(displayValue);
    meter._clankermuxValue.set_style_class_name(`clankermux-panel-pace-value ${row.severity}`);
    meter._clankermuxValue.visible = Boolean(displayValue);
}

class PaceMenuItem extends PopupMenu.PopupBaseMenuItem {
    constructor(pace) {
        super({ reactive: false });
        const outer = new St.BoxLayout({ vertical: true, style_class: 'clankermux-pace-summary' });
        const heading = new St.BoxLayout({ style_class: 'clankermux-pace-summary-heading' });
        heading.add_child(new St.Label({ text: 'Pool pace', style_class: 'clankermux-account-name' }));
        heading.add_child(createPaceTrack(pace, 170));
        heading.add_child(new St.Label({
            text: pace.valueText,
            style_class: `clankermux-pace-summary-value ${pace.severity}`,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        outer.add_child(heading);
        outer.add_child(new St.Label({
            text: `${pace.summary}\nCoverage: ${pace.coverageText}`,
            style_class: 'clankermux-info-subtitle',
        }));
        this.addActor(outer, { expand: true });
    }
}

class WorkloadSummaryMenuItem extends PopupMenu.PopupBaseMenuItem {
    constructor(workloads) {
        super({ reactive: false });
        const outer = new St.BoxLayout({ vertical: true, style_class: 'clankermux-workloads' });
        outer.add_child(new St.Label({ text: 'Workload headroom', style_class: 'clankermux-account-name' }));
        for (const workload of workloads) {
            const row = new St.BoxLayout({ style_class: 'clankermux-workload-row' });
            row.add_child(new St.Label({
                text: `${workload.label}${workload.incomplete ? '*' : ''}`,
                style_class: 'clankermux-workload-label',
                y_align: Clutter.ActorAlign.CENTER,
            }));
            if (workload.basis !== 'exact') {
                row.add_child(new St.Label({
                    text: workload.basis === 'bound' ? 'BOUND' : 'UNKNOWN',
                    style_class: 'clankermux-bound-badge',
                }));
            }
            row.add_child(createPaceTrack(workload, 150));
            row.add_child(new St.Label({
                text: workload.valueText,
                style_class: `clankermux-workload-value ${workload.severity}`,
                y_align: Clutter.ActorAlign.CENTER,
            }));
            outer.add_child(row);
            outer.add_child(new St.Label({
                text: `${workload.summary} · ${workload.basisLabel} · ${workload.depthText} · ${workload.projectionLabel}`,
                style_class: 'clankermux-info-subtitle',
            }));
        }
        this.addActor(outer, { expand: true });
    }
}

class PacingSummaryMenuItem extends PopupMenu.PopupBaseMenuItem {
    constructor(pacing, model, nowMs) {
        super({ reactive: false });
        const outer = new St.BoxLayout({ vertical: true, style_class: 'clankermux-class-pacing' });
        outer.add_child(new St.Label({ text: 'Class pacing', style_class: 'clankermux-account-name' }));
        outer.add_child(new St.Label({
            text: `5-hour governor: ${model.humanizeStatus(pacing.fiveHourOutlookTone)}`,
            style_class: `clankermux-five-hour ${pacing.fiveHourSeverity}`,
        }));
        for (const item of pacing.classes) {
            const heading = `${item.label}${item.binding ? ' · BINDING' : ''}`;
            const utilization = item.utilizationPct === null ? 'weekly usage unknown' :
                `${item.utilizationPct}% used on least-used account`;
            const reset = item.resetsAt ? ` · resets ${model.formatReset(item.resetsAt, nowMs)}` : '';
            const failover = item.singlePointOfFailure ? ' · no failover' : '';
            const projection = item.willRunOut
                ? ` · ${item.willRunOut} of ${item.eligibleTotal} projected to hit 100%`
                : '';
            outer.add_child(new St.Label({
                text: heading,
                style_class: `clankermux-class-heading ${item.severity}`,
            }));
            outer.add_child(new St.Label({
                text: `${utilization}${reset}${projection}${failover}`,
                style_class: 'clankermux-info-subtitle',
            }));
            outer.add_child(new St.Label({
                text: `Burn: ${item.burnText}`,
                style_class: `clankermux-burn ${item.burnSeverity}`,
            }));
            let fiveHourSummary = item.fiveHour.summary;
            const nextLift = model.formatReset(item.fiveHour.nextLiftAt, nowMs);
            if (nextLift) {
                const account = item.fiveHour.nextLiftAccountName
                    ? ` on ${item.fiveHour.nextLiftAccountName}`
                    : '';
                fiveHourSummary += ` · next lift ${nextLift}${account}`;
            }
            outer.add_child(new St.Label({
                text: fiveHourSummary,
                style_class: 'clankermux-five-hour',
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
        this._pacing = null;
        this._workloadHeadroom = null;
        this._statusReceivedAt = 0;
        this._runwayReceivedAt = 0;
        this._pacingReceivedAt = 0;
        this._workloadHeadroomReceivedAt = 0;
        this._lastOutlookAttempt = 0;
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
            text: 'workloads …',
            style_class: 'clankermux-panel-loading',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._panelStatusLabel = new St.Label({
            style_class: 'clankermux-panel-status',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._panelStatusLabel.visible = false;
        this._panelWorkloads = new Map();
        this._panelContent.add_child(this._panelWorkloadBox);
        this._panelContent.add_child(this._panelEmptyLabel);
        this._panelContent.add_child(this._panelStatusLabel);
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
        this._lastOutlookAttempt = 0;
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

    _refresh(forceOutlook = false) {
        if (this._refreshing || this._destroyed)
            return;
        this._refreshing = true;
        const generation = ++this._requestGeneration;
        const fetchOutlook = forceOutlook || !this._lastOutlookAttempt ||
            Date.now() - this._lastOutlookAttempt >= OUTLOOK_REFRESH_MS;
        const cycle = this._model.createRefreshCycle(fetchOutlook ? 5 : 2);
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

            if (!accountsError)
                this._accounts = accountsResult.accounts;
            if (!statusError) {
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
        if (fetchOutlook) {
            this._lastOutlookAttempt = Date.now();
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
                runwayWarningHours: Number(this.runwayWarningHours || 72),
                statusReceivedAt: this._statusReceivedAt,
                runwayReceivedAt: this._runwayReceivedAt,
                pacingReceivedAt: this._pacingReceivedAt,
                workloadHeadroomReceivedAt: this._workloadHeadroomReceivedAt,
            }
        );
        this._renderPanel();
        if (this.menu.isOpen && this._menuStateSignature() !== this._menuSignature)
            this._requestMenuRebuild();
    }

    _renderPanel() {
        if (!this._accounts) {
            this._panelEmptyLabel.set_text(this._lastError ? 'workloads !' : 'workloads …');
            this._panelEmptyLabel.visible = true;
            this._panelStatusLabel.visible = false;
            for (const meter of this._panelWorkloads.values())
                meter.visible = false;
            this.set_applet_tooltip(this._lastError || 'Loading Clankermux usage…');
            return;
        }

        const availabilityDegraded = this._view.pool.defaultRoutable < this._view.pool.configured;
        const statusParts = [];
        if (availabilityDegraded)
            statusParts.push(`${this._view.pool.defaultRoutable}/${this._view.pool.configured}!`);
        if (this._view.providerOverloads.length)
            statusParts.push('⏳');
        this._panelStatusLabel.set_text(statusParts.join(' '));
        this._panelStatusLabel.visible = statusParts.length > 0;
        const barWidth = Math.max(30, Number(this.panelBarWidth || 52));
        const visibleKeys = new Set(this._view.workloads.map(workload => workload.key));
        for (const [key, meter] of this._panelWorkloads)
            meter.visible = visibleKeys.has(key);
        for (const workload of this._view.workloads) {
            const displayValue = this._model.panelWorkloadLabel(
                workload,
                this.showPanelPercentages === true
            );
            let meter = this._panelWorkloads.get(workload.key);
            if (!meter) {
                meter = createPanelWorkload(
                    workload,
                    barWidth,
                    displayValue
                );
                this._panelWorkloads.set(workload.key, meter);
                this._panelWorkloadBox.add_child(meter);
            } else {
                updatePanelWorkload(
                    meter,
                    workload,
                    barWidth,
                    displayValue
                );
            }
            meter.visible = true;
        }
        this._panelEmptyLabel.set_text(this._lastWorkloadHeadroomError ? 'workloads !' : 'workloads –');
        this._panelEmptyLabel.visible = !this._view.workloads.length;

        const lines = [
            `Pool pace: ${this._view.pace.valueText} · ${this._view.pace.summary}`,
            `Quota runway: ${this._view.runway.value}`,
            this._view.runway.summary,
            `Coverage: ${this._view.runway.coverageText}`,
            `Availability: ${this._view.pool.defaultRoutable} of ${this._view.pool.configured} accounts in the default routing context`,
        ];
        for (const workload of this._view.workloads) {
            const basis = workload.basis === 'bound' ? ' · conservative bound' : '';
            lines.push(
                `${workload.label}: ${workload.valueText} · ${workload.summary}${basis} · ${workload.depthText}`
            );
        }
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
        if (this._lastPacingError)
            lines.push(`Last pacing refresh failed: ${this._lastPacingError}`);
        if (this._lastWorkloadHeadroomError)
            lines.push(`Last workload refresh failed: ${this._lastWorkloadHeadroomError}`);
        if (this._lastError)
            lines.push(`Last refresh failed: ${this._lastError}`);
        else if (this._lastSuccess)
            lines.push(`Accounts/status updated ${this._model.formatDuration(Date.now() - this._lastSuccess)} ago`);
        this.set_applet_tooltip(lines.join('\n'));
    }

    _feedErrorDetails(error, receivedAt) {
        const details = [error];
        if (receivedAt) {
            const timestamp = this._model.formatTimestamp(receivedAt);
            const age = this._model.formatDuration(Date.now() - receivedAt);
            details.push(`Last successful fetch: ${timestamp} (${age} ago)`);
        }
        return details.join('\n');
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
            view?.pace || null,
            view?.pacing || null,
            view?.runway || null,
            view?.workloads || null,
            accounts,
            pools,
            overloads,
            this._lastError || '',
            this._lastRunwayError || '',
            this._lastPacingError || '',
            this._lastWorkloadHeadroomError || '',
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

        this.menu.addMenuItem(new PaceMenuItem(this._view.pace));
        if (this._lastRunwayError) {
            this.menu.addMenuItem(new InfoMenuItem(
                this._runway ? 'Pool pace is cached' : 'Pool pace unavailable',
                this._feedErrorDetails(this._lastRunwayError, this._runwayReceivedAt),
                'warning'
            ));
        }
        if (this._view.workloads.length)
            this.menu.addMenuItem(new WorkloadSummaryMenuItem(this._view.workloads));
        if (this._lastWorkloadHeadroomError)
            this.menu.addMenuItem(new InfoMenuItem(
                this._workloadHeadroom ? 'Workload headroom is cached' : 'Workload headroom unavailable',
                this._feedErrorDetails(
                    this._lastWorkloadHeadroomError,
                    this._workloadHeadroomReceivedAt
                ),
                'warning'
            ));
        if (this._view.pacing.classes.length)
            this.menu.addMenuItem(new PacingSummaryMenuItem(
                this._view.pacing,
                this._model,
                this._view.nowMs
            ));
        if (this._lastPacingError)
            this.menu.addMenuItem(new InfoMenuItem(
                this._pacing ? 'Class pacing is cached' : 'Class pacing unavailable',
                this._feedErrorDetails(this._lastPacingError, this._pacingReceivedAt),
                'warning'
            ));

        const runwayDetails = [
            this._view.runway.summary,
            `Coverage: ${this._view.runway.coverageText}`,
            `Model horizon: ${this._view.runway.horizonText}`,
        ];
        if (this._view.runway.ageMs !== null)
            runwayDetails.push(`Projection updated: ${this._model.formatDuration(this._view.runway.ageMs)} ago`);
        if (this._view.runway.causes.length)
            runwayDetails.push(`Cause: ${this._view.runway.causes.join(' + ')}`);
        if (this._view.runway.bandText)
            runwayDetails.push(`Quantisation band: ${this._view.runway.bandText}`);
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
            return 'Accounts/status refreshed: Never';
        const timestamp = this._model.formatTimestamp(this._lastSuccess);
        const age = this._model.formatDuration(Date.now() - this._lastSuccess);
        return `Accounts/status refreshed: ${timestamp} (${age} ago)`;
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
