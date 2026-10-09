import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { CustomEditor } from "./fixtures/host.mjs";

const npmRoot = process.env.PI_TEST_NPM_ROOT || execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
const hostRequire = createRequire(join(npmRoot, "@earendil-works/pi-coding-agent/package.json"));
const { createJiti } = hostRequire("jiti");
const jiti = createJiti(import.meta.url, {
  alias: {
    "@earendil-works/pi-coding-agent": fileURLToPath(new URL("./fixtures/host.mjs", import.meta.url)),
    "@earendil-works/pi-tui": hostRequire.resolve("@earendil-works/pi-tui"),
  },
  moduleCache: false,
  fsCache: false,
});
const { visibleWidth } = await jiti.import("@earendil-works/pi-tui");
const { default: extension } = await jiti.import("../extensions/opencode-prompt.ts");
const key = Symbol.for("pi-activity:api");
const clean = (text) => text.replace(/\x1b\[[0-9;]*m/g, "");

function host({ working = false, hasUI = true, provider = true, workedMs = 0, modelProvider = "test" } = {}) {
  let state = { isWorking: working, label: working ? "exploring" : null };
  let stats = { workedMs };
  let subscriber;
  let unsubscribed = 0;
  let renders = 0;
  let editor;
  const painted = [];
  const events = new Map();
  const statusBus = new Map();
  const theme = {
    fg: (_color, text) => `\x1b[38;5;123m${text}\x1b[39m`,
    bg: (_color, text) => `\x1b[48;5;235m${text}\x1b[49m`,
    bold: (text) => text,
    getThinkingBorderColor: () => (text) => `\x1b[38;5;130m${text}\x1b[39m`,
  };
  const previous = globalThis[key];
  if (provider) {
    globalThis[key] = {
      getActivity: () => state,
      getStats: () => stats,
      shimmerIntervalMs: 80,
      shimmerText: (label, activeTheme) => {
        painted.push([label, activeTheme]);
        return activeTheme.fg("text", label);
      },
      subscribe: (listener) => {
        subscriber = listener;
        return () => { subscriber = undefined; unsubscribed++; };
      },
    };
  } else delete globalThis[key];
  const pi = {
    on: (name, listener) => events.set(name, listener),
    events: { on: (name, listener) => statusBus.set(name, listener), emit: (name, data) => statusBus.get(name)?.(data) },
    getThinkingLevel: () => "high",
    exec: async () => ({ stdout: "test-branch" }),
  };
  const tui = { requestRender: () => { renders++; } };
  const ctx = {
    hasUI,
    mode: "test",
    cwd: "/tmp",
    model: { id: "test-model", provider: modelProvider, contextWindow: 1000 },
    getContextUsage: () => ({ tokens: 100, contextWindow: 1000, percent: 10 }),
    ui: {
      theme,
      setWorkingVisible() {},
      setFooter() {},
      setEditorComponent: (factory) => { editor = factory(tui, {}, {}); },
    },
  };
  extension(pi);
  events.get("session_start")({}, ctx);
  return {
    get editor() { return editor; },
    get renders() { return renders; },
    get unsubscribed() { return unsubscribed; },
    painted,
    statusItem: (data) => statusBus.get("status-item")?.(data),
    theme,
    emit: (name) => events.get(name)?.({}, ctx),
    setActivity(next, change = { type: "label-change" }) { state = next; subscriber?.(state, change); },
    setStats(next) { stats = next; },
    finish(run) {
      stats.workedMs += run.elapsedMs;
      state = { isWorking: false, label: null };
      subscriber?.(state, { type: "run-end", run });
      events.get("agent_settled")?.({}, ctx);
    },
    close() {
      events.get("session_shutdown")({}, ctx);
      if (previous === undefined) delete globalThis[key];
      else globalThis[key] = previous;
    },
  };
}

test("activity and stats sit above the prompt while the wave stays in the bottom status row", async () => {
  const h = host();
  try {
    assert.equal(h.editor.render(80).length, 5);
    h.emit("agent_start");
    h.setActivity({ isWorking: true, label: "implementing" });
    const lines = h.editor.render(80);
    assert.equal(lines.length, 7);
    assert.match(clean(lines[0]), /^  implementing\s+Elapsed 0s · Total time 0s · 0 turns\s*$/);
    assert.doesNotMatch(clean(lines[0]), /[⠀-⣿]/u);
    assert.match(clean(lines.at(-2)), /[⠀-⣿]{4}/u);
    assert.equal(lines[0].includes("\x1b[48"), false);
    assert.equal(/[┃│├└]/u.test(clean(lines[0])), false);
    assert.equal(lines[1], "");
    assert.match(clean(lines[2]), /^┃/);
    assert.equal(h.painted.at(-1)[1], h.theme);
    const renders = h.renders;
    await delay(110);
    assert.ok(h.renders > renders, "the shimmer is repainted while working");
    h.setActivity({ isWorking: false, label: null });
    h.emit("agent_settled");
    assert.equal(h.editor.render(80).length, 7);
    assert.match(clean(h.editor.render(80)[0]), /Agent took/);
    assert.doesNotMatch(clean(h.editor.render(80).at(-2)), /[⠀-⣿]/u);
    h.emit("session_shutdown");
    assert.equal(h.unsubscribed, 1);
    const stopped = h.renders;
    await delay(110);
    assert.equal(h.renders, stopped, "idle/shutdown leaves no animation timer");
  } finally { h.close(); }
});

test("loading during active work starts the row and its timer", async () => {
  const h = host({ working: true });
  try {
    assert.match(clean(h.editor.render(80)[0]), /exploring/);
    const renders = h.renders;
    await delay(110);
    assert.ok(h.renders > renders);
    h.setActivity({ isWorking: false, label: null });
    assert.equal(h.editor.render(80).length, 5);
  } finally { h.close(); }
});

test("fallback works without pi-activity and narrow rows stay within width", () => {
  const h = host({ provider: false });
  try {
    h.emit("agent_start");
    assert.match(clean(h.editor.render(80)[0]), /working/);
    for (const width of [0, 1, 2, 3, 5, 7, 8, 20, 80]) {
      for (const line of h.editor.render(width)) assert.ok(visibleWidth(line) <= width, `width ${width}: ${JSON.stringify(line)}`);
    }
  } finally { h.close(); }
});

test("headless sessions do not install a prompt or start UI animation", () => {
  const h = host({ hasUI: false, working: true });
  try {
    h.emit("agent_start");
    assert.equal(h.editor, undefined);
    assert.equal(h.renders, 0);
  } finally { h.close(); }
});


test("live and finished stats match pi-tool-tree and exclude idle session time", () => {
  const h = host({ workedMs: 120_000 });
  try {
    h.emit("agent_start");
    const run = { startedAt: Date.now() - 15_000, elapsedMs: 15_000, turns: 3 };
    h.setActivity({ isWorking: true, label: "implementing", run });
    assert.match(clean(h.editor.render(140)[0]), /implementing\s+Elapsed 15s · Total time 2m 15s · 3 turns/);
    // pi-activity stamps its total on final message_end, before run-end.
    h.setStats({ workedMs: 135_000 });
    assert.match(clean(h.editor.render(140)[0]), /Total time 2m 15s/);
    h.setStats({ workedMs: 120_000 });
    h.finish(run);
    const completed = h.editor.render(140);
    assert.match(clean(completed[0]), /✻ Agent took 15s\s+Total time 2m 15s · 3 turns/);
    assert.doesNotMatch(clean(completed.at(-2)), /Agent took|Completed in|Total time/);
    assert.deepEqual(h.editor.render(140), completed, "completed totals do not advance while idle");

    h.setActivity({ isWorking: true, label: "testing", run: { elapsedMs: 2000, turns: 1 } }, { type: "run-start" });
    h.emit("agent_start");
    assert.match(clean(h.editor.render(140)[0]), /testing\s+Elapsed 2s · Total time 2m 17s · 1 turn\s*$/);
    assert.doesNotMatch(clean(h.editor.render(140)[0]), /Agent took/);
  } finally { h.close(); }
});

test("finished summaries fit narrow widths and session transitions clear them", () => {
  const h = host({ workedMs: 60_000 });
  try {
    h.emit("agent_start");
    h.finish({ elapsedMs: 1000, turns: 1 });
    for (const width of [0, 1, 2, 3, 5, 7, 8, 20, 80, 140]) {
      for (const line of h.editor.render(width)) assert.ok(visibleWidth(line) <= width, `width ${width}: ${JSON.stringify(line)}`);
    }
    h.setStats({ workedMs: 0 });
    h.emit("session_start");
    assert.equal(h.editor.render(80).length, 5);
    assert.equal(h.unsubscribed, 1);
  } finally { h.close(); }
});

test("autocomplete stays above the separated activity row", () => {
  const h = host();
  try {
    CustomEditor.autocomplete = ["/help"];
    h.emit("agent_start");
    h.setActivity({ isWorking: true, label: "exploring", run: { elapsedMs: 0, turns: 1 } });
    const lines = h.editor.render(140);
    assert.match(clean(lines[0]), /^\/help/);
    assert.match(clean(lines[1]), /exploring/);
    assert.equal(lines[2], "");
    assert.match(clean(lines[3]), /^┃/);
  } finally {
    CustomEditor.autocomplete = [];
    h.close();
  }
});


test("CLIProxyAPI attribution and generic quota item appear in the bottom status cluster",()=>{
 const h=host({modelProvider:"cliproxyapi"});
 h.statusItem({key:"cliproxyapi-quota",text:"5h 75% (225%) · wk 28% (187%)"});
 const rows=h.editor.render(220).map(clean);
 assert.ok(rows.some(row=>row.includes("CLIProxyAPI") && row.includes("5h 75% (225%) · wk 28% (187%)")),rows.join("\n"));
 h.statusItem({key:"cliproxyapi-quota",text:null});assert.ok(!h.editor.render(220).map(clean).some(row=>row.includes("5h 75%")));h.close();
});
