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
`5h 225% (75%) · wk 187% (28%)`. Totals sum usable percentage points across
enabled, distinct Codex subscriptions, after operator caps; the current shared
50% + two 100% account setup has a maximum of 250% per window. Parentheses
show the usable remainder on this session + model's actual affinity-bound account.
They show `?` before the first routed request, not a guessed account. Totals
use the endpoint's `available_percent`: only capacity on accounts that can
currently serve the selected model counts. A weekly-capped account contributes
zero to both windows even if its five-hour budget is unspent; accounts blocked
by five-hour exhaustion or model cooldowns likewise contribute zero to both.
Reserved capacity above an operator cap is never included. Parentheses are zero
when this session's bound account is blocked. If no account can route, both totals
are zero and the footer appends `· blocked`. Unknown usable quota stays `?`, never
falls back to unspent budgets, and connection failures clear stale values.

The extension uses the public `status-item` event protocol and refreshes every
five seconds, plus request/model/session boundaries. It requires the fork's
`GET /v8/management/observability/quota/remaining` management endpoint and reads
the management key from the private local CLIProxyAPI secrets file (never from
tracked config). Requests are restricted to a loopback proxy URL and redirects
are rejected. It stops polling and clears its item when another provider is
selected or the session shuts down. Provider attribution renders as `CLIProxyAPI`.
