# Clankermux Usage for Cinnamon

[![CI](https://github.com/d4rken/clankermux-mint-applet/actions/workflows/ci.yml/badge.svg)](https://github.com/d4rken/clankermux-mint-applet/actions/workflows/ci.yml)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

A native Linux Mint/Cinnamon panel applet for monitoring the accounts behind a
[Clankermux](https://github.com/d4rken/clankermux) proxy.

The panel shows one pace bar per servable class and per model family. For
example:

```text
Claude [ cut | add ]  GPT [ cut | add ]  Fable [ cut | add ]
```

Class bars (Claude, GPT) come from the class burn ratio relative to sustainable
pace. A rightward bar means burn can rise, a leftward bar means it has to come
down, the magnitude is capped at the graph's 50% scale, and the colour follows
the server's burn tone. When a class has no stated burn ratio, or its pacing
reading is stale or past its deadline, the bar falls back to that class's
headroom until the next weekly reset.

Family bars (Fable) come from the conservative family headroom until the next
weekly reset. A measured outcome without a percentage fills the bar to scale in
its direction; a structural estimate shows the same direction in grey.

The panel carries no availability counter: account states live in the tooltip
and the popup. `Stale` and `Expired` stay visible in the panel. Exact
percentages are hidden by default because pace moves as recent burn changes;
the tooltip and popup always show them, and settings can add them to the panel.

Click the applet for:

- pacing detail per workload: burn ratio, weekly usage on the least-used
  account, projected run-out count, failover depth, and reset countdown
- quota runway with its cause, and a coverage qualifier when keys are unobserved
- per-account state with 5-hour and 7-day usage bars
- model-specific weekly limits such as Fable
- per-window forecasts and reset countdowns where Clankermux has sufficient evidence
- the default candidate for a fresh, unpinned, nominal-sized request
- availability, credential, provider-overload, and measurement state
- accounts/status freshness plus cached or unavailable state for the pace feeds
- manual refresh and a shortcut to the Clankermux dashboard

Provider overloads appear in the tooltip and the popup, which distinguishes
provider-wide from model-scoped breakers, including open and half-open recovery
states.

The exact class headroom is a threshold. Family headroom is a conservative
bound because Clankermux cannot isolate a family's share of account-wide burn.
Only server-classified measured projections produce headroom percentages;
structural estimates are marked early and stay grey, and missing or unknown
evidence withholds advice altogether. Exhaustion estimates with unreadable
accounts are lower bounds on runway.
Family coverage distinguishes accounts that have not used the family this week
from other unreadable accounts. Both remain excluded from the projection;
untouched accounts do not imply a 0% usage reading. Older servers without
`unopenedAccounts` retain the combined unreadable count.

Older servers without `nextReset`, or rows with a null or invalid deadline,
report no reading instead of a guess. When a deadline passes, the applet marks
it expired and requests an updated snapshot. It never advances a deadline or
assumes quota has recovered.

Paused accounts remain visible in account details. Workload forecasts and pacing
use the server's active capacity; the applet neither averages account usage to
calculate pace nor adds capacity for banked reset credits.

Usage bars turn orange at 80% and red at 100%. Individual forecast confidence
remains visible in the clicked details; low-confidence exhaustion is never
colored as certain.

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
polling interval, panel bars, popup runway warning duration, and family visibility.

## API and security

The applet uses Clankermux's unauthenticated, read-only public widget API:

- `GET /public/v1/status`
- `GET /public/v1/accounts`
- `GET /public/v1/runway`
- `GET /public/v1/pacing`
- `GET /public/v1/workload-headroom`

Status and accounts follow the configured refresh interval, which defaults to
30 seconds. Pace, runway, and workload projections refresh independently about
once per minute, immediately after a new deadline expires, or with **Refresh now**.
Failed forecast requests back off from two minutes to a five-minute cap. A
successful cycle restores the minute cadence; manual refresh bypasses backoff.
The server memoizes pacing and workload headroom for 60 seconds, so an early
refresh may return the same computation.

Forecasts become stale on a fetch failure, when their computation timestamp is
missing, or when `generatedAt` is at least three minutes old. Fetching the same
cached response does not make it fresh. A stale bar goes neutral and keeps its
last reading in the popup. Computation time is distinct from each account's
usage observation time. Countdowns and freshness update between network polls.

These endpoints contain no personal identities, credential material, API-key
metadata, or write access.

## Development

No third-party dependencies are required. Run the checks with:

```sh
make check test
```

## License

Licensed under the [GNU General Public License v3.0](LICENSE).
