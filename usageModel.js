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

    function finiteNumber(value) {
        if (value === null || value === undefined || value === '')
            return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function nonNegativeCount(value) {
        const number = finiteNumber(value);
        return number === null ? 0 : Math.max(0, Math.trunc(number));
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

    function anchoredNow(generatedAt, receivedAt, localNowMs = Date.now()) {
        const serverMs = timestampMs(generatedAt);
        const receivedMs = timestampMs(receivedAt);
        if (serverMs === null || receivedMs === null)
            return localNowMs;
        return serverMs + Math.max(0, localNowMs - receivedMs);
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
            forecastSeverity: 'unknown', forecastConfidence: 'unknown',
            exhaustsAt: null, willExhaust: null,
        };
        const forecast = raw?.forecast;
        const resetsMs = timestampMs(raw?.resetsAt);
        if (!forecast || measurementState !== 'fresh' || resetsMs !== null && resetsMs <= nowMs)
            return unavailable;
        if (forecast.state === 'learning') {
            const reasons = {
                no_usage: 'No usage measured',
                unstarted: 'Window has not started',
                short_history: 'Not enough consumption history',
            };
            if (!Object.prototype.hasOwnProperty.call(reasons, forecast.reason))
                return unavailable;
            const labels = { no_usage: 'no usage', unstarted: 'unstarted', short_history: 'learning' };
            return { ...unavailable, forecastText: labels[forecast.reason], forecastDescription: reasons[forecast.reason] };
        }
        if (forecast.state !== 'projected' || forecast.reason != null ||
            resetsMs === null || timestampMs(raw?.observedAt) === null)
            return unavailable;
        const exhaustsMs = timestampMs(forecast.exhaustsAt);
        if (forecast.exhaustsAt != null && exhaustsMs === null)
            return unavailable;
        const willExhaust = exhaustsMs !== null && exhaustsMs < resetsMs;
        const lowConfidence = forecast.lowConfidence !== false;
        return {
            exhaustsAt: exhaustsMs === null ? null : forecast.exhaustsAt,
            willExhaust,
            forecastConfidence: lowConfidence ? 'low' : 'high',
            forecastText: willExhaust
                ? exhaustsMs <= nowMs ? 'out ~now' : `out ~${formatDuration(exhaustsMs - nowMs)}` : '—',
            forecastDescription: (lowConfidence ? 'Low-confidence estimate: ' : '') +
                (willExhaust ? `exhaustion ${formatTimestamp(exhaustsMs)}, before reset` :
                    exhaustsMs === null ? 'No exhaustion estimated' : 'Reset precedes estimated exhaustion'),
            forecastSeverity: willExhaust ? lowConfidence ? 'warning' : 'critical' : 'unknown',
        };
    }

    function accountWindows(account, showScoped = true, warningThreshold = DEFAULT_USAGE_WARNING_PCT, nowMs = Date.now()) {
        const windows = [];
        const measurementState = String(account?.measurementState || 'other').toLowerCase();
        for (const [index, raw] of (account?.windows || []).entries()) {
            const scoped = raw?.kind === 'weekly_scoped' || raw?.scopeId !== null && raw?.scopeId !== undefined;
            if (scoped && !showScoped)
                continue;

            const percent = clampPercent(raw?.utilizationPct);
            if (percent === null)
                continue;

            const forecast = _windowForecast(raw, measurementState, nowMs);
            const certainlyExhausts = percent >= 100 || forecast.willExhaust === true && forecast.forecastConfidence === 'high';
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
                stale: measurementState === 'stale',
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

    function toneSeverity(tone) {
        switch (String(tone || 'other')) {
            case 'success':
            case 'neutral':
                return 'normal';
            case 'destructive':
                return 'critical';
            case 'warning':
            case 'other':
            default:
                return 'warning';
        }
    }

    function _poolSeverity(percent, warningThreshold) {
        if (percent === null)
            return 'normal';
        if (percent >= 100)
            return 'critical';
        return percent >= warningThreshold ? 'warning' : 'normal';
    }

    function _usagePool(key, label, aggregate, scoped, warningThreshold, provider = null) {
        const usedPercent = clampPercent(aggregate?.meanUtilizationPct);
        if (usedPercent === null)
            return null;
        return {
            key,
            label,
            scoped,
            provider,
            usedPercent,
            remainingPercent: 100 - usedPercent,
            accountCount: Math.max(0, Number(aggregate?.contributingAccountCount || 0)),
            unknownCount: Math.max(0, Number(aggregate?.unknownAccountCount || 0)),
            nextResetAt: aggregate?.earliestResetsAt || null,
            severity: _poolSeverity(usedPercent, warningThreshold),
        };
    }

    function usagePools(status, showScoped = true, warningThreshold = DEFAULT_USAGE_WARNING_PCT) {
        const pools = [];
        const fiveHour = _usagePool(
            'five_hour', '5h', status?.usage?.fiveHour, false, warningThreshold
        );
        const sevenDay = _usagePool(
            'seven_day', '7d', status?.usage?.sevenDay, false, warningThreshold
        );
        if (fiveHour)
            pools.push(fiveHour);
        if (sevenDay)
            pools.push(sevenDay);

        if (showScoped) {
            for (const provider of status?.providers || []) {
                for (const limit of provider?.scopedLimits || []) {
                    const scopeId = String(limit?.scopeId || 'other');
                    const pool = _usagePool(
                        `scope:${provider.provider}:${scopeId}`,
                        String(limit?.label || humanizeStatus(scopeId)),
                        limit,
                        true,
                        warningThreshold,
                        provider.provider
                    );
                    if (pool)
                        pools.push(pool);
                }
            }
        }
        return pools;
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
                    timestampMs(window?.observedAt) === null || reset !== null && reset <= nowMs };
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

    function providerOverloads(status, accounts = []) {
        const result = [];
        for (const provider of status?.providers || []) {
            const any = provider?.anyOverload || {};
            const state = String(any.state || 'other');
            if (state === 'closed')
                continue;
            const wideState = String(provider?.providerWideOverload?.state || 'closed');
            result.push({
                key: String(provider.provider || 'provider'),
                provider: humanizeStatus(provider.provider || 'provider'),
                state,
                until: any.until || null,
                probeActive: Boolean(any.probeActive),
                providerWide: wideState !== 'closed',
                accountCount: accounts.filter(account => account?.provider === provider.provider).length,
            });
        }
        return result.sort((left, right) => left.provider.localeCompare(right.provider));
    }

    function _neutralSignal(summary, action = 'NO READING') {
        return {
            action, valueText: '–', side: 'none', fillPercent: 0,
            severity: 'unknown', percent: null, direction: null, summary,
        };
    }

    function forecastFreshness(payload, nowMs = Date.now(), fetchFailed = false) {
        const generatedMs = timestampMs(payload?.generatedAt);
        const ageMs = generatedMs === null ? null : Math.max(0, nowMs - generatedMs);
        const stale = Boolean(payload) && (fetchFailed || ageMs === null || ageMs >= 180000);
        const timestamp = formatTimestamp(payload?.generatedAt);
        return {
            generatedAt: timestamp ? payload.generatedAt : null,
            ageMs,
            stale,
            freshnessText: `${stale ? 'Stale · ' : ''}Forecast computed: ${timestamp || 'unknown'}`,
        };
    }

    function _staleSignal(signal) {
        return {
            ..._neutralSignal(`Stale · Last reading: ${signal.valueText} · ${signal.summary}`, 'STALE'),
            valueText: 'Stale',
        };
    }

    function _paceSignal(outcomeKind, rawPercent, rawDirection) {
        const kind = String(outcomeKind || 'unknown');
        if (kind === 'no_accounts')
            return _neutralSignal('No active accounts for this workload', 'NO ACCOUNTS');
        if (!['beyond_horizon', 'runway', 'out_now'].includes(kind))
            return _neutralSignal('Forecast unavailable');
        if (kind === 'out_now') {
            return {
                action: 'OUT', valueText: 'OUT', side: 'left', fillPercent: 100,
                severity: 'critical', percent: null, direction: null,
                summary: 'Available modeled capacity exhausted',
            };
        }
        const direction = String(rawDirection || '');
        const percent = typeof rawPercent === 'number' && Number.isFinite(rawPercent) && rawPercent >= 0
            ? Math.round(rawPercent) : null;
        if (percent !== null && direction === 'margin' && kind === 'beyond_horizon') {
            return {
                action: 'ROOM', valueText: `+${percent}%`, side: 'right',
                fillPercent: Math.min(100, percent * 2), severity: 'normal', percent, direction,
                summary: `${percent}% pace margin`,
            };
        }
        if (percent !== null && direction === 'deficit' && kind === 'runway') {
            return {
                action: 'CUT', valueText: `−${percent}%`, side: 'left',
                fillPercent: Math.min(100, percent * 2), severity: 'warning', percent, direction,
                summary: `Reduce pace by ${percent}% if this burn continues`,
            };
        }
        if (rawPercent != null || (direction && !['margin', 'deficit'].includes(direction)))
            return _neutralSignal('Headroom value, direction or outcome is not recognized');
        return kind === 'beyond_horizon'
            ? _neutralSignal('Projected to reach the stated model horizon · Pace margin unavailable', 'REACHES HORIZON')
            : _neutralSignal('May exhaust before the stated model horizon · Required cut unavailable', 'MAY EXHAUST');
    }

    function _runwayCoverage(runway) {
        if (!runway?.coverage) {
            return {
                activeKeyCount: 0,
                statedKeyCount: 0,
                unobservedKeyCount: 0,
                complete: false,
                text: 'Runway unavailable',
            };
        }
        const coverage = {
            activeKeyCount: nonNegativeCount(runway?.coverage?.activeKeyCount),
            statedKeyCount: nonNegativeCount(runway?.coverage?.statedKeyCount),
            unobservedKeyCount: nonNegativeCount(runway?.coverage?.unobservedKeyCount),
        };
        coverage.complete = coverage.unobservedKeyCount === 0 &&
            coverage.statedKeyCount === coverage.activeKeyCount;
        coverage.text = coverage.activeKeyCount
            ? `${coverage.statedKeyCount} of ${coverage.activeKeyCount} active keys observed` +
                (coverage.unobservedKeyCount ? ` · ${coverage.unobservedKeyCount} unobserved` : '')
            : 'No active API keys';
        return coverage;
    }

    function paceView(runway, localNowMs = Date.now(), receivedAt = null, fetchFailed = false) {
        const outcome = runway?.worstStatedOutcome || null;
        const coverage = _runwayCoverage(runway);
        const hasHeadroomFields = Boolean(outcome) &&
            Object.prototype.hasOwnProperty.call(outcome, 'headroomPct') &&
            Object.prototype.hasOwnProperty.call(outcome, 'headroomDirection');
        let signal = hasHeadroomFields
            ? _paceSignal(outcome.kind, outcome.headroomPct, outcome.headroomDirection)
            : _paceSignal('unknown', null, null);
        const freshness = forecastFreshness(runway, localNowMs, fetchFailed);
        if (freshness.stale)
            signal = _staleSignal(signal);
        const incomplete = Boolean(runway) && !coverage.complete;
        return {
            ...signal,
            action: `${signal.action}${incomplete ? '*' : ''}`,
            incomplete,
            coverage,
            coverageText: coverage.text,
            ...freshness,
            available: Boolean(runway),
        };
    }

    function _guidanceSignal(raw, basis, intervalKnown) {
        const neutral = (valueText, summary = valueText) => ({
            ..._neutralSignal(summary), valueText,
        });
        if (!intervalKnown)
            return neutral('Unknown', 'Forecast interval unavailable');
        if (raw?.guidanceState === undefined)
            return neutral('Unknown', 'Server does not provide guidance states');
        switch (raw.guidanceState) {
        case 'learning': return neutral('Learning', 'All eligible accounts are learning their burn');
        case 'uncertain': return neutral('Limited evidence', 'Weak evidence or incomplete account coverage');
        case 'no_accounts': return neutral('No accounts', 'No active accounts for this workload');
        case 'exhausted':
            return { ...neutral('Out', 'Modelled quota exhausted with complete coverage'), severity: 'critical' };
        case 'unquantified':
            if (raw.outcomeKind === 'beyond_horizon')
                return neutral('Reaches deadline', 'Projected to reach the deadline; numeric adjustment unavailable');
            if (raw.outcomeKind === 'runway')
                return { ...neutral('May run out', 'May exhaust before the deadline; required cut unavailable'), severity: 'warning' };
            return neutral('Unknown', 'Forecast outcome unavailable');
        case 'increase':
        case 'reduce': {
            const increase = raw.guidanceState === 'increase';
            const percent = raw.headroomPct;
            if (raw.projectionBasis !== 'measured' || !['exact', 'bound'].includes(basis) ||
                typeof percent !== 'number' || !Number.isFinite(percent) || percent <= 0 ||
                raw.headroomDirection !== (increase ? 'margin' : 'deficit') ||
                raw.outcomeKind !== (increase ? 'beyond_horizon' : 'runway'))
                return neutral('Unknown', 'Guidance fields are inconsistent or unavailable');
            const rounded = Number(percent.toPrecision(3));
            const valueText = `${increase ? '↑' : '↓'} ~${rounded}% ${increase ? 'room' : 'pace'}${basis === 'bound' ? '*' : ''}`;
            return {
                ...neutral(valueText, `${increase ? 'Room to increase work rate by' : 'Reduce work rate by'} roughly ${rounded}%` +
                    (basis === 'bound' ? ' (conservative bound)' : ' (approximate model threshold)')),
                action: increase ? 'ROOM' : 'CUT', percent, direction: raw.headroomDirection,
                severity: increase ? 'normal' : 'warning',
            };
        }
        default: return neutral('Unknown', 'Forecast unavailable');
        }
    }

    function _headroomAbsenceText(reason) {
        const reasons = {
            learning_accounts: 'Some accounts are still learning their burn',
            structural_evidence: 'Observation evidence is insufficient',
            bound_broken_by_credits: 'Modelled reset credits prevent a reliable family bound',
            beyond_probe_range: 'Numeric adjustment is outside the model probe range',
            not_projected: 'No numeric adjustment was projected',
            other: 'Numeric adjustment is unavailable',
        };
        return Object.prototype.hasOwnProperty.call(reasons, reason)
            ? reasons[reason] : reason ? 'Numeric adjustment is unavailable' : '';
    }

    function _workloadForecast(raw, basis, nextReset, freshness, intervalKnown) {
        let signal = _guidanceSignal(raw, basis, intervalKnown);
        if (nextReset && signal.valueText === 'Reaches deadline')
            signal.valueText = 'Reaches reset';
        const exhaustsAt = raw?.outcomeKind === 'runway' && timestampMs(raw?.exhaustsAt) !== null
            ? raw.exhaustsAt : null;
        const absenceText = _headroomAbsenceText(raw?.headroomAbsence);
        if (absenceText && signal.percent === null)
            signal.summary += `\n${absenceText}`;
        if (exhaustsAt) {
            const qualified = signal.percent !== null ||
                (signal.valueText === 'May run out' && raw.projectionBasis === 'measured');
            signal.summary += `\n${qualified ? 'Projected exhaustion' : 'Unverified exhaustion estimate'}: ${formatTimestamp(exhaustsAt)}`;
        }
        if (raw?.guidanceState === undefined) {
            const outcome = { beyond_horizon: 'projected to reach deadline', runway: 'may exhaust before deadline',
                out_now: 'modelled quota exhausted', no_accounts: 'no active accounts' }[raw?.outcomeKind];
            if (outcome)
                signal.summary += `\nRaw forecast (legacy server): ${outcome}; evidence: ${raw?.projectionBasis || 'unknown'}`;
        }
        if (freshness.stale)
            signal = _staleSignal(signal);
        return {
            ...signal, ...freshness,
            guidanceState: raw?.guidanceState || null,
            headroomAbsence: raw?.headroomAbsence || null,
            outcomeKind: String(raw?.outcomeKind || 'unknown'), exhaustsAt,
            projectionBasis: raw?.projectionBasis || null,
        };
    }

    function workloadHeadroomView(payload, localNowMs = Date.now(), receivedAt = null, fetchFailed = false) {
        const freshness = forecastFreshness(payload, localNowMs, fetchFailed);
        const horizonMs = Math.max(0, finiteNumber(payload?.horizonMs) || 0);
        const horizonDays = horizonMs / 86400000;
        const horizonText = horizonMs ? `${Number(horizonDays.toFixed(2))} days` : 'unknown horizon';
        const rows = [];
        for (const raw of payload?.rows || []) {
            if (!['class', 'family'].includes(raw?.dimensionKind) ||
                typeof raw.dimensionId !== 'string' || !raw.dimensionId)
                continue;
            const basis = raw?.headroomBasis === 'exact' ? 'exact' :
                raw?.headroomBasis === 'conservative_bound' ? 'bound' : 'other';
            const eligibleAccounts = nonNegativeCount(raw?.eligibleAccounts);
            const unreadableAccounts = nonNegativeCount(raw?.unreadableAccounts);
            const unopenedAccounts = raw.dimensionKind === 'family'
                ? Math.min(unreadableAccounts, nonNegativeCount(raw?.unopenedAccounts)) : 0;
            const otherExcludedAccounts = unreadableAccounts - unopenedAccounts;
            const target = WORKLOAD_TARGETS.find(item => item.key === `${raw.dimensionKind}:${raw.dimensionId}`);
            const label = target?.label || String(raw.label || humanizeStatus(raw.dimensionId));
            const unopenedText = unopenedAccounts
                ? `${unopenedAccounts} ${unopenedAccounts === 1 ? 'account has' : 'accounts have'} not used ${label} this week` : '';
            const spentAccounts = nonNegativeCount(raw?.spentAccounts);
            const learningAccounts = nonNegativeCount(raw?.learningAccounts);
            const depth = [`${eligibleAccounts} eligible`];
            if (otherExcludedAccounts)
                depth.push(`${otherExcludedAccounts} unreadable`);
            if (unopenedAccounts)
                depth.push(`${unopenedAccounts} unopened`);
            if (learningAccounts)
                depth.push(`${learningAccounts} learning`);
            if (spentAccounts)
                depth.push(`${spentAccounts} spent`);
            const longTerm = {
                ..._workloadForecast(raw, basis, false, freshness, horizonMs > 0 &&
                    (payload.intervalKind === undefined || payload.intervalKind === 'fixed_horizon')),
                intervalLabel: `Long-term pace · ${horizonText}`,
                headroomAbsence: raw?.headroomAbsence || null,
            };
            const resetsMs = timestampMs(raw?.nextReset?.resetsAt);
            const expired = resetsMs !== null && resetsMs <= localNowMs;
            const validReset = resetsMs !== null && !expired;
            let primary = validReset
                ? _workloadForecast(raw.nextReset, basis, true, freshness,
                    raw.nextReset.intervalKind === undefined || raw.nextReset.intervalKind === 'until_next_weekly_reset')
                : {
                    ..._neutralSignal(expired ? 'Next-reset forecast expired' : 'Next-reset forecast unavailable',
                        expired ? 'EXPIRED' : 'NO READING'),
                    valueText: expired ? 'Expired' : 'Unavailable',
                    ...freshness,
                };
            if (!validReset && freshness.stale)
                Object.assign(primary, _staleSignal(primary));
            rows.push({
                ...primary,
                key: `${raw.dimensionKind}:${raw.dimensionId}`,
                dimensionKind: raw.dimensionKind,
                dimensionId: raw.dimensionId,
                label,
                basis,
                basisLabel: basis === 'exact' ? 'Exact threshold' :
                    basis === 'bound' ? 'Conservative bound' : 'Unknown basis',
                eligibleAccounts, unreadableAccounts, unopenedAccounts, otherExcludedAccounts, spentAccounts, learningAccounts,
                paceProbe: payload?.paceProbe || null,
                unopenedText,
                incomplete: unreadableAccounts > 0,
                depthText: depth.join(' · '),
                coverageCaveat: unreadableAccounts > 0
                    ? 'Incomplete coverage; exhaustion estimates are lower bounds on runway' : '',
                intervalLabel: 'Until next weekly reset',
                resetsAt: resetsMs === null ? null : raw.nextReset.resetsAt,
                resetText: resetsMs === null ? '' : `${formatTimestamp(resetsMs)} (${expired ? 'expired' : formatReset(resetsMs, localNowMs)})`,
                expired,
                longTerm,
            });
        }
        return {
            rows, horizonMs, horizonText, ...freshness,
            available: Boolean(payload),
        };
    }

    function panelWorkloadLabel(signal) {
        if (signal?.stale || signal?.expired)
            return 'Stale';
        switch (signal?.valueText) {
        case 'Learning': return 'Learn';
        case 'Limited evidence': return signal.learningAccounts > 0 &&
            signal.learningAccounts === signal.unreadableAccounts && signal.projectionBasis === 'measured' &&
            ['learning_accounts', 'beyond_probe_range', null].includes(signal.headroomAbsence) ? 'Learn' : '?';
        case 'Unknown':
        case 'Unavailable': return '?';
        case 'No accounts': return 'None';
        case 'May run out': return 'Risk';
        case 'Reaches reset': return 'Holds';
        case 'Out': return 'Out';
        default: return signal?.percent != null ? signal.valueText : '?';
        }
    }

    function workloadTooltipLine(row) {
        const parts = [`${row.label}: ${row.valueText}`];
        if (row.stale || row.expired)
            return parts[0];
        if (row.unreadableAccounts > 0 || row.learningAccounts > 0) {
            parts.push(`${Math.max(0, row.eligibleAccounts - row.unreadableAccounts)}/${row.eligibleAccounts} modeled`);
            if (row.learningAccounts > 0)
                parts.push(`${row.learningAccounts} learning`);
        }
        if (row.headroomAbsence === 'beyond_probe_range') {
            const reduction = row.outcomeKind === 'runway';
            const limit = row.paceProbe?.[reduction ? 'maximumReductionPct' : 'maximumIncreasePct'];
            if (['runway', 'beyond_horizon'].includes(row.outcomeKind) &&
                typeof limit === 'number' && Number.isFinite(limit) && limit > 0 && (!reduction || limit <= 100))
                parts.push(reduction ? `modeled out even at −${limit}% rate` : `no failure at tested +${limit}% rate`);
            else
                parts.push('outside tested pace range');
        }
        if (row.basis === 'bound' && row.headroomAbsence === 'beyond_probe_range')
            parts.push('family bound');
        return parts.join(' · ');
    }

    function forecastSummary(row, nowMs = Date.now()) {
        let headline = `${row.label}: ${row.valueText}`;
        if (row.stale || row.expired)
            return headline;
        if (row.basis === 'bound' && row.percent != null)
            headline = headline.replace(/\*$/, '') + ' (bound)';
        const exhaustsMs = timestampMs(row.exhaustsAt);
        const resetsMs = timestampMs(row.resetsAt);
        if (row.valueText === 'May run out' && exhaustsMs !== null && resetsMs !== null && exhaustsMs < resetsMs)
            headline += exhaustsMs <= nowMs ? ' ~now' : ` ~${formatDuration(exhaustsMs - nowMs)}`;
        if (Number.isFinite(row.eligibleAccounts) && (row.unreadableAccounts > 0 || row.learningAccounts > 0))
            headline += ` · ${Math.max(0, row.eligibleAccounts - row.unreadableAccounts)}/${row.eligibleAccounts} modeled`;
        if (row.learningAccounts > 0)
            headline += ` · ${row.learningAccounts} learning`;
        return headline;
    }

    function _accountName(accountId, accounts) {
        if (!accountId)
            return null;
        return accounts.find(account => account.id === accountId)?.name || 'Unknown account';
    }

    function _burnRatioText(value) {
        const ratio = finiteNumber(value);
        if (ratio === null)
            return 'Pace not stated';
        const formatted = ratio.toFixed(2).replace(/0$/, '');
        return `${formatted}× even weekly spending (least-used account)`;
    }

    function pacingView(payload, accounts = [], localNowMs = Date.now(), receivedAt = null, fetchFailed = false) {
        const freshness = forecastFreshness(payload, localNowMs, fetchFailed);
        const bindingClassId = payload?.bindingClassId == null ? null : String(payload.bindingClassId);
        const classes = [];
        for (const [index, raw] of (payload?.classes || []).entries()) {
            const classId = String(raw?.classId || index);
            const fiveHourUnread = Boolean(raw?.fiveHourUnread);
            const fiveHourParts = [];
            if (!fiveHourUnread) {
                const room = nonNegativeCount(raw?.fiveHourRoom);
                const runningHot = nonNegativeCount(raw?.fiveHourRunningHot);
                const waiting = nonNegativeCount(raw?.fiveHourWaiting);
                const unavailable = nonNegativeCount(raw?.fiveHourUnavailable);
                const unknown = nonNegativeCount(raw?.fiveHourUnknown);
                if (room)
                    fiveHourParts.push(`${room} ready`);
                if (runningHot)
                    fiveHourParts.push(`${runningHot} running hot`);
                if (waiting)
                    fiveHourParts.push(`${waiting} waiting`);
                if (unavailable)
                    fiveHourParts.push(`${unavailable} unavailable`);
                if (unknown)
                    fiveHourParts.push(`${unknown} unknown`);
            }
            const resetsMs = timestampMs(raw?.resetsAt);
            const expired = resetsMs !== null && resetsMs <= localNowMs;
            classes.push({
                key: classId,
                classId,
                stale: freshness.stale,
                expired,
                label: String(raw?.label || humanizeStatus(classId)),
                binding: classId === bindingClassId,
                utilizationPct: clampPercent(raw?.utilizationPct),
                leastUsedAccountId: raw?.leastUsedAccountId || null,
                leastUsedAccountName: _accountName(raw?.leastUsedAccountId, accounts),
                burnRatio: finiteNumber(raw?.burnRatio),
                burnText: _burnRatioText(raw?.burnRatio),
                burnSeverity: freshness.stale || raw?.burnTone == null ? 'unknown' : toneSeverity(raw.burnTone),
                outlookTone: String(raw?.outlookTone || 'other'),
                severity: freshness.stale ? 'unknown' : toneSeverity(raw?.outlookTone),
                reportingCount: nonNegativeCount(raw?.reportingCount),
                eligibleTotal: nonNegativeCount(raw?.eligibleTotal),
                willRunOut: nonNegativeCount(raw?.willRunOut),
                alreadySpent: nonNegativeCount(raw?.alreadySpent),
                resetsAt: raw?.resetsAt || null,
                resetsAtAccountName: _accountName(raw?.resetsAtAccountId, accounts),
                singlePointOfFailure: Boolean(raw?.singlePointOfFailure),
                fiveHour: {
                    unread: fiveHourUnread,
                    summary: fiveHourUnread
                        ? '5-hour usage is not reported'
                        : fiveHourParts.join(' · ') || 'No 5-hour capacity reported',
                    severity: 'unknown',
                    nextLiftAt: raw?.nextLiftAt || null,
                    nextLiftAccountName: _accountName(raw?.nextLiftAccountId, accounts),
                },
            });
        }
        return {
            bindingClassId,
            fiveHourOutlookTone: String(payload?.fiveHourOutlookTone || 'other'),
            fiveHourSeverity: freshness.stale ? 'unknown' : toneSeverity(payload?.fiveHourOutlookTone),
            classes,
            ...freshness,
            available: Boolean(payload),
        };
    }

    function _paceRows(workloadNow, showScoped) {
        const targets = WORKLOAD_TARGETS.filter(target => showScoped || !target.key.startsWith('family:'));
        return targets.map(({ key, label, icon }) => {
            const forecast = workloadNow.rows.find(row => row.key === key);
            const row = forecast || {
                ..._neutralSignal('Forecast unavailable'), valueText: 'Unknown',
                stale: workloadNow.stale, expired: false,
            };
            if (!forecast && workloadNow.stale)
                Object.assign(row, _staleSignal(row));
            const detail = [
                'Until next weekly reset' + (row.resetsAt ? ` · ${row.resetText}` : ''),
                row.summary, row.depthText, row.coverageCaveat, row.unopenedText,
                key === 'family:fable' ? 'Fable overlaps Claude capacity; * conservative bound' : '',
                workloadNow.freshnessText,
            ].filter(Boolean).join('\n');
            return { ...row, key, label, icon, kind: key.split(':')[0], source: 'headroom', detail };
        });
    }

    function _runwayCauseLabel(cause, accounts) {
        const account = accounts.find(candidate => candidate.id === cause?.accountId);
        const accountName = account?.name || 'Unknown account';
        const labels = { five_hour: '5-hour', seven_day: 'weekly', weekly_scoped: 'scoped weekly' };
        const windowLabel = labels[cause?.windowKind] || humanizeStatus(cause?.windowKind || 'window');
        return `${accountName} · ${windowLabel}`;
    }

    function runwayView(runway, accounts = [], warningHours = 72, localNowMs = Date.now(), receivedAt = null, fetchFailed = false) {
        const coverage = _runwayCoverage(runway);
        const complete = coverage.complete;
        const nowMs = localNowMs;
        const freshness = forecastFreshness(runway, localNowMs, fetchFailed);
        const horizonMs = Math.max(0, Number(runway?.horizonMs || 0));
        const horizonText = horizonMs ? formatDuration(horizonMs) : 'unknown';
        const outcome = runway?.worstStatedOutcome || null;
        const kind = String(outcome?.kind || 'unknown');
        const causes = (outcome?.causes || []).map(cause => _runwayCauseLabel(cause, accounts));
        const thresholdMs = Math.max(1, Number(warningHours || 72)) * 60 * 60 * 1000;
        let value = '–';
        let summary = runway ? 'No stateable quota runway' : 'Quota runway is unavailable';
        let severity = 'warning';
        let exhaustsAt = null;
        let bandText = '';

        if (kind === 'runway') {
            exhaustsAt = outcome.exhaustsAt || null;
            const exhaustsMs = timestampMs(exhaustsAt);
            if (exhaustsMs !== null) {
                const remainingMs = Math.max(0, exhaustsMs - nowMs);
                value = formatDuration(remainingMs);
                summary = `Projected quota run-out: ${formatTimestamp(exhaustsAt)}`;
                severity = remainingMs <= 0 ? 'critical' : remainingMs <= thresholdMs ? 'warning' : 'normal';
            }
            const earliest = timestampMs(outcome.earliestExhaustsAt);
            const latest = timestampMs(outcome.latestExhaustsAt);
            if ((earliest !== null || latest !== null) && earliest !== latest) {
                const earliestText = earliest === null ? 'earlier than model range' : formatTimestamp(earliest);
                const latestText = latest === null ? 'later than model range' : formatTimestamp(latest);
                bandText = `${earliestText} to ${latestText}`;
            }
        } else if (kind === 'beyond_horizon') {
            value = horizonMs ? `>${formatDuration(horizonMs)}` : '>horizon';
            summary = `No quota run-out projected within the ${horizonText} model horizon`;
            severity = 'normal';
        } else if (kind === 'out_now') {
            value = 'OUT';
            summary = 'Pool is out of quota now';
            severity = 'critical';
        } else if (kind === 'no_accounts') {
            summary = 'No accounts are available to the quota model';
            severity = 'critical';
        } else if (kind === 'other') {
            value = '?';
            summary = 'Quota runway state is not recognized';
        } else if (outcome) {
            summary = 'Quota runway is unknown because no readable window was available';
        }

        if (!complete && severity === 'normal')
            severity = 'warning';
        if (freshness.stale) {
            summary = `Stale · Last reading: ${summary}`;
            severity = 'unknown';
        }

        return {
            kind,
            value,
            severity,
            complete,
            exhaustsAt,
            bandText,
            causes,
            summary,
            coverage,
            coverageText: coverage.text,
            horizonMs,
            horizonText,
            ...freshness,
            available: Boolean(runway),
        };
    }

    function buildView(
        accounts,
        status,
        runway,
        pacing,
        workloadHeadroom,
        options = {},
        localNowMs = Date.now()
    ) {
        const list = Array.isArray(accounts) ? accounts : [];
        const warningThreshold = Number(options.usageWarningThreshold || DEFAULT_USAGE_WARNING_PCT);
        const nowMs = anchoredNow(status?.generatedAt, options.statusReceivedAt, localNowMs);
        const mapped = list.map((account, index) => {
            const state = accountState(account);
            const credential = credentialNotice(account);
            return {
                raw: account,
                index,
                id: account.id || account.name || String(index),
                name: account.name || `Account ${index + 1}`,
                provider: humanizeStatus(account.provider || 'unknown'),
                providerKey: String(account.provider || 'unknown'),
                defaultCandidate: Boolean(account.isDefaultCandidate),
                state,
                stateClass: credential?.key === 'error' ? 'error' : state.key,
                credential,
                measurementNotice: measurementNotice(account),
                windows: accountWindows(
                    account,
                    options.showScoped !== false,
                    warningThreshold,
                    nowMs
                ),
                stale: account.measurementState === 'stale',
            };
        });

        if (options.defaultCandidateFirst !== false) {
            mapped.sort((left, right) => {
                if (left.defaultCandidate !== right.defaultCandidate)
                    return left.defaultCandidate ? -1 : 1;
                if (left.state.key !== right.state.key)
                    return left.state.key === 'available' ? 1 : -1;
                return left.index - right.index;
            });
        }

        const configured = Number.isFinite(Number(status?.pool?.configured))
            ? Number(status.pool.configured)
            : mapped.length;
        const derivedRoutable = mapped.filter(account => account.state.key === 'available').length;
        const defaultRoutable = Number.isFinite(Number(status?.pool?.defaultRoutable))
            ? Number(status.pool.defaultRoutable)
            : derivedRoutable;
        const pools = usagePools(
            status,
            options.showScoped !== false,
            warningThreshold
        );
        const overloads = providerOverloads(status, list);
        const runwayNow = runwayView(
            runway,
            mapped,
            Number(options.runwayWarningHours || 72),
            localNowMs,
            options.runwayReceivedAt,
            options.runwayFetchFailed
        );
        const paceNow = paceView(runway, localNowMs, options.runwayReceivedAt, options.runwayFetchFailed);
        const pacingNow = pacingView(pacing, mapped, localNowMs, options.pacingReceivedAt, options.pacingFetchFailed);
        const workloadNow = workloadHeadroomView(
            workloadHeadroom,
            localNowMs,
            options.workloadHeadroomReceivedAt,
            options.workloadHeadroomFetchFailed
        );
        if (options.showScoped === false)
            workloadNow.rows = workloadNow.rows.filter(row => row.dimensionKind !== 'family');
        const paceRows = _paceRows(workloadNow, options.showScoped !== false);

        return {
            nowMs,
            accounts: mapped,
            usagePools: pools,
            providerOverloads: overloads,
            pace: paceNow,
            paceRows,
            providerUsageRows: providerUsageRows(list, options.showScoped !== false, nowMs, options.accountsFetchFailed),
            pacing: pacingNow,
            runway: runwayNow,
            workloads: workloadNow.rows,
            workloadHeadroom: workloadNow,
            pool: {
                configured,
                defaultRoutable,
                paused: Number(status?.pool?.paused || 0),
                rateLimited: Number(status?.pool?.rateLimited || 0),
                usageExhausted: Number(status?.pool?.usageExhausted || 0),
                nextAvailableAt: status?.pool?.nextAvailableAt || null,
            },
            status: String(status?.status || 'other'),
            healthy: status?.status ? status.status === 'ok' : defaultRoutable > 0,
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
        accountState,
        accountWindows,
        anchoredNow,
        buildView,
        clampPercent,
        createRefreshCycle,
        credentialNotice,
        forecastFreshness,
        formatDuration,
        formatReset,
        formatTimestamp,
        humanizeStatus,
        measurementNotice,
        normalizeBaseUrl,
        panelWorkloadLabel,
        providerUsageRows,
        forecastSummary,
        workloadTooltipLine,
        paceView,
        pacingView,
        providerOverloads,
        runwayView,
        timestampMs,
        toneSeverity,
        usagePools,
        workloadHeadroomView,
    };
})();

if (typeof module !== 'undefined' && module.exports)
    module.exports = UsageModel;
