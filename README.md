# Clankermux Usage for Cinnamon

[![CI](https://github.com/d4rken/clankermux-mint-applet/actions/workflows/ci.yml/badge.svg)](https://github.com/d4rken/clankermux-mint-applet/actions/workflows/ci.yml)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

A native Linux Mint/Cinnamon panel applet for monitoring the accounts behind a
[Clankermux](https://github.com/d4rken/clankermux) proxy.

The panel shows separate headroom signals for each servable class and model
family. For example:

```text
Claude [ cut | add ]  GPT [ cut | add ]  Fable B* [ cut | add ]
```

When availability is degraded, the default-context account count appears as an
exception beside the workload signals, for example `3/4!`. It stays separate
from the headroom bars because pace describes quota capacity while availability
also includes pauses, cooldowns, credentials, and provider overloads.

Rightward bars mean room for more measured load. Leftward bars mean load must be
cut. `B` marks a conservative family bound rather than an exact threshold, and
`*` marks incomplete evidence. Account depth, including spent and unreadable
accounts, stays in the tooltip and popup instead of consuming panel space.

Exact percentages are hidden in the panel by default because counterfactual pace
moves as recent burn changes. They remain in the tooltip and popup, and can be
enabled in settings. The panel adds no state words because the graph already
carries their direction. Proportional fill shows a stated magnitude. Full-scale
fill marks a definite scale-end result, including a reduction beyond the 50%
probe range.
Exact state text and pool-wide pace stay in the tooltip and popup.
Click the applet for:

- exact pool and per-workload pace headroom, including bound and evidence qualifiers
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
Null is never zero: depending on the outcome it can mean robust beyond the
positive probe range, a required reduction beyond the 50% probe range, or no
reading. The popup states those cases directly.

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
30 seconds. Pace, runway, and workload projections refresh at most once per
minute, or immediately with **Refresh now**. The server memoizes pacing and
workload headroom for the same interval. These endpoints contain no personal
identities, credential material, API-key metadata, or write access.

## Development

No third-party dependencies are required. Run the checks with:

```sh
make check test
```

## License

Licensed under the [GNU General Public License v3.0](LICENSE).
