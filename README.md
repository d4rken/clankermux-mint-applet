# Clankermux Usage for Cinnamon

[![CI](https://github.com/d4rken/clankermux-mint-applet/actions/workflows/ci.yml/badge.svg)](https://github.com/d4rken/clankermux-mint-applet/actions/workflows/ci.yml)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

A native Linux Mint/Cinnamon panel applet for monitoring the accounts behind a
[Clankermux](https://github.com/d4rken/clankermux) proxy.

The panel shows separate pace signals until the next weekly reset for each
servable class and model family. For example:

```text
Claude [ cut | add ]  GPT [ cut | add ]  Fable B* [ cut | add ]
```

When availability is degraded, the default-context account count appears as an
exception beside the workload signals, for example `3/4!`. It stays separate
from the headroom bars because pace describes quota capacity while availability
also includes pauses, cooldowns, credentials, and provider overloads.

Rightward bars show measured pace margin until the next weekly reset. Leftward
bars show a required pace reduction if the current burn continues. `B` marks a
conservative family bound, and `*` marks incomplete account coverage. Eligible,
spent and unreadable account counts stay in the tooltip and popup.

Each workload's popup and tooltip show two independent intervals:

- **Until next weekly reset**, with the earliest known weekly deadline among
  active accounts supporting that workload and a countdown in local time.
- **Long-term pace**, with the number of days supplied by the server, usually 14.

A workload can have room until its next reset while needing a reduction over
14 days. The next weekly deadline does not imply that every account resets
together; five-hour constraints still participate in both forecasts.

Exact percentages are hidden in the panel by default because counterfactual pace
moves as recent burn changes. They remain in the tooltip and popup, and can be
enabled in settings. Proportional fill shows a stated magnitude, capped at the graph's 50% scale.
An exhausted modeled workload also fills the cut side. Missing percentages,
early estimates and unavailable forecasts leave the graph neutral.
`Stale` and `Expired` remain visible in the panel even when percentages are hidden.
API-key/pool pace and runway remain secondary context in the tooltip and popup;
they do not describe how much an individual workload can grow.
Click the applet for:

- next-reset and long-term workload forecasts, including bound and evidence qualifiers
- class burn ratios, weekly outlook, failover depth, and 5-hour governor state
- projected quota runway, uncertainty band, model horizon, API-key coverage, and cause
- 5-hour and 7-day usage bars for every account
- model-specific weekly limits such as Fable
- per-window forecasts and reset countdowns where Clankermux has sufficient evidence
- the default candidate for a fresh, unpinned, nominal-sized request
- availability, credential, provider-overload, and measurement-freshness state
- accounts/status freshness plus independent cached/error state for each pace feed
- manual refresh and a shortcut to the Clankermux dashboard

When Clankermux observes an upstream provider overload, the panel gains an
hourglass. The popup distinguishes provider-wide and model-scoped breakers,
including open and half-open recovery states.

The exact class headroom is a threshold. Family headroom is a conservative
bound because Clankermux cannot isolate a family's share of account-wide burn.
Only server-classified measured projections produce pace percentages. Structural
projections display “Early / structural estimate”; missing or unknown evidence
withholds advice. Null headroom never means zero, ample capacity or a severe cut.
A measured forecast with no percentage states whether it reaches its interval
or may exhaust earlier, with “Pace margin unavailable” or “Required cut unavailable”.
Exhaustion estimates with unreadable accounts are lower bounds on runway.

Older servers without `nextReset`, or rows with a null/invalid deadline, show
“Next-reset forecast unavailable” while keeping explicitly labelled long-term
context. When a deadline passes, the applet marks it expired and requests an
updated snapshot. It never advances a deadline or assumes quota has recovered.

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
cached response does not make it fresh. The last reading and its computation
timestamp stay in the details as historical context; stale workload bars are
neutral. Computation time is distinct from each account's usage observation time.
Countdowns and freshness update between network polls.

These endpoints contain no personal identities, credential material, API-key
metadata, or write access.

## Development

No third-party dependencies are required. Run the checks with:

```sh
make check test
```

## License

Licensed under the [GNU General Public License v3.0](LICENSE).
