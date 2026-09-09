# Clankermux Usage for Cinnamon

[![CI](https://github.com/d4rken/clankermux-mint-applet/actions/workflows/ci.yml/badge.svg)](https://github.com/d4rken/clankermux-mint-applet/actions/workflows/ci.yml)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

A native Linux Mint/Cinnamon panel applet for monitoring the accounts behind a
[Clankermux](https://github.com/d4rken/clankermux) proxy.

The panel shows one icon and advice line per workload, arranged horizontally:

```text
[OpenAI] ↑ ~25% room   [Anthropic] ↓ ~20% pace   [F] ↓ ~20% pace*
```

All headlines use `/workload-headroom` guidance until the next weekly reset.
The percentage describes an approximate change in work rate, not quota remaining
or an exact agent count. `*` identifies a conservative family bound. Fable is an
additional restriction within Claude capacity; their percentages cannot be added.
The F monogram identifies Fable and is not an official brand mark.

When no percentage is available, the panel uses short indicators: `Risk` for
projected exhaustion, `Holds` for reaching the next reset, `?` for unknown or
limited evidence, `…` for learning, `None` for no accounts, and `Out` for exhausted
quota. Stale or expired forecasts show `Stale`. Hover for the full state names.

Click the applet for the account utilization bars, availability and reset times,
plus refresh and dashboard shortcuts. Forecast explanations and long-term advice
are not displayed in the popup.

Only server states `increase` and `reduce` permit numeric advice. A raw percentage
can coexist with `uncertain`; the applet suppresses that number. Missing or legacy
forecast fields never fall back to a burn-ratio calculation. Paused accounts and
banked reset credits are handled by the server's forecast.

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
polling interval, account order, and family visibility.

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
cached response does not make it fresh. Stale advice is replaced by the word Stale. Computation time is distinct from each account's
usage observation time. Countdowns and freshness update between network polls.

Account names are public. Credentials, API-key secrets, prompts, and response
bodies are not exposed. The widget uses only read-only endpoints.

## Development

The invented payloads in `test/api-examples` pin the public v1 guidance contract,
including incomplete evidence and opposing short/long-term advice. They were
copied from the server documentation on 2026-09-09. New object fields are accepted;
unknown guidance states and intervals remain neutral.

No third-party dependencies are required. Run the checks with:

```sh
make check test
```

## License

Licensed under the [GNU General Public License v3.0](LICENSE).
