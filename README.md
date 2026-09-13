# Clankermux Usage for Cinnamon

[![CI](https://github.com/d4rken/clankermux-mint-applet/actions/workflows/ci.yml/badge.svg)](https://github.com/d4rken/clankermux-mint-applet/actions/workflows/ci.yml)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

A native Linux Mint/Cinnamon panel applet for monitoring the accounts behind a
[Clankermux](https://github.com/d4rken/clankermux) proxy.

The panel defaults to combined weekly usage, with one icon per provider and an
optional Fable indicator:

```text
[OpenAI] 50%   [Anthropic] 30%   [F] 95%
```

Each value is the average of that provider's readable weekly account percentages,
with equal weight per account, including paused accounts. Fable uses its own
weekly limits. These are account averages, not capacity-weighted totals; the API
does not provide quota sizes. Missing readings are excluded rather than counted
as zero. `*` marks partial or cached readings; hover shows how many accounts are
included. Five-hour usage stays in the account bars.
Accounts whose usage measurement is not applicable are excluded. Missing family
windows count as missing readings; no zero usage is inferred.

Choose **Configure > Display > Panel display > Forecast advice** to show:

```text
[OpenAI] ↑ ~25% room   [Anthropic] ↓ ~20% pace   [F] ↓ ~20% pace*
```

Forecast headlines use `/workloads` weekly budget guidance until the next weekly
reset, assuming the current per-account consumption pattern. Only
`weekly.pace.state: estimate` supplies an estimated adjustment. Positive values
use the last tested passing increase; negative values suggest a reduction.
Zero means no additional tested increase fits. Search limits are not advice.
Percentages are neither quota remaining nor agent-count targets.

Fable overlaps Claude through `parentWorkloadId`; do not add their percentages.
`*` identifies a conservative bound on that row. The F monogram is not an official
brand mark. A missing Fable workload is omitted.

Click the applet for account utilization bars and a compact, clickable summary.
It shows **weekly budget** separately from **available now**. Weekly risk can
coexist with available paid fallback. Availability describes a fresh, unpinned,
nominal-size request and is not a guarantee for restricted API keys.
Clicking the summary opens the dashboard.

Weekly coverage displays disjoint modeled, idle, learning, and unavailable
counts. Partial forecasts describe only the modeled subset. Five-hour learning
no longer blocks weekly guidance. Unknown numbers remain unavailable; stale
or expired advice is withheld until refreshed.

Account bars use window forecast `outcome`, `quality` and `reason`, displaying
`out ~2h`, `no usage`, `unstarted`, `learning`, or `—`. Limited evidence uses
warning color and an accessible explanation. `reassessAt` is the earliest
useful fresh reading, never a promise that learning ends. Observed usage remains
separate from forecasts and is not converted into pace advice.

## Install

```sh
make install
```

Then open **System Settings → Applets**, select **Clankermux Usage**, and click
the `+` button. If it does not appear immediately, press <kbd>Alt</kbd>+<kbd>F2</kbd>,
enter `r`, and press <kbd>Enter</kbd> to reload Cinnamon (X11), or log out and in.

The default server is a Clankermux instance on the same machine:

```text
http://127.0.0.1:8080
```

Right-click the applet and choose **Configure** to enter a different hostname,
IP address, or complete HTTP/HTTPS URL. The settings window also controls the
polling interval, panel mode, and family visibility.

## API and security

The applet uses Clankermux's unauthenticated, read-only public widget API:

- `GET /public/v1/status`
- `GET /public/v1/accounts`
- `GET /public/v1/workloads`

Requires the replacement API from **2026.9.36 or newer**. Status uses service
readiness and configured/paused totals. The obsolete routing-candidate badge
and setting are removed; account rows follow the server's stable order.

Accounts and status follow the configured interval (30 seconds by default).
Workloads poll every 10 seconds for availability, with exponential retries
from 20 seconds up to five minutes. Manual refresh bypasses backoff. A newly
expired weekly checkpoint triggers a refresh without advancing the deadline.

Availability and weekly budgets have separate `computedAt` timestamps; weekly
budgets also use `evidenceObservedAt`. A new envelope `generatedAt` does not
refresh cached evidence. Missing timestamps, network errors and observations
at least three minutes old suppress advice. Fresh availability remains visible
even when weekly evidence is stale, and vice versa.

Account names are public. Credentials, API-key secrets, prompts, and response
bodies are not exposed. The widget uses only read-only endpoints.

## Development

The invented payloads in `test/api-examples` pin the public v1 guidance contract,
including partial weekly evidence, search limits and family restrictions. They were
copied from the server documentation on 2026-09-09. New object fields are accepted;
unknown guidance states and intervals remain neutral.

No third-party dependencies are required. Run the checks with:

```sh
make check test
```

## License

Licensed under the [GNU General Public License v3.0](LICENSE).
