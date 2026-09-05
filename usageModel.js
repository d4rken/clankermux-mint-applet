/* Pure data helpers shared by the Cinnamon applet and its Node test suite. */

var UsageModel = (() => {
    const DEFAULT_USAGE_WARNING_PCT = 80;

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

    function accountWindows(account, showScoped = true, warningThreshold = DEFAULT_USAGE_WARNING_PCT) {
        const windows = [];
        const measurementState = String(account?.measurementState || 'other').toLowerCase();
        for (const [index, raw] of (account?.windows || []).entries()) {
            const scoped = raw?.kind === 'weekly_scoped' || raw?.scopeId !== null && raw?.scopeId !== undefined;
            if (scoped && !showScoped)
                continue;

            const percent = clampPercent(raw?.utilizationPct);
            if (percent === null)
                continue;

            const prediction = raw?.prediction || null;
            const projectedAtReset = clampNumber(prediction?.predictedUtilizationAtResetPct);
            const lowConfidence = Boolean(prediction?.lowConfidence);
            const willExhaust = prediction ? Boolean(prediction.willExhaustBeforeReset) : null;
            const certainlyExhausts = percent >= 100 || willExhaust === true && !lowConfidence;
            const nearExhaustion = willExhaust === true || percent >= warningThreshold ||
                projectedAtReset !== null && projectedAtReset >= warningThreshold;

            windows.push({
                key: _windowKey(raw, index),
                kind: String(raw?.kind || 'other'),
                scopeId: raw?.scopeId ?? null,
                label: _windowLabel(raw || {}),
                percent,
                observedAt: raw?.observedAt || null,
                resetsAt: raw?.resetsAt || null,
                projectedAtReset,
                exhaustsAt: prediction?.exhaustsAt || null,
                willExhaust,
                forecastConfidence: prediction ? lowConfidence ? 'low' : 'high' : 'unknown',
                predictionState: prediction?.state || null,
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

    function _paceSignal(outcomeKind, rawPercent, rawDirection, options = {}) {
        const kind = String(outcomeKind || 'unknown');
        if (kind === 'no_accounts')
            return _neutralSignal('No active accounts for this workload', 'NO ACCOUNTS');
        if (!['beyond_horizon', 'runway', 'out_now'].includes(kind))
            return _neutralSignal('Forecast unavailable');
        let structural = false;
        if (options.requireMeasured) {
            if (!['measured', 'structural'].includes(options.projectionBasis))
                return _neutralSignal('Evidence unavailable');
            if (options.projectionBasis === 'structural') {
                structural = true;
                rawPercent = null;
            }
        }
        if (kind === 'out_now') {
            return {
                action: 'OUT', valueText: 'OUT', side: 'left', fillPercent: 100,
                severity: 'critical', percent: null, direction: null,
                summary: 'Available modeled capacity exhausted',
            };
        }
        const qualify = signal => structural
            ? { ...signal, severity: 'unknown', summary: `${signal.summary} · early estimate` }
            : signal;
        const basis = options.basis || 'exact';
        if (options.requireKnownBasis && !['exact', 'bound'].includes(basis))
            return _neutralSignal('Headroom basis is not recognized');

        const direction = String(rawDirection || '');
        const percentValue = typeof rawPercent === 'number' && Number.isFinite(rawPercent) && rawPercent >= 0
            ? rawPercent : null;
        const percent = percentValue === null ? null : Math.round(percentValue);
        const bound = basis === 'bound';
        if (percent !== null && direction === 'margin' && kind === 'beyond_horizon') {
            return qualify({
                action: 'ROOM', valueText: `${bound ? '≥' : ''}+${percent}%`,
                side: 'right', fillPercent: Math.min(100, percent * 2),
                severity: 'normal', percent, direction: 'margin',
                summary: bound ? `At least ${percent}% pace margin (conservative bound)` : `${percent}% pace margin`,
            });
        }
        if (percent !== null && direction === 'deficit' && kind === 'runway') {
            return qualify({
                action: 'CUT', valueText: bound ? `−${percent}% bound` : `−${percent}%`,
                side: 'left', fillPercent: Math.min(100, percent * 2),
                severity: 'warning', percent, direction: 'deficit',
                summary: bound
                    ? `Conservative cut: ${percent}% if this burn continues`
                    : `Reduce pace by ${percent}% if this burn continues`,
            });
        }
        if (rawPercent != null || (direction && !['margin', 'deficit'].includes(direction)))
            return _neutralSignal('Headroom value, direction or outcome is not recognized');
        const interval = options.nextReset ? 'next reset' : 'the stated model horizon';
        if (kind === 'beyond_horizon') {
            return options.requireMeasured
                ? qualify({
                    action: 'PLENTY', valueText: 'plenty', side: 'right', fillPercent: 100,
                    severity: 'normal', percent: null, direction: null,
                    summary: `Reaches ${interval}`,
                })
                : _neutralSignal(`Projected to reach ${interval} · Pace margin unavailable`, 'REACHES HORIZON');
        }
        return options.requireMeasured
            ? qualify({
                action: 'CUT HARD', valueText: 'cut hard', side: 'left', fillPercent: 100,
                severity: 'warning', percent: null, direction: null,
                summary: `May exhaust before ${interval}`,
            })
            : _neutralSignal(`May exhaust before ${interval} · Required cut unavailable`, 'MAY EXHAUST');
    }

    function classPaceSignal(item) {
        const ratio = finiteNumber(item?.burnRatio);
        if (ratio === null || ratio < 0)
            return _neutralSignal('Burn pace not stated');
        const tone = item?.burnTone == null ? null : toneSeverity(item.burnTone);
        const severity = tone === null ? ratio > 1 ? 'warning' : 'normal' : tone;
        if (ratio === 0) {
            return {
                action: 'IDLE', valueText: 'idle', side: 'right', fillPercent: 100,
                severity, percent: null, direction: null, summary: 'No measured burn',
            };
        }
        if (ratio < 1) {
            const margin = Math.round((1 / ratio - 1) * 100);
            return {
                action: 'ROOM', valueText: `+${margin}%`, side: 'right',
                fillPercent: Math.min(100, margin * 2), severity, percent: margin,
                direction: 'margin', summary: `Burn can rise ${margin}% and stay sustainable`,
            };
        }
        const cut = Math.round((1 - 1 / ratio) * 100);
        if (cut === 0) {
            return {
                action: 'HOLD', valueText: '±0%', side: 'none', fillPercent: 0,
                severity, percent: 0, direction: 'deficit', summary: 'Burn is exactly sustainable',
            };
        }
        return {
            action: 'CUT', valueText: `−${cut}%`, side: 'left',
            fillPercent: Math.min(100, cut * 2), severity, percent: cut,
            direction: 'deficit', summary: `Cut burn ${cut}% to stay sustainable`,
        };
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

    function _workloadForecast(raw, basis, nextReset, freshness) {
        const projectionBasis = raw?.projectionBasis || null;
        let signal = _paceSignal(raw?.outcomeKind, raw?.headroomPct, raw?.headroomDirection, {
            basis, nextReset, projectionBasis, requireKnownBasis: true, requireMeasured: true,
        });
        const exhaustsAt = raw?.outcomeKind === 'runway' && timestampMs(raw?.exhaustsAt) !== null
            ? raw.exhaustsAt : null;
        if (exhaustsAt && projectionBasis === 'measured')
            signal.summary += `\nProjected exhaustion: ${formatTimestamp(exhaustsAt)}`;
        if (freshness.stale)
            signal = _staleSignal(signal);
        return {
            ...signal,
            ...freshness,
            outcomeKind: String(raw?.outcomeKind || 'unknown'),
            exhaustsAt,
            projectionBasis,
            projectionLabel: projectionBasis === 'measured' ? 'Measured projection' :
                projectionBasis === 'structural' ? 'Early / structural estimate' : 'Evidence unavailable',
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
            const spentAccounts = nonNegativeCount(raw?.spentAccounts);
            const depth = [`${eligibleAccounts} eligible`];
            if (unreadableAccounts)
                depth.push(`${unreadableAccounts} unreadable`);
            if (spentAccounts)
                depth.push(`${spentAccounts} spent`);
            const longTerm = {
                ..._workloadForecast(raw, basis, false, freshness),
                intervalLabel: `Long-term pace · ${horizonText}`,
                headroomAbsence: raw?.headroomAbsence || null,
            };
            if (!horizonMs) {
                Object.assign(longTerm, _neutralSignal('Long-term forecast interval unavailable'));
                if (freshness.stale)
                    Object.assign(longTerm, _staleSignal(longTerm));
            }
            const resetsMs = timestampMs(raw?.nextReset?.resetsAt);
            const expired = resetsMs !== null && resetsMs <= localNowMs;
            const validReset = resetsMs !== null && !expired;
            let primary = validReset
                ? _workloadForecast(raw.nextReset, basis, true, freshness)
                : {
                    ..._neutralSignal(expired ? 'Next-reset forecast expired' : 'Next-reset forecast unavailable',
                        expired ? 'EXPIRED' : 'NO READING'),
                    ...freshness,
                    projectionLabel: '',
                };
            if (!validReset && raw.outcomeKind === 'no_accounts')
                Object.assign(primary, _neutralSignal('No active accounts for this workload', 'NO ACCOUNTS'));
            if (!validReset && freshness.stale)
                Object.assign(primary, _staleSignal(primary));
            rows.push({
                ...primary,
                key: `${raw.dimensionKind}:${raw.dimensionId}`,
                dimensionKind: raw.dimensionKind,
                dimensionId: raw.dimensionId,
                label: String(raw.label || humanizeStatus(raw.dimensionId)),
                basis,
                basisLabel: basis === 'exact' ? 'Exact threshold' :
                    basis === 'bound' ? 'Conservative bound' : 'Unknown basis',
                eligibleAccounts, unreadableAccounts, spentAccounts,
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

    function panelWorkloadLabel(signal, showPercentage = false) {
        if (signal?.stale)
            return 'Stale';
        if (signal?.expired)
            return 'Expired';
        const numericDirection = signal?.percent !== null && signal?.percent !== undefined &&
            (signal.direction === 'margin' || signal.direction === 'deficit');
        return showPercentage && numericDirection ? String(signal.valueText || '') : '';
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
        return `${formatted}× sustainable pace`;
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
            const burnRatio = finiteNumber(raw?.burnRatio);
            const resetsMs = timestampMs(raw?.resetsAt);
            const expired = resetsMs !== null && resetsMs <= localNowMs;
            let pace = classPaceSignal({ burnRatio: raw?.burnRatio, burnTone: raw?.burnTone });
            if (expired)
                pace = _neutralSignal('Next-reset forecast expired', 'EXPIRED');
            if (freshness.stale)
                pace = _staleSignal(pace);
            classes.push({
                key: classId,
                classId,
                pace,
                stale: freshness.stale,
                expired,
                usable: !freshness.stale && !expired && burnRatio !== null && burnRatio >= 0,
                label: String(raw?.label || humanizeStatus(classId)),
                binding: classId === bindingClassId,
                utilizationPct: clampPercent(raw?.utilizationPct),
                leastUsedAccountId: raw?.leastUsedAccountId || null,
                leastUsedAccountName: _accountName(raw?.leastUsedAccountId, accounts),
                burnRatio,
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

    function _paceRowSignal(signal) {
        return {
            action: signal.action,
            valueText: signal.valueText,
            side: signal.side,
            fillPercent: signal.fillPercent,
            severity: signal.severity,
            percent: signal.percent,
            direction: signal.direction,
            summary: signal.summary,
        };
    }

    function _pacingDetail(item, localNowMs) {
        return [
            item.burnText,
            item.utilizationPct === null ? 'weekly usage unknown' : `${item.utilizationPct}% used (least-used)`,
            item.willRunOut ? `${item.willRunOut} of ${item.eligibleTotal} hit 100% by reset` : '',
            item.singlePointOfFailure ? 'no failover' : '',
            item.resetsAt ? `resets ${formatReset(item.resetsAt, localNowMs)}` : '',
        ].filter(Boolean).join(' · ');
    }

    function _headroomDetail(row, localNowMs) {
        return [
            String(row.summary || '').split('\n')[0],
            row.basis === 'bound' ? 'conservative bound' : '',
            row.resetsAt ? `resets ${formatReset(row.resetsAt, localNowMs)}` : '',
            row.unreadableAccounts ? `${row.unreadableAccounts} unreadable` : '',
        ].filter(Boolean).join(' · ');
    }

    function _paceRows(pacingNow, workloadNow, localNowMs) {
        const rows = [];
        const pacedClassIds = new Set();
        for (const item of pacingNow.classes) {
            pacedClassIds.add(item.classId);
            const headroomRow = workloadNow.rows.find(
                row => row.dimensionKind === 'class' && row.dimensionId === item.classId
            );
            const useHeadroom = !item.usable && Boolean(headroomRow) &&
                !headroomRow.stale && !headroomRow.expired;
            rows.push({
                key: `class:${item.classId}`,
                kind: 'class',
                label: item.label,
                binding: item.binding,
                source: useHeadroom ? 'headroom' : 'pacing',
                ..._paceRowSignal(useHeadroom ? headroomRow : item.pace),
                stale: useHeadroom ? headroomRow.stale : item.stale,
                expired: useHeadroom ? headroomRow.expired : item.expired,
                resetsAt: useHeadroom ? headroomRow.resetsAt : item.resetsAt,
                detail: useHeadroom
                    ? _headroomDetail(headroomRow, localNowMs)
                    : _pacingDetail(item, localNowMs),
            });
        }
        for (const row of workloadNow.rows) {
            if (row.dimensionKind === 'class' && pacedClassIds.has(row.dimensionId))
                continue;
            rows.push({
                key: row.key,
                kind: row.dimensionKind,
                label: row.label,
                binding: false,
                source: 'headroom',
                ..._paceRowSignal(row),
                stale: row.stale,
                expired: row.expired,
                resetsAt: row.resetsAt,
                detail: _headroomDetail(row, localNowMs),
            });
        }
        return rows;
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
                    warningThreshold
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
        const paceRows = _paceRows(pacingNow, workloadNow, localNowMs);

        return {
            nowMs,
            accounts: mapped,
            usagePools: pools,
            providerOverloads: overloads,
            pace: paceNow,
            paceRows,
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
        classPaceSignal,
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
