# Clankermux Usage for Cinnamon

[![CI](https://github.com/d4rken/clankermux-mint-applet/actions/workflows/ci.yml/badge.svg)](https://github.com/d4rken/clankermux-mint-applet/actions/workflows/ci.yml)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

A Linux Mint/Cinnamon panel applet showing weekly usage for the accounts behind
a [Clankermux](https://github.com/d4rken/clankermux) proxy.

## What it looks like

Combined weekly usage, one row per provider, sized to the panel height:

```text
[OpenAI]    50%
[Anthropic] 30%
[F]         95%
```

Or forecast advice, selected under **Configure > Display > Panel display**.
`↑25%` estimates the current usage rate can rise 25% and still last until the
reset; `↓20%` estimates it needs to drop 20% to last:

```text
[OpenAI]    ↑25%
[Anthropic] ↓20%
[F]         ↓20%*
```

Panels under 39px show the readings side by side instead of stacked.

Click the applet for per-account usage bars, weekly budget, and current
availability. In usage mode `*` marks a partial or cached reading; in forecast
mode it marks a conservative bound.

## Install

Requires a Clankermux server running **2026.9.36 or newer**.

```sh
make install
```

Open **System Settings → Applets**, select **Clankermux Usage**, and click the
`+` button. If it does not appear immediately, press <kbd>Alt</kbd>+<kbd>F2</kbd>,
enter `r`, and press <kbd>Enter</kbd> to reload Cinnamon (X11), or log out and
back in.

## Setup

The applet defaults to a Clankermux instance on the same machine:

```text
http://127.0.0.1:8080
```

Right-click the applet and choose **Configure** to point it at a different
hostname, IP address, or full HTTP/HTTPS URL. The same window sets the polling
interval, panel display mode, and family visibility.

## License

[GNU General Public License v3.0](LICENSE).
