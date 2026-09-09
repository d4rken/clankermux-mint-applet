/* Pure data helpers shared by the Cinnamon applet and its Node test suite. */

var UsageModel = (() => {
    const DEFAULT_USAGE_WARNING_PCT = 80;
    const WORKLOAD_TARGETS = [
        { key: 'class:codex', label: 'GPT', icon: 'openai' },
        { key: 'class:anthropic', label: 'Claude', icon: 'anthropic' },
        { key: 'family:fable', label: 'Fable', icon: 'fable' },
    ];

    function clampNumber(value) {
        if (value === null || value === undefined || value === '')
            return null;
        const number = Number(value);
        if (!Number.isFinite(number))
            return null;
        return Math.max(0, Math.min(100, number));
    }

    function clampPercent(value) {
        const number = clampNumber(value);
        return number === null ? null : Math.round(number);
    }

    function timestampMs(value) {
        if (value === null || value === undefined || value === '')
            return null;
        if (typeof value === 'number')
            return Number.isFinite(new Date(value).getTime()) ? value : null;

        const text = String(value).trim();
        if (!text)
            return null;
        const numeric = Number(text);
        if (Number.isFinite(numeric))
            return Number.isFinite(new Date(numeric).getTime()) ? numeric : null;
        const parsed = Date.parse(text);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function anchoredNow(generatedAt, receivedAt, localNowMs) {
        const serverMs = timestampMs(generatedAt);
        const receivedMs = timestampMs(receivedAt);
        return serverMs === null || receivedMs === null ? localNowMs :
            serverMs + Math.max(0, localNowMs - receivedMs);
    }

    function normalizeBaseUrl(value) {
        let url = String(value || '').trim();
        if (!url)
            return '';
        if (!/^https?:\/\//i.test(url))
            url = `http://${url}`;
        return url.replace(/\/+$/, '');
    }

    function createRefreshCycle(requestCount = 1) {
        const parsedCount = Math.trunc(Number(requestCount));
        let remaining = Number.isFinite(parsedCount) && parsedCount > 0 ? parsedCount : 1;
        let settled = false;

        return {
            completeOne() {
                if (settled)
                    return false;
                remaining--;
                if (remaining > 0)
                    return false;
                settled = true;
                return true;
            },
            expire() {
                if (settled)
                    return false;
                settled = true;
                return true;
            },
        };
    }

    function humanizeStatus(value) {
        const text = String(value || '').replace(/_/g, ' ').trim();
        return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Unknown';
    }

    function _windowKey(window, index) {
        if (window.kind === 'five_hour' || window.kind === 'seven_day')
            return window.kind;
        const scope = String(window.scopeId || window.label || index).toLowerCase();
        return `scope:${scope}`;
    }

    function _windowLabel(window) {
        if (window.label)
            return String(window.label);
        if (window.kind === 'five_hour')
            return '5 hour';
        if (window.kind === 'seven_day')
            return '7 day';
        return humanizeStatus(window.scopeId || window.kind);
    }

    function _windowForecast(raw, measurementState, nowMs) {
        const unavailable = {
            forecastText: '—', forecastDescription: 'Forecast unavailable',
            forecastSeverity: 'unknown', forecastQuality: 'unavailable',
            exhaustsAt: null, willExhaust: null,
        };
        const forecast = raw?.forecast;
        const resetsMs = timestampMs(raw?.resetsAt);
        if (!forecast || measurementState !== 'fresh' || resetsMs !== null && resetsMs <= nowMs ||
            _staleTime(raw?.observedAt, nowMs))
            return unavailable;
        if (forecast.outcome === 'unknown') {
            const reasons = {
                no_usage: ['no usage', 'No usage measured'],
                unstarted: ['unstarted', 'Window has not started'],
                short_history: ['learning', 'Not enough consumption history'],
            };
            if (!Object.prototype.hasOwnProperty.call(reasons, forecast.reason))
                return unavailable;
            return { ...unavailable, forecastText: reasons[forecast.reason][0],
                forecastDescription: reasons[forecast.reason][1] };
        }
        if (!['supported', 'limited'].includes(forecast.quality) || forecast.reason != null || resetsMs === null)
            return unavailable;
        const exhausted = forecast.outcome === 'exhausted';
        const beforeReset = forecast.outcome === 'exhausts_before_reset';
        const exhaustsMs = timestampMs(forecast.exhaustsAt);
        if (!exhausted && !beforeReset && forecast.outcome !== 'lasts_until_reset')
            return unavailable;
        if (beforeReset && (exhaustsMs === null || exhaustsMs >= resetsMs))
            return unavailable;
        const willExhaust = exhausted || beforeReset;
        const limited = forecast.quality === 'limited';
        return {
            exhaustsAt: beforeReset ? forecast.exhaustsAt : null,
            willExhaust, forecastQuality: forecast.quality,
            forecastText: exhausted ? 'out' : beforeReset
                ? exhaustsMs <= nowMs ? 'out ~now' : `out ~${formatDuration(exhaustsMs - nowMs)}` : '—',
            forecastDescription: (limited ? 'Limited evidence: ' : '') +
                (exhausted ? 'Window quota exhausted' : beforeReset
                    ? `Estimated exhaustion ${formatTimestamp(exhaustsMs)}, before reset` : 'Projected to reach reset'),
            forecastSeverity: willExhaust ? limited ? 'warning' : 'critical' : 'unknown',
        };
    }

    function accountWindows(account, showScoped = true, warningThreshold = DEFAULT_USAGE_WARNING_PCT, nowMs = Date.now(), fetchFailed = false) {
        const windows = [];
        const measurementState = String(account?.measurementState || 'other').toLowerCase();
        for (const [index, raw] of (account?.windows || []).entries()) {
            const scoped = raw?.kind === 'weekly_scoped' || raw?.scopeId !== null && raw?.scopeId !== undefined;
            if (scoped && !showScoped)
                continue;

            const percent = clampPercent(raw?.utilizationPct);
            if (percent === null)
                continue;

            const forecast = _windowForecast(raw, fetchFailed ? 'stale' : measurementState, nowMs);
            const certainlyExhausts = percent >= 100 || forecast.willExhaust === true && forecast.forecastQuality === 'supported';
            const nearExhaustion = forecast.willExhaust === true || percent >= warningThreshold;

            windows.push({
                key: _windowKey(raw, index),
                kind: String(raw?.kind || 'other'),
                scopeId: raw?.scopeId ?? null,
                label: _windowLabel(raw || {}),
                percent,
                observedAt: raw?.observedAt || null,
                resetsAt: raw?.resetsAt || null,
                ...forecast,
                severity: certainlyExhausts ? 'critical' : nearExhaustion ? 'warning' : 'normal',
                stale: fetchFailed || measurementState === 'stale',
                scoped,
            });
        }
        return windows;
    }

    function accountState(account) {
        const availability = account?.availability || {};
        const state = String(availability.state || 'other').toLowerCase();
        const labels = {
            available: 'Available',
            paused: 'Paused',
            rate_limited: 'Rate limited',
            usage_exhausted: 'Usage exhausted',
            blocked: 'Blocked',
            other: 'Unknown availability',
        };
        const keys = {
            available: 'available',
            paused: 'paused',
            rate_limited: 'limited',
            usage_exhausted: 'limited',
            blocked: 'error',
            other: 'error',
        };
        let label = labels[state] || humanizeStatus(state);
        if (availability.reason)
            label += ` · ${humanizeStatus(availability.reason)}`;
        return {
            key: keys[state] || 'error',
            label,
            until: availability.availableAt || null,
        };
    }

    function credentialNotice(account) {
        const state = String(account?.credential?.state || 'other').toLowerCase();
        if (state === 'valid' || state === 'not_applicable')
            return null;
        if (state === 'refreshable')
            return { key: 'available', label: 'Credential refreshable' };
        return {
            key: 'error',
            label: state === 'other' ? 'Credential state unknown' : `Credential ${humanizeStatus(state).toLowerCase()}`,
        };
    }

    function measurementNotice(account) {
        const state = String(account?.measurementState || 'other').toLowerCase();
        if (state === 'fresh' || state === 'not_applicable')
            return null;
        const labels = {
            stale: 'cached usage',
            missing: 'usage missing',
            other: 'usage state unknown',
        };
        return labels[state] || `usage ${humanizeStatus(state).toLowerCase()}`;
    }

    function _poolSeverity(percent, warningThreshold) {
        if (percent === null)
            return 'normal';
        if (percent >= 100)
            return 'critical';
        return percent >= warningThreshold ? 'warning' : 'normal';
    }

    function providerUsageRows(accounts, showScoped = true, nowMs = Date.now(), fetchFailed = false) {
        return WORKLOAD_TARGETS.filter(target => showScoped || target.key !== 'family:fable').map(target => {
            const family = target.key === 'family:fable';
            const provider = target.key === 'class:codex' ? 'codex' : 'anthropic';
            const members = (accounts || []).filter(account => account.provider === provider &&
                String(account.measurementState || '').toLowerCase() !== 'not_applicable');
            const readings = members.map(account => {
                const window = (account.windows || []).find(w => family
                    ? w.kind === 'weekly_scoped' && w.scopeId === 'fable'
                    : w.kind === 'seven_day' && w.scopeId == null);
                const percent = clampNumber(window?.utilizationPct);
                const reset = timestampMs(window?.resetsAt);
                return { percent, stale: account.measurementState !== 'fresh' ||
                    _staleTime(window?.observedAt, nowMs) || reset !== null && reset <= nowMs };
            }).filter(reading => reading.percent !== null);
            const count = readings.length;
            const total = members.length;
            const percent = count ? Math.round(readings.reduce((sum, reading) => sum + reading.percent, 0) / count) : null;
            const stale = fetchFailed || readings.some(reading => reading.stale);
            const partial = count < total;
            const valueText = percent === null ? total ? '?' : 'None' : `${percent}%${stale || partial ? '*' : ''}`;
            const tooltip = `${target.label}: ${percent === null ? 'usage unavailable' : `${percent}% weekly used`} · ${count}/${total} accounts` +
                (partial ? ' · partial' : '') + (stale ? ' · cached' : '');
            return { ...target, percent, valueText, tooltip, stale, partial, accountCount: count, totalAccounts: total,
                severity: stale || partial || percent === null ? 'unknown' : _poolSeverity(percent, DEFAULT_USAGE_WARNING_PCT) };
        });
    }

    function _staleTime(value, nowMs) {
        const time = timestampMs(value);
        return time === null || time > nowMs + 60000 || nowMs - time >= 180000;
    }

    function _count(value) {
        return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
    }

    function _coverage(raw) {
        const keys = ['eligibleAccounts', 'modeledAccounts', 'idleAccounts', 'learningAccounts', 'unavailableAccounts'];
        const values = keys.map(key => _count(raw?.[key]));
        if (values.some(value => value === null) || values[0] !== values.slice(1).reduce((sum, value) => sum + value, 0))
            return { valid: false, text: 'coverage unknown', complete: false };
        const counts = Object.fromEntries(keys.map((key, i) => [key, values[i]]));
        const parts = [`${counts.modeledAccounts}/${counts.eligibleAccounts} modeled`];
        if (counts.idleAccounts) parts.push(`${counts.idleAccounts} idle`);
        if (counts.learningAccounts) parts.push(`${counts.learningAccounts} learning`);
        if (counts.unavailableAccounts) parts.push(`${counts.unavailableAccounts} unavailable`);
        return { ...counts, valid: true, complete: counts.modeledAccounts === counts.eligibleAccounts, text: parts.join(' · ') };
    }

    function _availability(raw, nowMs, failed) {
        const counts = ['availableAccounts', 'constrainedAccounts', 'unknownAccounts'].map(key => _count(raw?.[key]));
        const stale = Boolean(raw) && (failed || _staleTime(raw.computedAt, nowMs));
        if (!raw || counts.some(value => value === null) || raw.context !== 'fresh_unpinned_nominal')
            return { text: 'unavailable', detail: 'Availability unavailable', stale };
        if (stale)
            return { text: 'stale', detail: 'Availability stale', stale };
        const [available, constrained, unknown] = counts;
        const recovery = timestampMs(raw.nextRecoveryAt);
        const detail = `${available} available now · ${constrained} constrained · ${unknown} unknown` +
            (recovery !== null ? recovery <= nowMs ? ' · recovery due' : ` · recovery ~${formatDuration(recovery - nowMs)}` : '');
        return { text: `${available}${unknown ? ' + ?' : ''}`, detail, stale: false,
            availableAccounts: available, constrainedAccounts: constrained, unknownAccounts: unknown, nextRecoveryAt: raw.nextRecoveryAt };
    }

    function _weekly(raw, nowMs, failed) {
        const coverage = _coverage(raw?.coverage);
        const endsAt = timestampMs(raw?.period?.endsAt);
        const startsAt = timestampMs(raw?.period?.startsAt);
        const expired = endsAt !== null && endsAt <= nowMs;
        const periodKnown = startsAt !== null && endsAt !== null && startsAt < endsAt &&
            startsAt <= nowMs + 60000 && raw?.period?.endReason === 'next_weekly_reset';
        const stale = Boolean(raw) && (failed || _staleTime(raw.computedAt, nowMs) ||
            (coverage.eligibleAccounts > 0 && _staleTime(raw.evidenceObservedAt, nowMs)));
        const result = { valueText: 'Unavailable', panelText: '?', severity: 'unknown', percent: null,
            coverage, expired, stale, resetsAt: raw?.period?.endsAt || null, exhaustsAt: null,
            reason: raw?.reason || null, paceReason: raw?.pace?.reason || null,
            outcome: raw?.outcome || 'unknown', quality: raw?.quality || 'unavailable',
            qualification: raw?.pace?.qualification || null, paceState: raw?.pace?.state || null };
        if (!raw) return result;
        if (expired) return { ...result, valueText: 'Expired', panelText: 'Stale' };
        if (stale) return { ...result, valueText: 'Stale', panelText: 'Stale' };
        if (raw.outcome === 'no_accounts') return { ...result, valueText: 'No active accounts', panelText: 'None' };
        if (raw.outcome === 'not_applicable') return { ...result, valueText: 'No weekly quota', panelText: '—' };
        if (!periodKnown) return { ...result, reason: 'no_deadline' };
        if (!['supported', 'limited'].includes(raw.quality) || !coverage.valid)
            return result;
        const subset = coverage.complete ? '' : 'Subset ';
        if (raw.outcome === 'exhausted') {
            result.valueText = subset ? 'Subset exhausted' : 'Weekly exhausted';
            result.panelText = coverage.complete ? 'Out' : 'Risk';
            result.severity = coverage.complete && raw.quality === 'supported' ? 'critical' : 'warning';
        } else if (raw.outcome === 'exhausts_before_end') {
            const exhaustion = timestampMs(raw.exhaustsAt);
            if (exhaustion === null || exhaustion >= endsAt) return result;
            result.valueText = subset ? 'Subset risk' : 'Weekly risk';
            result.panelText = 'Risk';
            result.exhaustsAt = raw.exhaustsAt;
            result.severity = 'warning';
        } else if (raw.outcome === 'lasts_until_end') {
            result.valueText = subset ? 'Subset reaches reset' : 'Reaches reset';
            result.panelText = 'Holds';
        } else {
            return result;
        }
        result.limited = raw.quality === 'limited';
        const pace = raw.pace;
        if (raw.quality !== 'supported' || !coverage.complete || !coverage.modeledAccounts ||
            !['estimate', 'conservative_bound'].includes(pace?.qualification)) return result;
        if (pace.state === 'estimate' && pace.reason == null &&
            typeof pace.changePct === 'number' && Number.isFinite(pace.changePct) && pace.changePct >= -100 &&
            ['exhausts_before_end', 'lasts_until_end'].includes(raw.outcome)) {
            result.percent = pace.changePct;
            const percent = Number(Math.abs(pace.changePct).toPrecision(3));
            const suffix = pace.qualification === 'conservative_bound' ? '*' : '';
            result.panelText = pace.changePct === 0 ? `~0% pace${suffix}` :
                `${pace.changePct > 0 ? '↑' : '↓'} ~${percent}% ${pace.changePct > 0 ? 'room' : 'pace'}${suffix}`;
        } else if (pace.state === 'increase_limit' && raw.outcome === 'lasts_until_end') {
            result.panelText = 'Room';
            result.paceNote = 'Tested increase fits';
        } else if (pace.state === 'reduction_limit' && raw.outcome === 'exhausts_before_end') {
            result.panelText = 'Risk';
            result.paceNote = 'Tested cut insufficient';
        }
        return result;
    }

    function workloadsView(payload, nowMs = Date.now(), failed = false, showScoped = true) {
        const workloads = Array.isArray(payload?.workloads) ? payload.workloads : [];
        return WORKLOAD_TARGETS.filter(target => target.key !== 'family:fable' ||
            showScoped && workloads.some(row => row?.id === target.key)).map(target => {
            const raw = workloads.find(row => row?.id === target.key);
            return { ...target, ..._weekly(raw?.weekly, nowMs, failed),
                availability: _availability(raw?.availability, nowMs, failed),
                parentWorkloadId: typeof raw?.parentWorkloadId === 'string' ? raw.parentWorkloadId : null };
        });
    }

    function panelWorkloadLabel(row) {
        return row?.panelText || '?';
    }

    function forecastSummary(row, nowMs = Date.now()) {
        const pace = row.percent === null ? '' : ` · ${row.panelText.replace(/\*$/, '')}${row.qualification === 'conservative_bound' ? ' (bound)' : ''}`;
        let text = `${row.label}: ${row.valueText}${pace}`;
        if (!row.stale && !row.expired && row.exhaustsAt) {
            const exhaustsMs = timestampMs(row.exhaustsAt);
            text += exhaustsMs <= nowMs ? ' ~now' : ` ~${formatDuration(exhaustsMs - nowMs)}`;
        }
        if (row.limited) text += ' · limited';
        if (row.coverage?.valid && row.coverage.eligibleAccounts > 0)
            text += ` · ${row.coverage.text}`;
        return text;
    }

    function workloadTooltipLine(row) {
        const reasons = {
            no_deadline: 'Next reset unavailable', partial_coverage: 'Partial weekly coverage',
            weak_evidence: 'Weak evidence', limited_evidence: 'Limited evidence', missing_evidence: 'Missing evidence',
            unsupported_credits: 'Family bound unavailable with credits', not_projected: 'No pace estimate',
            search_unavailable: 'Pace search unavailable', reset_elapsed: 'Reset elapsed',
        };
        const reason = row.paceReason || row.reason;
        return `${row.label}: ${row.percent !== null ? row.panelText : row.valueText}` +
            (row.limited ? ' · limited evidence' : '') +
            (row.paceNote ? ` · ${row.paceNote}` : '') +
            (row.coverage?.valid ? ` · ${row.coverage.text}` : ' · coverage unknown') +
            (reason && !(row.limited && reason === 'limited_evidence') ? ` · ${reasons[reason] || 'Estimate unavailable'}` : '') +
            `\n  Now: ${row.availability.detail}` +
            (row.parentWorkloadId ? ` · overlaps ${row.parentWorkloadId === 'class:anthropic' ? 'Claude' : row.parentWorkloadId}` : '');
    }

    function buildView(accounts, status, workloads, options = {}, nowMs = Date.now()) {
        const accountsNowMs = anchoredNow(options.accountsGeneratedAt, options.accountsReceivedAt, nowMs);
        const workloadsNowMs = anchoredNow(options.workloadsGeneratedAt, options.workloadsReceivedAt, nowMs);
        const list = Array.isArray(accounts) ? accounts : [];
        const mapped = list.map((account, index) => {
            const state = accountState(account);
            const credential = credentialNotice(account);
            return {
                id: account.id || account.name || String(index), name: account.name || `Account ${index + 1}`,
                provider: humanizeStatus(account.provider || 'unknown'), state,
                stateClass: credential?.key === 'error' ? 'error' : state.key,
                credential, measurementNotice: measurementNotice(account) || (options.accountsFetchFailed ? 'cached usage' : null),
                stale: Boolean(options.accountsFetchFailed) || account.measurementState === 'stale',
                windows: accountWindows(account, options.showScoped !== false, DEFAULT_USAGE_WARNING_PCT, accountsNowMs, options.accountsFetchFailed),
            };
        });
        const paceRows = workloadsView(workloads, workloadsNowMs, options.workloadsFetchFailed, options.showScoped !== false);
        return {
            nowMs: accountsNowMs, workloadsNowMs, accounts: mapped, paceRows,
            providerUsageRows: providerUsageRows(list, options.showScoped !== false, accountsNowMs, options.accountsFetchFailed)
                .filter(row => row.key !== 'family:fable' || paceRows.some(workload => workload.key === row.key)),
            pool: { configured: _count(status?.accounts?.configured), paused: _count(status?.accounts?.paused) },
            serviceState: typeof status?.serviceState === 'string' ? status.serviceState : 'unknown',
        };
    }

    function formatDuration(milliseconds) {
        let minutes = Math.max(0, Math.round(milliseconds / 60000));
        if (minutes < 1)
            return '<1m';
        if (minutes < 60)
            return `${minutes}m`;
        const hours = Math.floor(minutes / 60);
        minutes %= 60;
        if (hours < 24)
            return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
        const days = Math.floor(hours / 24);
        const remainingHours = hours % 24;
        return remainingHours ? `${days}d ${remainingHours}h` : `${days}d`;
    }

    function formatTimestamp(value) {
        const timestamp = timestampMs(value);
        if (!Number.isFinite(timestamp))
            return '';

        const date = new Date(timestamp);
        const pad = number => String(number).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
            `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    }

    function formatReset(value, nowMs = Date.now()) {
        const timestamp = timestampMs(value);
        if (!Number.isFinite(timestamp))
            return '';
        if (timestamp <= nowMs)
            return 'reset due';
        return `in ${formatDuration(timestamp - nowMs)}`;
    }

    return {
        accountState, accountWindows, buildView, clampPercent,
        createRefreshCycle, credentialNotice, formatDuration, formatReset,
        formatTimestamp, humanizeStatus, measurementNotice, normalizeBaseUrl,
        panelWorkloadLabel, providerUsageRows, forecastSummary, workloadTooltipLine,
        workloadsView, timestampMs,
    };
})();

if (typeof module !== 'undefined' && module.exports)
    module.exports = UsageModel;
