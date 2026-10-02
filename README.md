# pi-opencode-prompt

Provide an OpenCode-inspired Pi editor, status row, and working indicator.

While the agent works, a single transparent activity row sits immediately above
its prompt box. It uses [pi-activity](https://git.quinntyx.dev/quinntyx/pi-activity)'s
current label and shimmer painter, including the selected effort level's theme
color. The spinner moves to this row; the row disappears when idle. No tool-call
grouping or transcript rails are installed.

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
