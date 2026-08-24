# Clankermux Usage for Cinnamon

[![CI](https://github.com/d4rken/clankermux-mint-applet/actions/workflows/ci.yml/badge.svg)](https://github.com/d4rken/clankermux-mint-applet/actions/workflows/ci.yml)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

A native Linux Mint/Cinnamon panel applet for monitoring the accounts behind a
[Clankermux](https://github.com/d4rken/clankermux) proxy.

The panel leads with Clankermux's projected quota runway, followed by
server-computed mean utilization for the 5-hour, 7-day, and model-specific
quota pools. For example:

```text
R 5d 18h  5h [  5%]  7d [ 49%]  Fable [ 67%]
```

When availability is degraded, the default-context account count appears as an
exception beside the runway, for example `R 18h · 3/4!`. It stays out of the
normal panel display because runway describes quota capacity while availability
also includes pauses, cooldowns, credentials, and provider overloads.

Unused model-specific quota families are omitted from the panel to conserve
space, but remain available in the clicked details. Core 5-hour and 7-day
meters remain visible at 0%.

Each percentage is the unweighted mean reported by Clankermux across accounts
that supplied that window. The popup shows contributor and unknown-account
counts so a partial mean cannot pass as full coverage. Click the applet for:

- projected quota runway, model horizon, API-key coverage, and the account/window causing run-out
- 5-hour and 7-day usage bars for every account
- model-specific weekly limits such as Fable
- per-window forecasts and reset countdowns where Clankermux has sufficient evidence
- the default candidate for a fresh, unpinned, nominal-sized request
- availability, credential, provider-overload, and measurement-freshness state
- the last successful refresh time, so stale widget data is easy to spot
- manual refresh and a shortcut to the Clankermux dashboard

When Clankermux observes an upstream provider overload, the panel gains an
hourglass. The popup distinguishes provider-wide and model-scoped breakers,
including open and half-open recovery states.

The runway is green above the configured warning duration, orange below it,
and red when the pool is out of quota. Incomplete API-key coverage adds `*` and
is always warning-colored: an unobserved key could have less runway than the
stated projection. `>14d` means no run-out was found inside the server's
14-day modelling horizon; it never claims infinity.

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
polling interval, panel bars, runway warning duration, and scoped-limit visibility.

## API and security

The applet uses Clankermux's unauthenticated, read-only public widget API:

- `GET /public/v1/status`
- `GET /public/v1/accounts`
- `GET /public/v1/runway`

Status and accounts follow the configured refresh interval, which defaults to
30 seconds. The more expensive runway projection is cached and refreshed at
most every five minutes, or immediately with **Refresh now**. These endpoints
contain no personal identities, credential material, API-key metadata, or write
access.

## Development

No third-party dependencies are required. Run the checks with:

```sh
make check test
```

## License

Licensed under the [GNU General Public License v3.0](LICENSE).
