'use strict';

const NOW_ISO = '2026-09-09T12:00:10.000Z';
const NOW = Date.parse(NOW_ISO);
const copy = value => JSON.parse(JSON.stringify(value));
const example = name => copy(require(`./api-examples/${name}.json`));

function status(overrides = {}) {
    return { ...example('status'), accounts: { configured: 3, paused: 0 }, ...overrides };
}

function accounts() {
    const base = example('accounts').accounts[0];
    const make = (id, provider, weekly, family, session) => ({
        ...copy(base), id, name: `Account ${id.slice(-1).toUpperCase()}`, provider,
        windows: [
            { ...copy(base.windows[0]), kind: 'five_hour', label: '5-hour', utilizationPct: session },
            { ...copy(base.windows[1]), kind: 'seven_day', label: 'Weekly', utilizationPct: weekly,
                resetsAt: '2026-09-15T12:00:00.000Z' },
            ...(family === null ? [] : [{ ...copy(base.windows[1]), kind: 'weekly_scoped', scopeId: 'fable',
                label: 'Fable', utilizationPct: family, resetsAt: '2026-09-15T12:00:00.000Z' }]),
        ],
    });
    return [make('account-a', 'anthropic', 60, 40, 90), make('account-b', 'anthropic', 80, 100, 10),
        make('account-c', 'codex', 10, null, null)];
}

function workloads() {
    const payload = example('workloads.family');
    payload.workloads[0].weekly.coverage = { eligibleAccounts: 2, modeledAccounts: 2, idleAccounts: 0, learningAccounts: 0, unavailableAccounts: 0 };
    const codex = copy(payload.workloads[0]);
    codex.id = 'class:codex';
    codex.label = 'GPT';
    codex.weekly.outcome = 'lasts_until_end';
    codex.weekly.exhaustsAt = null;
    codex.weekly.pace.changePct = 25;
    payload.workloads.splice(1, 0, codex);
    return payload;
}

module.exports = { NOW, NOW_ISO, status, accounts, workloads, example };
