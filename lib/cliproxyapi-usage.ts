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
  // Lead with the selected account's remaining quota; keep aggregate pool
  // capacity in parentheses as supporting routing context.
  const currentFiveHour = data?.current_available === false ? 0 : data?.five_hour?.current_percent;
  return `5h ${percent(currentFiveHour)} (${percent(data?.five_hour?.available_percent)}) · wk ${percent(data?.weekly?.current_percent)} (${percent(data?.weekly?.total_percent)})`;
}

// Tailnet quota observation never requires or reads the private management credential.
export function quotaEndpoint(baseUrl: string | undefined, model: string, session: string): URL {
  const base = new URL(baseUrl ?? "http://127.0.0.1:8317/backend-api");
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname);
  const magicDNS = /^[a-z0-9-]+\.tail[a-z0-9-]+\.ts\.net$/i.test(base.hostname);
  const ipv4 = base.hostname.split(".");
  const tailnetIPv4 = ipv4.length === 4 && ipv4.every(part => /^\d+$/.test(part) && Number(part) <= 255)
    && ipv4[0] === "100"
    && Number(ipv4[1]) >= 64 && Number(ipv4[1]) <= 127;
  const tailnetIPv6 = /^\[fd7a:115c:a1e0:/i.test(base.hostname);
  if (!["http:", "https:"].includes(base.protocol)
    || (!loopback && !magicDNS && !tailnetIPv4 && !tailnetIPv6) || base.username || base.password) {
    throw new Error("Quota status is restricted to loopback or Tailscale addresses");
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
      const headers: Record<string, string> = {};
      if (url.pathname !== "/v1/quota/remaining") {
        const apiKey = JSON.parse(await deps.readSecrets()).management_key;
        if (typeof apiKey !== "string" || !apiKey) throw new Error("Missing management authorization key");
        headers.Authorization = `Bearer ${apiKey}`;
      }
      // The read-only tailnet route follows the keyless inference deployment.
      // Do not require registry auth APIs, client keys, or local secret files.
      if (abort.signal.aborted) return;
      const response = await deps.fetch(url, {
        headers,
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
