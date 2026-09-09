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

Forecast headlines use `/workload-headroom` guidance until the next weekly reset.
The percentage describes an approximate change in work rate, not quota remaining
or an exact agent count. `*` identifies a conservative family bound. Fable is an
additional restriction within Claude capacity; their percentages cannot be added.
The F monogram identifies Fable and is not an official brand mark.

When no percentage is available, the panel uses short indicators: `Risk` for
projected exhaustion, `Holds` for reaching the next reset, `?` for unknown or
limited evidence, `Learn` when learning explains missing coverage, `None` for no
accounts, and `Out` for exhausted quota. Stale or expired forecasts show `Stale`.
Hover for full states, modeled coverage and the tested pace range when relevant.
`Learn` describes coverage still learning; a pace percentage may remain unavailable afterward.

Click the applet for the account utilization bars, availability and reset times,
plus a three-line forecast summary. Click the summary to open the dashboard.
The summary remains available in both panel modes. Each bar shows a compact
window forecast: `out ~2h`, `no usage`, `unstarted`, `learning`, or `—`.
Exhaustion is flagged only before a known reset.
These estimates use `windows[].forecast`; missing forecasts on older servers
remain unavailable even when a regression `prediction` exists. Learning does
not end just because `readyAt` passes. Low-confidence estimates use warning
color and are qualified in the accessible description.
Zero-usage windows need measured activity; waiting alone need not resolve them.
Short-history windows need at least an hour of usable burn history and a fresh
reading. Their `readyAt` is an earliest useful reading, not a readiness guarantee.

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
