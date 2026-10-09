import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const QUOTA_STATUS_KEY = "cliproxyapi-quota";
const STATUS_EVENT = "status-item";
const STATUS_REQUEST_EVENT = "status-item:request";
const POLL_MS = 5_000;
const MIN_REFRESH_MS = 1_000;

export interface QuotaWindow {
  total_percent: number | null;
  available_percent: number | null;
  current_percent: number | null;
}
export interface RemainingQuota {
  five_hour: QuotaWindow;
  weekly: QuotaWindow;
  routing_available?: boolean;
  current_available?: boolean | null;
}

function percent(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? `${Math.round(value)}%` : "?";
}

export function formatRemainingQuota(data: RemainingQuota | null): string {
  // Five-hour capacity is immediately usable; weekly budget survives a
  // temporary five-hour cooldown. Both are already adjusted for operator caps.
  const currentFiveHour = data?.current_available === false ? 0 : data?.five_hour?.current_percent;
  return `5h ${percent(data?.five_hour?.available_percent)} (${percent(currentFiveHour)}) · wk ${percent(data?.weekly?.total_percent)} (${percent(data?.weekly?.current_percent)})`;
}

// MagicDNS uses client authorization, never the private management credential.
export function quotaEndpoint(baseUrl: string | undefined, model: string, session: string): URL {
  const base = new URL(baseUrl ?? "http://127.0.0.1:8317/backend-api");
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname);
  const magicDNS = /^[a-z0-9-]+\.tail[a-z0-9-]+\.ts\.net$/i.test(base.hostname);
  if (!["http:", "https:"].includes(base.protocol) || (!loopback && !magicDNS) || base.username || base.password) {
    throw new Error("Quota status is restricted to loopback or Tailscale MagicDNS");
  }
  const url = new URL(loopback ? "/v8/management/observability/quota/remaining" : "/v1/quota/remaining", base.origin);
  url.searchParams.set("model", model);
  url.searchParams.set("session_id", session);
  return url;
}

export interface QuotaDependencies {
  readSecrets: () => Promise<string>;
  fetch: typeof globalThis.fetch;
  now: () => number;
  setInterval: typeof globalThis.setInterval;
  clearInterval: typeof globalThis.clearInterval;
}
const defaults: QuotaDependencies = {
  readSecrets: () => readFile(join(homedir(), ".local/share/cliproxyapi/secrets.json"), "utf8"),
  fetch: (...args) => globalThis.fetch(...args),
  now: () => Date.now(),
  setInterval: (...args) => setInterval(...args),
  clearInterval: (timer) => clearInterval(timer),
};

/** Publish through opencode-prompt's public status-item API, never replace its footer. */
export function registerQuotaStatus(pi: ExtensionAPI, deps: QuotaDependencies = defaults): void {
  let ctx: ExtensionContext | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let request: AbortController | undefined;
  let generation = 0;
  let identity = "";
  let text: string | null = null;
  let lastAttempt = -Infinity;

  function publish(): void {
    pi.events.emit(STATUS_EVENT, { key: QUOTA_STATUS_KEY, text });
  }
  function cancel(): void {
    generation++;
    request?.abort();
    request = undefined;
  }
  function stop(): void {
    cancel();
    if (timer !== undefined) deps.clearInterval(timer);
    timer = undefined;
    identity = "";
    lastAttempt = -Infinity;
    text = null;
    publish();
  }
  async function refresh(): Promise<void> {
    if (!ctx?.hasUI || ctx.model?.provider !== "cliproxyapi") { stop(); return; }
    const model = ctx.model;
    const session = ctx.sessionManager.getSessionId();
    const key = JSON.stringify([model.baseUrl, model.id, session]);
    if (key !== identity) {
      cancel();
      identity = key;
      lastAttempt = -Infinity;
      text = formatRemainingQuota(null);
      publish();
    }
    if (request || deps.now() - lastAttempt < MIN_REFRESH_MS) return;
    lastAttempt = deps.now();
    const epoch = generation;
    const abort = new AbortController();
    request = abort;
    const timeout = setTimeout(() => abort.abort(), 4_000);
    timeout.unref?.();
    try {
      const url = quotaEndpoint(model.baseUrl, model.id, session);
      let apiKey: string | undefined;
      if (url.pathname === "/v1/quota/remaining") {
        const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
        if (!auth.ok) throw new Error("Client authorization unavailable");
        apiKey = auth.apiKey;
      } else {
        apiKey = JSON.parse(await deps.readSecrets()).management_key;
      }
      if (typeof apiKey !== "string" || !apiKey) throw new Error("Missing quota authorization key");
      if (abort.signal.aborted) return;
      const response = await deps.fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: abort.signal,
        redirect: "error",
      });
      if (!response.ok) throw new Error("Quota observation unavailable");
      const data = await response.json() as RemainingQuota;
      if (epoch === generation && !abort.signal.aborted) {
        text = formatRemainingQuota(data);
        publish();
      }
    } catch {
      // Never retain stale numbers on server/credential failure and never expose secrets.
      if (epoch === generation) { text = formatRemainingQuota(null); publish(); }
    } finally {
      clearTimeout(timeout);
      if (request === abort) request = undefined;
    }
  }
  function update(next: ExtensionContext): void {
    ctx = next;
    if (!ctx.hasUI || ctx.model?.provider !== "cliproxyapi") { stop(); return; }
    if (timer === undefined) {
      timer = deps.setInterval(() => { void refresh(); }, POLL_MS);
      timer.unref?.();
    }
    void refresh();
  }
  pi.on("session_start", (_event, next) => { stop(); update(next); });
  pi.on("model_select", (_event, next) => update(next));
  pi.on("turn_start", (_event, next) => update(next));
  pi.on("turn_end", (_event, next) => update(next));
  pi.on("agent_settled", (_event, next) => update(next));
  pi.on("session_shutdown", () => { ctx = undefined; stop(); });
  pi.events.on(STATUS_REQUEST_EVENT, () => { publish(); if (ctx) void refresh(); });
}
