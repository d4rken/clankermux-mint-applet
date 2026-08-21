/* Pure data helpers shared by the Cinnamon applet and its Node test suite. */

var UsageModel = (() => {
    const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

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
            return Number.isFinite(value) ? value : null;

        const text = String(value).trim();
        if (!text)
            return null;
        const numeric = Number(text);
        if (Number.isFinite(numeric))
            return numeric;
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

    function _usageData(account) {
        return account?.usageData || account?.staleUsage || {};
    }

    function _window(data, snakeName, camelName, label, stale) {
        const raw = data?.[snakeName] || data?.[camelName];
        if (!raw)
            return null;
        const percent = clampPercent(raw.utilization ?? raw.percent);
        if (percent === null)
            return null;
        return {
            key: snakeName,
            label,
            percent,
            resetsAt: raw.resets_at || raw.resetsAt || null,
            stale,
            scoped: false,
        };
    }

    function _directPrediction(account, key) {
        if (key === 'five_hour')
            return account?.prediction?.fiveHour || account?.prediction?.five_hour || null;
        if (key === 'seven_day')
            return account?.prediction?.sevenDay || account?.prediction?.seven_day || null;
        return null;
    }

    function _paceProjection(window, nowMs) {
        const resetMs = Date.parse(window.resetsAt || '');
        const durationMs = window.key === 'five_hour' ? FIVE_HOURS_MS : SEVEN_DAYS_MS;
        if (!Number.isFinite(resetMs) || resetMs <= nowMs)
            return null;

        const elapsedFraction = (nowMs - (resetMs - durationMs)) / durationMs;
        if (elapsedFraction <= 0)
            return null;
        if (window.percent === 0)
            return 0;
        // Very young windows are too noisy to extrapolate from.
        if (elapsedFraction < 0.03)
            return null;
        return clampNumber(window.percent / Math.min(1, elapsedFraction));
    }

    function _decorateWindow(window, account, nowMs, warningThreshold) {
        const direct = _directPrediction(account, window.key);
        const directResetMs = timestampMs(direct?.resetsAtMs);
        if (!window.resetsAt && directResetMs !== null)
            window.resetsAt = new Date(directResetMs).toISOString();

        const directProjection = clampNumber(direct?.predictedAtReset);
        if (directProjection !== null) {
            window.projectedAtReset = directProjection;
            window.willExhaust = Boolean(direct?.willExhaustBeforeReset);
            window.forecastConfidence = direct?.lowConfidence || direct?.state === 'insufficient_data'
                ? 'low'
                : 'high';
        } else {
            window.projectedAtReset = _paceProjection(window, nowMs);
            window.willExhaust = window.projectedAtReset === null
                ? null
                : window.projectedAtReset >= 100;
            window.forecastConfidence = window.projectedAtReset === null ? 'unknown' : 'estimated';
        }

        const certainlyExhausts = window.percent >= 100 ||
            (window.willExhaust === true && window.forecastConfidence === 'high');
        const nearExhaustion = window.willExhaust === true ||
            (window.projectedAtReset !== null && window.projectedAtReset >= warningThreshold) ||
            window.percent >= warningThreshold;
        window.severity = certainlyExhausts ? 'critical' : nearExhaustion ? 'warning' : 'normal';
        return window;
    }

    function accountWindows(account, showScoped = true, nowMs = Date.now(), warningThreshold = 80) {
        const live = account?.usageData;
        const data = _usageData(account);
        const stale = !live && Boolean(account?.staleUsage);
        const windows = [];
        const fiveHour = _window(data, 'five_hour', 'fiveHour', '5 hour', stale);
        const sevenDay = _window(data, 'seven_day', 'sevenDay', '7 day', stale);
        if (fiveHour)
            windows.push(fiveHour);
        if (sevenDay)
            windows.push(sevenDay);

        if (showScoped && Array.isArray(data.limits)) {
            const seen = new Set();
            for (const limit of data.limits) {
                const model = limit?.scope?.model;
                const modelName = model?.display_name || model?.displayName || model?.id;
                if (!modelName)
                    continue;
                const percent = clampPercent(limit.percent ?? limit.utilization);
                if (percent === null)
                    continue;
                const key = String(modelName).toLowerCase();
                if (seen.has(key))
                    continue;
                seen.add(key);
                windows.push({
                    key: `scope:${key}`,
                    label: String(modelName),
                    percent,
                    resetsAt: limit.resets_at || limit.resetsAt || null,
                    stale,
                    scoped: true,
                    active: Boolean(limit.is_active ?? limit.isActive),
                });
            }
        }
        return windows.map(window => _decorateWindow(window, account, nowMs, warningThreshold));
    }

    function accountState(account, healthDetail = null, nowMs = Date.now()) {
        if (account?.paused)
            return { key: 'paused', label: account.pauseReason || 'Paused' };

        const tokenStatus = String(account?.tokenStatus || '').toLowerCase();
        if (['expired', 'invalid', 'missing', 'error'].includes(tokenStatus))
            return { key: 'error', label: `Token ${tokenStatus}` };

        const untilFields = [
            ['rateLimitedUntil', 'Rate limited', 'limited'],
            ['usageThrottledUntil', 'Usage throttled', 'limited'],
            ['providerOverloadedUntil', 'Provider overloaded', 'overloaded'],
            ['providerOverloadeduntil', 'Provider overloaded', 'overloaded'],
        ];
        for (const [field, label, key] of untilFields) {
            const until = timestampMs(account?.[field]);
            if (Number.isFinite(until) && until > nowMs)
                return { key, label, until };
        }

        const healthStatus = String(healthDetail?.status || '').toLowerCase();
        if (healthStatus && !['available', 'ok', 'routable'].includes(healthStatus))
            return { key: 'limited', label: humanizeStatus(healthStatus) };

        const rateStatus = String(account?.rateLimitStatus || '').toLowerCase();
        if (rateStatus.startsWith('rate_limited') || rateStatus.startsWith('limited'))
            return { key: 'limited', label: account.rateLimitStatus };

        return { key: 'available', label: 'Available' };
    }

    function humanizeStatus(value) {
        const text = String(value || '').replace(/_/g, ' ').trim();
        return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Unknown';
    }

    function _healthByName(health) {
        const result = new Map();
        for (const detail of health?.accounts_detail || [])
            result.set(detail.name, detail);
        return result;
    }

    function providerOverloads(accounts, nowMs = Date.now()) {
        const grouped = new Map();
        for (const account of accounts || []) {
            const until = timestampMs(
                account?.providerOverloadedUntil ?? account?.providerOverloadeduntil
            );
            if (!Number.isFinite(until) || until <= nowMs)
                continue;

            const key = String(account?.providerOverloadKey || account?.provider || 'provider');
            const existing = grouped.get(key);
            if (existing) {
                existing.accountCount++;
                existing.until = Math.max(existing.until, until);
                continue;
            }

            const provider = key === 'anthropic-upstream'
                ? 'Anthropic'
                : humanizeStatus(account?.provider || key);
            grouped.set(key, {
                key,
                provider,
                until,
                accountCount: 1,
            });
        }
        return Array.from(grouped.values()).sort((left, right) => {
            return left.provider.localeCompare(right.provider);
        });
    }

    function _poolLabel(key, items) {
        if (key === 'five_hour')
            return '5h';
        if (key === 'seven_day')
            return '7d';
        return items[0]?.window?.label || humanizeStatus(key.replace(/^scope:/, ''));
    }

    function aggregateUsagePools(accounts, warningThreshold = 80, nowMs = Date.now()) {
        const grouped = new Map();
        for (const account of accounts || []) {
            for (const window of account.windows || []) {
                if (!grouped.has(window.key))
                    grouped.set(window.key, []);
                grouped.get(window.key).push({ account, window });
            }
        }

        const pools = [];
        for (const [key, items] of grouped) {
            const count = items.length;
            const usedExact = items.reduce((sum, item) => sum + item.window.percent, 0) / count;
            // Missing forecasts assume no further burn. This avoids claiming danger
            // when the proxy has not collected enough prediction data yet.
            const projectedExact = items.reduce((sum, item) => {
                return sum + (item.window.projectedAtReset ?? item.window.percent);
            }, 0) / count;
            const forecastCount = items.filter(item => item.window.projectedAtReset !== null).length;
            const atRiskCount = items.filter(item => {
                return item.window.percent >= 100 || item.window.willExhaust === true ||
                    (item.window.projectedAtReset !== null && item.window.projectedAtReset >= 100);
            }).length;
            const certainExhaustCount = items.filter(item => {
                return item.window.percent >= 100 ||
                    (item.window.willExhaust === true && item.window.forecastConfidence === 'high');
            }).length;
            const resetTimes = items
                .map(item => Date.parse(item.window.resetsAt || ''))
                .filter(timestamp => Number.isFinite(timestamp) && timestamp > nowMs);

            let severity = 'normal';
            if (certainExhaustCount === count)
                severity = 'critical';
            else if (projectedExact >= warningThreshold || usedExact >= warningThreshold)
                severity = 'warning';

            pools.push({
                key,
                label: _poolLabel(key, items),
                scoped: key.startsWith('scope:'),
                accountCount: count,
                usedPercent: Math.round(usedExact),
                remainingPercent: 100 - Math.round(usedExact),
                projectedPercent: Math.round(projectedExact),
                forecastCount,
                atRiskCount,
                certainExhaustCount,
                severity,
                nextResetAt: resetTimes.length ? new Date(Math.min(...resetTimes)).toISOString() : null,
                lastResetAt: resetTimes.length ? new Date(Math.max(...resetTimes)).toISOString() : null,
                items,
            });
        }

        const order = { five_hour: 0, seven_day: 1 };
        pools.sort((left, right) => {
            const leftOrder = order[left.key] ?? 2;
            const rightOrder = order[right.key] ?? 2;
            return leftOrder - rightOrder || left.label.localeCompare(right.label);
        });
        return pools;
    }

    function panelUsagePools(pools) {
        return (pools || []).filter(pool => !pool.scoped || pool.usedPercent > 0);
    }

    function buildView(accounts, health, options = {}, nowMs = Date.now()) {
        const list = Array.isArray(accounts) ? accounts : [];
        const details = _healthByName(health);
        const warningThreshold = Number(options.warningThreshold || 80);
        const mapped = list.map((account, index) => {
            const windows = accountWindows(
                account,
                options.showScoped !== false,
                nowMs,
                warningThreshold
            );
            return {
                raw: account,
                index,
                id: account.id || account.name || String(index),
                name: account.name || `Account ${index + 1}`,
                provider: humanizeStatus(account.provider || 'unknown'),
                primary: Boolean(account.isPrimary),
                state: accountState(account, details.get(account.name), nowMs),
                windows,
                stale: !account.usageData && Boolean(account.staleUsage),
            };
        });

        if (options.primaryFirst !== false) {
            mapped.sort((left, right) => {
                if (left.primary !== right.primary)
                    return left.primary ? -1 : 1;
                if (left.state.key !== right.state.key)
                    return left.state.key === 'available' ? 1 : -1;
                return left.index - right.index;
            });
        }

        const configured = Number.isFinite(Number(health?.pool?.configured))
            ? Number(health.pool.configured)
            : mapped.length;
        const derivedRoutable = mapped.filter(account => account.state.key === 'available').length;
        const reportedRoutable = Number.isFinite(Number(health?.pool?.routable))
            ? Number(health.pool.routable)
            : derivedRoutable;
        const overloads = providerOverloads(list, nowMs);
        // /health does not include Clankermux's in-memory provider-overload gate,
        // while accountState does. Use the stricter count so the panel does not
        // claim every account is routable during a provider-wide 529 cooldown.
        const routable = overloads.length
            ? Math.min(reportedRoutable, derivedRoutable)
            : reportedRoutable;
        const usagePools = aggregateUsagePools(mapped, warningThreshold, nowMs);
        return {
            accounts: mapped,
            usagePools,
            providerOverloads: overloads,
            pool: {
                configured,
                routable,
                paused: Number(health?.pool?.paused || 0),
                rateLimited: Number(health?.pool?.rate_limited || 0),
                usageExhausted: Number(health?.pool?.usage_exhausted || 0),
                nextAvailableAt: health?.pool?.next_available_at || null,
            },
            healthy: (health?.status ? health.status === 'ok' : routable > 0) && !overloads.length,
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
        aggregateUsagePools,
        buildView,
        clampPercent,
        createRefreshCycle,
        formatDuration,
        formatReset,
        formatTimestamp,
        humanizeStatus,
        normalizeBaseUrl,
        panelUsagePools,
        providerOverloads,
        timestampMs,
    };
})();

if (typeof module !== 'undefined' && module.exports)
    module.exports = UsageModel;
