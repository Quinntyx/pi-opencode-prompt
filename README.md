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
