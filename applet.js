const Applet = imports.ui.applet;
const ByteArray = imports.byteArray;
const Clutter = imports.gi.Clutter;
const FileUtils = imports.misc.fileUtils;
const Gio = imports.gi.Gio;
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
        height: styleClass === 'clankermux-panel-progress-track' ? 8 : 7,
    });
    track.set_child(fill);
    return track;
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

function createUsageBar(window, model) {
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
        text: model.formatReset(window.resetsAt),
        style_class: 'clankermux-reset',
        y_align: Clutter.ActorAlign.CENTER,
    }));
    return row;
}

function createPanelMeter(pool, width, showPercentages) {
    const meter = new St.BoxLayout({ style_class: 'clankermux-panel-meter' });
    meter.add_child(new St.Label({
        text: pool.label,
        style_class: 'clankermux-panel-meter-label',
        y_align: Clutter.ActorAlign.CENTER,
    }));
    meter.add_child(createProgressTrack(
        pool.usedPercent,
        pool.severity,
        width,
        'clankermux-panel-progress-track'
    ));
    if (showPercentages) {
        meter.add_child(new St.Label({
            text: `${pool.usedPercent}%`,
            style_class: `clankermux-panel-percent ${pool.severity}`,
            y_align: Clutter.ActorAlign.CENTER,
        }));
    }
    return meter;
}

class PoolSummaryMenuItem extends PopupMenu.PopupBaseMenuItem {
    constructor(pools, model) {
        super({ reactive: false });
        const outer = new St.BoxLayout({ vertical: true, style_class: 'clankermux-pools' });
        outer.add_child(new St.Label({ text: 'Combined runway', style_class: 'clankermux-account-name' }));
        outer.add_child(new St.Label({
            text: 'Equal-capacity average across accounts · arrow is projected usage at reset',
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
            row.add_child(new St.Label({
                text: pool.forecastCount ? `→${pool.projectedPercent}%` : '→–',
                style_class: `clankermux-forecast ${pool.severity}`,
                y_align: Clutter.ActorAlign.CENTER,
            }));
            row.add_child(new St.Label({
                text: `${pool.accountCount} acct${pool.accountCount === 1 ? '' : 's'} · next ${model.formatReset(pool.nextResetAt)}`,
                style_class: 'clankermux-reset pooled',
                y_align: Clutter.ActorAlign.CENTER,
            }));
            outer.add_child(row);
        }
        this.addActor(outer, { expand: true });
    }
}

class AccountMenuItem extends PopupMenu.PopupBaseMenuItem {
    constructor(account, model) {
        super({ reactive: false });
        const outer = new St.BoxLayout({ vertical: true, style_class: 'clankermux-account' });

        const heading = new St.BoxLayout({ vertical: false, style_class: 'clankermux-account-heading' });
        heading.add_child(new St.Label({
            text: account.name,
            style_class: 'clankermux-account-name',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        if (account.primary) {
            heading.add_child(new St.Label({
                text: 'ACTIVE',
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

        const stateText = account.stale ? `${account.state.label} · cached usage` : account.state.label;
        outer.add_child(new St.Label({
            text: stateText,
            style_class: `clankermux-state ${account.state.key}`,
        }));

        if (account.windows.length) {
            for (const window of account.windows)
                outer.add_child(createUsageBar(window, model));
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
    constructor(metadata, orientation, panelHeight, instanceId, model) {
        super(orientation, panelHeight, instanceId);
        this._metadata = metadata;
        this._model = model;
        this._destroyed = false;
        this._pollId = 0;
        this._requestGeneration = 0;
        this._refreshing = false;
        this._accounts = null;
        this._health = null;
        this._view = null;
        this._lastSuccess = 0;
        this._lastError = '';

        this.setAllowedLayout(Applet.AllowedLayout.HORIZONTAL);
        this._panelContent = new St.BoxLayout({ style_class: 'clankermux-panel-content' });
        this.actor.add(this._panelContent, { y_align: St.Align.MIDDLE, y_fill: false });
        this.set_applet_tooltip('Loading Clankermux usage…');

        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager.addMenu(this.menu);

        this.settings = new Settings.AppletSettings(this, UUID, instanceId);
        this.settings.bind('api-url', 'apiUrl', this._onConnectionSettingsChanged.bind(this));
        this.settings.bind('refresh-interval', 'refreshInterval', this._onPollingSettingsChanged.bind(this));
        this.settings.bind('request-timeout', 'requestTimeout', this._onConnectionSettingsChanged.bind(this));
        this.settings.bind('warning-threshold', 'warningThreshold', this._render.bind(this));
        this.settings.bind('panel-bar-width', 'panelBarWidth', this._render.bind(this));
        this.settings.bind('show-panel-percentages', 'showPanelPercentages', this._render.bind(this));
        this.settings.bind('show-scoped-limits', 'showScopedLimits', this._render.bind(this));
        this.settings.bind('primary-first', 'primaryFirst', this._render.bind(this));

        this._createSession();
        this._schedulePolling();
        this._render();
        this._refresh();
    }

    _createSession() {
        if (this._session)
            this._session.abort();
        this._session = new Soup.Session();
        this._session.timeout = Number(this.requestTimeout || 8);
        this._session.user_agent = `${UUID}/1.0`;
    }

    _onConnectionSettingsChanged() {
        if (!this.settings)
            return;
        this._requestGeneration++;
        this._refreshing = false;
        this._createSession();
        this._refresh();
    }

    _onPollingSettingsChanged() {
        if (!this.settings)
            return;
        this._schedulePolling();
    }

    _schedulePolling() {
        if (this._pollId) {
            Mainloop.source_remove(this._pollId);
            this._pollId = 0;
        }
        const interval = Math.max(10, Number(this.refreshInterval || 30));
        this._pollId = Mainloop.timeout_add_seconds(interval, () => {
            this._refresh();
            return true;
        });
    }

    _getJson(path, generation, callback) {
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

        this._session.send_and_read_async(message, Soup.MessagePriority.NORMAL, null, (session, result) => {
            if (this._destroyed || generation !== this._requestGeneration)
                return;
            let data = null;
            let error = null;
            const status = message.get_status();
            try {
                const bytes = session.send_and_read_finish(result);
                const body = ByteArray.toString(bytes.get_data());
                data = JSON.parse(body);
                if (status < 200 || status >= 300)
                    error = new Error(`HTTP ${status}: ${message.get_reason_phrase()}`);
            } catch (caught) {
                error = caught;
            }
            callback(error, data, status);
        });
    }

    _refresh() {
        if (this._refreshing || this._destroyed)
            return;
        this._refreshing = true;
        const generation = ++this._requestGeneration;
        let remaining = 2;
        let accountsResult = null;
        let healthResult = null;
        let accountsError = null;
        let healthError = null;

        const complete = () => {
            remaining--;
            if (remaining > 0 || this._destroyed || generation !== this._requestGeneration)
                return;
            this._refreshing = false;

            if (Array.isArray(accountsResult)) {
                this._accounts = accountsResult;
                this._lastSuccess = Date.now();
                this._lastError = '';
            } else {
                this._lastError = this._errorMessage(accountsError || new Error('Unexpected account response'));
            }
            if (healthResult?.pool)
                this._health = healthResult;
            else if (healthError && !this._accounts)
                this._lastError = this._errorMessage(healthError);
            this._render();
        };

        this._getJson('/api/accounts', generation, (error, data) => {
            accountsError = error;
            accountsResult = data;
            complete();
        });
        this._getJson('/health?detail=1', generation, (error, data) => {
            healthError = error;
            healthResult = data;
            complete();
        });
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
        this._view = this._model.buildView(this._accounts, this._health, {
            showScoped: this.showScopedLimits !== false,
            primaryFirst: this.primaryFirst !== false,
            warningThreshold: Number(this.warningThreshold || 80),
        });
        this._renderPanel();
        this._renderMenu();
    }

    _renderPanel() {
        this._panelContent.destroy_all_children();
        if (!this._accounts) {
            this._panelContent.add_child(new St.Label({
                text: this._lastError ? 'Clankermux !' : 'Clankermux …',
                style_class: this._lastError ? 'clankermux-panel-error' : 'clankermux-panel-loading',
            }));
            this.set_applet_tooltip(this._lastError || 'Loading Clankermux usage…');
            return;
        }

        this._panelContent.add_child(new St.Label({
            text: `${this._view.pool.routable}/${this._view.pool.configured}`,
            style_class: this._view.pool.routable === this._view.pool.configured
                ? 'clankermux-panel-accounts'
                : 'clankermux-panel-accounts warning',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        const barWidth = Math.max(30, Number(this.panelBarWidth || 52));
        for (const pool of this._view.usagePools)
            this._panelContent.add_child(createPanelMeter(pool, barWidth, this.showPanelPercentages !== false));
        if (!this._view.usagePools.length)
            this._panelContent.add_child(new St.Label({ text: 'quota –', style_class: 'clankermux-panel-loading' }));

        const lines = [
            `Clankermux: ${this._view.pool.routable} of ${this._view.pool.configured} accounts available`,
        ];
        for (const pool of this._view.usagePools) {
            const forecast = pool.forecastCount ? `projected ${pool.projectedPercent}% at reset` : 'forecast unavailable';
            lines.push(`${pool.label}: ${pool.usedPercent}% used · ${pool.remainingPercent}% left across ${pool.accountCount} · ${forecast}`);
        }
        if (this._lastError)
            lines.push(`Last refresh failed: ${this._lastError}`);
        else if (this._lastSuccess)
            lines.push(`Updated ${this._model.formatDuration(Date.now() - this._lastSuccess)} ago`);
        this.set_applet_tooltip(lines.join('\n'));
    }

    _renderMenu() {
        this.menu.removeAll();
        if (!this._accounts) {
            this.menu.addMenuItem(new InfoMenuItem(
                this._lastError ? 'Clankermux is unavailable' : 'Loading usage…',
                this._lastError || this._model.normalizeBaseUrl(this.apiUrl),
                this._lastError ? 'error' : ''
            ));
            this._addMenuActions();
            return;
        }

        let subtitle = `${this._view.pool.routable} of ${this._view.pool.configured} accounts available`;
        if (this._lastError)
            subtitle += ' · showing cached data';
        this.menu.addMenuItem(new InfoMenuItem('Clankermux usage', subtitle));
        if (this._view.usagePools.length)
            this.menu.addMenuItem(new PoolSummaryMenuItem(this._view.usagePools, this._model));
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        for (const account of this._view.accounts)
            this.menu.addMenuItem(new AccountMenuItem(account, this._model));

        if (!this._view.accounts.length)
            this.menu.addMenuItem(new InfoMenuItem('No accounts configured'));
        if (this._lastError)
            this.menu.addMenuItem(new InfoMenuItem('Refresh failed', this._lastError, 'error'));
        this._addMenuActions();
    }

    _addMenuActions() {
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const refreshItem = new PopupMenu.PopupIconMenuItem(
            this._refreshing ? 'Refreshing…' : 'Refresh now',
            'view-refresh-symbolic',
            St.IconType.SYMBOLIC
        );
        refreshItem.setSensitive(!this._refreshing);
        refreshItem.connect('activate', () => this._refresh());
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
        if (this._pollId) {
            Mainloop.source_remove(this._pollId);
            this._pollId = 0;
        }
        if (this._session)
            this._session.abort();
        if (this.settings)
            this.settings.finalize();
    }
}

function main(metadata, orientation, panelHeight, instanceId) {
    const model = FileUtils.requireModule('usageModel.js', metadata.path, metadata, 'applet');
    return new ClankermuxUsageApplet(metadata, orientation, panelHeight, instanceId, model);
}
