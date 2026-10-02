import assert from "node:assert/strict";
import test from "node:test";
import {
  activityRefreshInterval,
  getActivityApi,
  renderActivityLabel,
} from "../lib/activity.ts";

const theme = { fg: (color, text) => `${color}:${text}` };
const key = Symbol.for("pi-activity:api");

test("idle activity does not add a row", () => {
  assert.equal(renderActivityLabel(undefined, theme, false), undefined);
  assert.equal(renderActivityLabel({ getActivity: () => ({ isWorking: false, label: null }) }, theme, false), undefined);
});

test("the provider paints the current label with the live theme", () => {
  let label = "exploring";
  const calls = [];
  const api = {
    getActivity: () => ({ isWorking: true, label }),
    shimmerText: (text, activeTheme) => {
      calls.push([text, activeTheme]);
      return `shimmer:${text}`;
    },
  };
  assert.equal(renderActivityLabel(api, theme, false), "shimmer:exploring");
  label = "fixing-types";
  assert.equal(renderActivityLabel(api, theme, false), "shimmer:fixing-types");
  assert.deepEqual(calls, [["exploring", theme], ["fixing-types", theme]]);
});

test("missing provider/painter and blank labels have a working fallback", () => {
  assert.equal(renderActivityLabel(undefined, theme, true), "muted:working");
  assert.equal(renderActivityLabel({ getActivity: () => ({ isWorking: true, label: "  " }) }, theme, false), "muted:working");
  assert.equal(renderActivityLabel({ getActivity: () => ({ isWorking: true, label: "fixing\n types" }) }, theme, false), "muted:fixing types");
});

test("provider lookup is optional and validates its entry point", () => {
  const previous = globalThis[key];
  try {
    delete globalThis[key];
    assert.equal(getActivityApi(), undefined);
    globalThis[key] = {};
    assert.equal(getActivityApi(), undefined);
    const api = { getActivity: () => ({ isWorking: false, label: null }) };
    globalThis[key] = api;
    assert.equal(getActivityApi(), api);
  } finally {
    if (previous === undefined) delete globalThis[key];
    else globalThis[key] = previous;
  }
});

test("animation uses the provider cadence with safe fallbacks", () => {
  assert.equal(activityRefreshInterval({ shimmerIntervalMs: 80 }), 80);
  assert.equal(activityRefreshInterval(undefined), 90);
  for (const interval of [NaN, Infinity, 0, -1, "80"]) {
    assert.equal(activityRefreshInterval({ shimmerIntervalMs: interval }), 90);
  }
  assert.equal(activityRefreshInterval({ shimmerIntervalMs: 2000 }), 1000);
});
