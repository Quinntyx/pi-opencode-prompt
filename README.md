# pi-opencode-prompt

Provide an OpenCode-inspired Pi editor, status row, and working indicator.

While the agent works, a transparent activity row sits one blank line above its
prompt box. It uses [pi-activity](https://git.quinntyx.dev/quinntyx/pi-activity)'s
current label and shimmer painter, including the selected effort level's theme
color. Elapsed run time, total active session time, and the run's turn count are
right-aligned. The original wave animation stays in the prompt's bottom status
row beside the model identity.

When a run finishes, the same row retains pi-tool-tree's summary: `✻ Agent took …`
on the left and `Total time … · N turns` on the right. Session totals exclude idle
time and include history restored by pi-activity. The next run replaces this
summary. No tool-call grouping or transcript rails are installed.

Load pi-activity before this package to enable activity labels and shimmer. Without
it, the row falls back to a muted `working` label. The prompt subscribes to activity
changes, repaints at the provider's cadence, and cleans up on session shutdown.

Install as a Pi git package:

```json
"git:git.quinntyx.dev/quinntyx/pi-opencode-prompt@dev"
```

## Tests

With Node 22.18+ and Pi installed globally:

```sh
node --test tests/*.test.mjs
```

Set `PI_TEST_NPM_ROOT` if Pi is installed outside the default global npm root.

## CLIProxyAPI quota footer

When a `cliproxyapi` model is selected, the bottom status cluster shows
`5h 75% (225%) · wk 28% (187%)`. Leading values show the usable remainder on
this session + model's affinity-bound account. Parenthesized totals sum usable
percentage points across enabled, distinct Codex subscriptions after operator
caps; the current shared 50% + two 100% account setup has a maximum of 250% per
window.
They show `?` before the first routed request, not a guessed account. Five-hour
totals use immediately available capacity; weekly totals show the independent
remaining weekly budget. Exhausting a five-hour window does not erase the weekly
remainder, which becomes spendable again after the short reset. Both windows
deduct operator-reserved capacity (`max(0, cap - used)`); maximum totals in this
setup remain 250%. There is no `blocked` marker or hardcoded weekly zero.
Unknown observations remain `?` and connection failures clear stale figures.

The extension uses the public `status-item` event protocol and refreshes every
five seconds, plus request/model/session boundaries. Loopback URLs use the fork's
`GET /v8/management/observability/quota/remaining` management endpoint with the
private local management key (never from tracked config). Tailscale MagicDNS,
100.64.0.0/10 IPv4 and fd7a:115c:a1e0::/48 IPv6 URLs use the read-only
`GET /v1/quota/remaining` endpoint without an API key or local secrets, matching
the tailnet-only, keyless inference deployment. It does not require newer Pi
registry authorization methods. Other remote hosts, URL credentials and redirects
are rejected. It stops polling and clears its item when another provider is
selected or the session shuts down. Provider attribution renders as `CLIProxyAPI`.
