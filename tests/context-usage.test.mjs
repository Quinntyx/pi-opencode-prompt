import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
const npmRoot = process.env.PI_TEST_NPM_ROOT || execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
const requireHost = createRequire(join(npmRoot, "@earendil-works/pi-coding-agent/package.json"));
const { createJiti } = requireHost("jiti");
const { getDisplayContextUsage } = await createJiti(import.meta.url, { moduleCache: false, fsCache: false }).import("../lib/context-usage.ts");
const symbol = Symbol.for("billion-context-pi.live-context-usage.v1");
const query = { sessionId: "current", modelId: "gpt-6.1-sol", provider: "cliproxyapi" };
const ctx = { model: { id: query.modelId, provider: query.provider, contextWindow: 272000 },
  sessionManager: { getSessionId: () => query.sessionId },
  getContextUsage: () => ({ tokens: 3000000, contextWindow: 272000, percent: 1103 }) };
const usage = { ...query, tokens: 69000, contextWindow: 1000000, source: "sent-view-estimate" };
function withRegistry(registry, fn) {
  const previous = Reflect.get(globalThis, symbol);
  if (registry === undefined) Reflect.deleteProperty(globalThis, symbol);
  else Reflect.set(globalThis, symbol, registry);
  try { fn(); } finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, symbol);
    else Reflect.set(globalThis, symbol, previous);
  }
}
test("without ACP the native context usage is preserved", () => withRegistry(undefined, () => {
  assert.equal(getDisplayContextUsage(ctx).tokens, 3000000);
}));
test("ACP sent view replaces raw archived history and uses the current real model window", () => withRegistry({ version: 1, get(q) { assert.deepEqual(q, query); return usage; } }, () => {
  assert.deepEqual(getDisplayContextUsage(ctx), { tokens: 69000, contextWindow: 272000, percent: 69000 / 272000 * 100 });
}));
test("genuine sent-view overflow is not clamped to the model window", () => withRegistry({ version: 1, get: () => ({ ...usage, tokens: 3000000 }) }, () => {
  assert.equal(getDisplayContextUsage(ctx).tokens, 3000000);
  assert.ok(getDisplayContextUsage(ctx).percent > 1000);
}));
test("a registry without a sample for this model keeps the native counter", () => withRegistry({ version: 1, get: () => undefined }, () => {
  assert.equal(getDisplayContextUsage(ctx).tokens, 3000000);
}));
test("a registry keyed to another model does not blank the counter", () => withRegistry({ version: 1, get: (q) => q.modelId === "other" ? usage : undefined }, () => {
  assert.equal(getDisplayContextUsage(ctx).tokens, 3000000);
}));
for (const invalid of [{ ...usage, sessionId: "old" }, { ...usage, modelId: "old" },
  { ...usage, provider: "old" }, { ...usage, source: "raw-tree" }, { ...usage, tokens: null },
  { ...usage, tokens: NaN }, { ...usage, tokens: Infinity }, { ...usage, tokens: -1 }]) {
  test(`stale/invalid ACP sample never falls back to the raw tree: ${JSON.stringify(invalid)}`, () =>
    withRegistry({ version: 1, get: () => invalid }, () => assert.deepEqual(getDisplayContextUsage(ctx), {
      tokens: null, contextWindow: 272000, percent: null,
    })));
}
test("projection getter failure is harmless and remains unknown", () => withRegistry({ version: 1, get() { throw new Error("not ready"); } }, () => {
  assert.equal(getDisplayContextUsage(ctx).tokens, null);
}));
