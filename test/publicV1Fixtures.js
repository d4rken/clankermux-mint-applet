'use strict';

const NOW_ISO = '2026-08-24T12:00:00.000Z';
const NOW = Date.parse(NOW_ISO);

function status(overrides = {}) {
    return {
        schema: 'clankermux.public.status.v1',
        generatedAt: NOW_ISO,
        status: 'ok',
        uptimeS: 120,
        version: '2026.8.83',
        pool: {
            configured: 3,
            defaultRoutable: 2,
            paused: 0,
            rateLimited: 1,
            usageExhausted: 0,
            nextAvailableAt: '2026-08-24T12:30:00.000Z',
        },
        routing: {
            context: 'fresh_unpinned_nominal',
            defaultCandidateAccountId: 'account-a',
        },
        usage: {
            fiveHour: {
                meanUtilizationPct: 37.5,
                contributingAccountCount: 2,
                unknownAccountCount: 1,
                earliestResetsAt: '2026-08-24T13:00:00.000Z',
            },
            sevenDay: {
                meanUtilizationPct: 50,
                contributingAccountCount: 3,
                unknownAccountCount: 0,
                earliestResetsAt: '2026-08-25T03:00:00.000Z',
            },
            worstAccountUtilizationPct: 100,
        },
        providers: [
            {
                provider: 'anthropic',
                anyOverload: { state: 'closed', until: null, probeActive: false },
                providerWideOverload: { state: 'closed', until: null, probeActive: false },
                scopedLimits: [
                    {
                        scopeId: 'fable',
                        label: 'Fable',
                        meanUtilizationPct: 70.3,
                        contributingAccountCount: 2,
                        unknownAccountCount: 0,
                        earliestResetsAt: '2026-08-25T03:00:00.000Z',
                    },
                ],
            },
            {
                provider: 'codex',
                anyOverload: { state: 'closed', until: null, probeActive: false },
                providerWideOverload: { state: 'closed', until: null, probeActive: false },
                scopedLimits: [],
            },
        ],
        ...overrides,
    };
}

function accounts() {
    return [
        {
            id: 'account-a',
            name: 'Account A',
            provider: 'anthropic',
            isDefaultCandidate: true,
            availability: { state: 'available', reason: null, availableAt: null },
            credential: { state: 'valid', expiresAt: '2026-08-24T17:00:00.000Z' },
            measurementState: 'fresh',
            usageObservedAt: '2026-08-24T11:59:00.000Z',
            utilizationPct: 90,
            windows: [
                {
                    kind: 'five_hour', scopeId: null, label: '5-hour',
                    utilizationPct: 90, observedAt: '2026-08-24T11:59:00.000Z',
                    resetsAt: '2026-08-24T13:00:00.000Z',
                    prediction: {
                        predictedUtilizationAtResetPct: 95,
                        exhaustsAt: '2026-08-24T13:15:00.000Z',
                        willExhaustBeforeReset: false,
                        lowConfidence: false,
                        state: 'rising',
                    },
                },
                {
                    kind: 'seven_day', scopeId: null, label: 'Weekly',
                    utilizationPct: 60, observedAt: '2026-08-24T11:59:00.000Z',
                    resetsAt: '2026-08-30T07:00:00.000Z', prediction: null,
                },
                {
                    kind: 'weekly_scoped', scopeId: 'fable', label: 'Fable',
                    utilizationPct: 40, observedAt: '2026-08-24T11:59:00.000Z',
                    resetsAt: '2026-08-30T07:00:00.000Z', prediction: null,
                },
            ],
        },
        {
            id: 'account-b',
            name: 'Account B',
            provider: 'anthropic',
            isDefaultCandidate: false,
            availability: {
                state: 'rate_limited', reason: 'queueing',
                availableAt: '2026-08-24T12:30:00.000Z',
            },
            credential: { state: 'refreshable', expiresAt: null },
            measurementState: 'stale',
            usageObservedAt: '2026-08-24T11:20:00.000Z',
            utilizationPct: 100,
            windows: [
                {
                    kind: 'five_hour', scopeId: null, label: '5-hour',
                    utilizationPct: 10, observedAt: '2026-08-24T11:20:00.000Z',
                    resetsAt: '2026-08-24T14:00:00.000Z',
                    prediction: {
                        predictedUtilizationAtResetPct: 100,
                        exhaustsAt: '2026-08-24T13:45:00.000Z',
                        willExhaustBeforeReset: true,
                        lowConfidence: true,
                        state: 'rising',
                    },
                },
                {
                    kind: 'seven_day', scopeId: null, label: 'Weekly',
                    utilizationPct: 80, observedAt: '2026-08-24T11:20:00.000Z',
                    resetsAt: '2026-08-25T03:00:00.000Z', prediction: null,
                },
                {
                    kind: 'weekly_scoped', scopeId: 'fable', label: 'Fable',
                    utilizationPct: 100, observedAt: '2026-08-24T11:20:00.000Z',
                    resetsAt: '2026-08-25T03:00:00.000Z', prediction: null,
                },
            ],
        },
        {
            id: 'account-c',
            name: 'Account C',
            provider: 'codex',
            isDefaultCandidate: false,
            availability: { state: 'available', reason: null, availableAt: null },
            credential: { state: 'not_applicable', expiresAt: null },
            measurementState: 'fresh',
            usageObservedAt: '2026-08-24T11:58:00.000Z',
            utilizationPct: 10,
            windows: [
                {
                    kind: 'five_hour', scopeId: null, label: '5-hour',
                    utilizationPct: null, observedAt: '2026-08-24T11:58:00.000Z',
                    resetsAt: null, prediction: null,
                },
                {
                    kind: 'seven_day', scopeId: null, label: 'Weekly',
                    utilizationPct: 10, observedAt: '2026-08-24T11:58:00.000Z',
                    resetsAt: '2026-08-31T06:00:00.000Z', prediction: null,
                },
            ],
        },
    ];
}

function runway(overrides = {}) {
    return {
        schema: 'clankermux.public.runway.v1',
        generatedAt: NOW_ISO,
        horizonMs: 14 * 24 * 60 * 60 * 1000,
        coverage: { activeKeyCount: 2, statedKeyCount: 2, unobservedKeyCount: 0 },
        worstStatedOutcome: {
            kind: 'runway',
            exhaustsAt: new Date(NOW + 4 * 24 * 60 * 60 * 1000).toISOString(),
            causes: [{ accountId: 'account-c', windowKind: 'seven_day' }],
        },
        ...overrides,
    };
}

module.exports = { NOW, NOW_ISO, accounts, runway, status };
