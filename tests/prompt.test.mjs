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

function host({ working = false, hasUI = true, provider = true } = {}) {
  let state = { isWorking: working, label: working ? "exploring" : null };
  let subscriber;
  let unsubscribed = 0;
  let renders = 0;
  let editor;
  const painted = [];
  const events = new Map();
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
    events: { on() {}, emit() {} },
    getThinkingLevel: () => "high",
    exec: async () => ({ stdout: "test-branch" }),
  };
  const tui = { requestRender: () => { renders++; } };
  const ctx = {
    hasUI,
    mode: "test",
    cwd: "/tmp",
    model: { id: "test-model", provider: "test", contextWindow: 1000 },
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
    theme,
    emit: (name) => events.get(name)?.({}, ctx),
    setActivity(next) { state = next; subscriber?.(); },
    close() {
      events.get("session_shutdown")({}, ctx);
      if (previous === undefined) delete globalThis[key];
      else globalThis[key] = previous;
    },
  };
}

test("activity sits above the prompt without a background or tree rail", async () => {
  const h = host();
  try {
    assert.equal(h.editor.render(80).length, 5);
    h.emit("agent_start");
    h.setActivity({ isWorking: true, label: "implementing" });
    const lines = h.editor.render(80);
    assert.equal(lines.length, 6);
    assert.match(clean(lines[0]), /^  \S+ implementing$/);
    assert.equal(lines[0].includes("\x1b[48"), false);
    assert.equal(/[┃│├└]/u.test(clean(lines[0])), false);
    assert.match(clean(lines[1]), /^┃/);
    assert.equal(h.painted.at(-1)[1], h.theme);
    const renders = h.renders;
    await delay(110);
    assert.ok(h.renders > renders, "the shimmer is repainted while working");
    h.setActivity({ isWorking: false, label: null });
    h.emit("agent_settled");
    assert.equal(h.editor.render(80).length, 5);
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
