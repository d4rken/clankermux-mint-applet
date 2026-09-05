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
            earliestExhaustsAt: new Date(NOW + 3.75 * 24 * 60 * 60 * 1000).toISOString(),
            latestExhaustsAt: new Date(NOW + 4.25 * 24 * 60 * 60 * 1000).toISOString(),
            headroomPct: 18,
            headroomDirection: 'deficit',
        },
        ...overrides,
    };
}

function pacing(overrides = {}) {
    return {
        schema: 'clankermux.public.pacing.v1',
        generatedAt: NOW_ISO,
        bindingClassId: 'codex',
        fiveHourOutlookTone: 'neutral',
        classes: [
            {
                classId: 'anthropic',
                label: 'Claude',
                utilizationPct: 47,
                leastUsedAccountId: 'account-a',
                burnRatio: 1.08,
                burnTone: 'warning',
                outlookTone: 'success',
                reportingCount: 2,
                eligibleTotal: 2,
                willRunOut: 2,
                alreadySpent: 0,
                resetsAt: '2026-08-30T07:00:00.000Z',
                resetsAtAccountId: 'account-a',
                singlePointOfFailure: false,
                fiveHourRoom: 1,
                fiveHourRunningHot: 1,
                fiveHourWaiting: 0,
                fiveHourUnavailable: 0,
                fiveHourUnknown: 0,
                fiveHourUnread: false,
                nextLiftAt: null,
                nextLiftAccountId: null,
            },
            {
                classId: 'codex',
                label: 'GPT',
                utilizationPct: 66,
                leastUsedAccountId: 'account-c',
                burnRatio: null,
                burnTone: null,
                outlookTone: 'warning',
                reportingCount: 1,
                eligibleTotal: 1,
                willRunOut: 1,
                alreadySpent: 0,
                resetsAt: '2026-08-31T06:00:00.000Z',
                resetsAtAccountId: 'account-c',
                singlePointOfFailure: true,
                fiveHourRoom: 0,
                fiveHourRunningHot: 0,
                fiveHourWaiting: 0,
                fiveHourUnavailable: 0,
                fiveHourUnknown: 1,
                fiveHourUnread: true,
                nextLiftAt: null,
                nextLiftAccountId: null,
            },
        ],
        ...overrides,
    };
}

function workloadHeadroom(overrides = {}) {
    return {
        schema: 'clankermux.public.workload-headroom.v1',
        generatedAt: NOW_ISO,
        horizonMs: 14 * 24 * 60 * 60 * 1000,
        rows: [
            {
                dimensionKind: 'class',
                dimensionId: 'anthropic',
                label: 'Claude',
                outcomeKind: 'beyond_horizon',
                exhaustsAt: null,
                headroomPct: 30,
                headroomDirection: 'margin',
                headroomBasis: 'exact',
                headroomAbsence: null,
                projectionBasis: 'measured',
                eligibleAccounts: 2,
                unreadableAccounts: 0,
                spentAccounts: 0,
            },
            {
                dimensionKind: 'class',
                dimensionId: 'codex',
                label: 'GPT',
                outcomeKind: 'beyond_horizon',
                exhaustsAt: null,
                headroomPct: 41,
                headroomDirection: 'margin',
                headroomBasis: 'exact',
                headroomAbsence: null,
                projectionBasis: 'measured',
                eligibleAccounts: 1,
                unreadableAccounts: 0,
                spentAccounts: 0,
            },
            {
                dimensionKind: 'family',
                dimensionId: 'fable',
                label: 'Fable',
                outcomeKind: 'beyond_horizon',
                exhaustsAt: null,
                headroomPct: 30,
                headroomDirection: 'margin',
                headroomBasis: 'conservative_bound',
                headroomAbsence: null,
                projectionBasis: 'structural',
                eligibleAccounts: 2,
                unreadableAccounts: 1,
                spentAccounts: 1,
            },
        ],
        ...overrides,
    };
}

function nextResetWorkloads(overrides = {}) {
    const response = workloadHeadroom();
    response.rows = response.rows.map(row => ({
        ...row,
        nextReset: {
            resetsAt: '2026-08-25T12:00:00.000Z',
            outcomeKind: 'beyond_horizon', exhaustsAt: null,
            headroomPct: 25, headroomDirection: 'margin',
            projectionBasis: row.projectionBasis,
        },
    }));
    response.rows[1] = {
        ...response.rows[1],
        outcomeKind: 'runway', headroomPct: 40, headroomDirection: 'deficit',
        exhaustsAt: '2026-08-29T12:00:00.000Z',
    };
    return { ...response, ...overrides };
}

module.exports = {
    NOW,
    NOW_ISO,
    accounts,
    nextResetWorkloads,
    pacing,
    runway,
    status,
    workloadHeadroom,
};
