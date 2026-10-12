import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const LIVE_CONTEXT_USAGE = Symbol.for("billion-context-pi.live-context-usage.v1");
export interface DisplayContextUsage {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

/** Use the sent view, never the saved-tree fallback, when ACP owns context. */
export function getDisplayContextUsage(ctx: ExtensionContext): DisplayContextUsage | undefined {
  const registry = Reflect.get(globalThis, LIVE_CONTEXT_USAGE) as
    | { version?: unknown; get?: unknown } | undefined;
  if (!registry || registry.version !== 1 || typeof registry.get !== "function") {
    return ctx.getContextUsage();
  }
  const contextWindow = ctx.model?.contextWindow;
  if (!contextWindow || !Number.isFinite(contextWindow) || contextWindow <= 0) return undefined;
  const unknown: DisplayContextUsage = { tokens: null, contextWindow, percent: null };
  try {
    const sessionId = ctx.sessionManager.getSessionId();
    const modelId = ctx.model?.id;
    const provider = ctx.model?.provider;
    if (!sessionId || !modelId) return unknown;
    const usage = registry.get({ sessionId, modelId, provider });
    if (!usage || usage.sessionId !== sessionId || usage.modelId !== modelId ||
        usage.provider !== provider || usage.source !== "sent-view-estimate" ||
        typeof usage.tokens !== "number" || !Number.isFinite(usage.tokens) || usage.tokens < 0) {
      return unknown;
    }
    return { tokens: usage.tokens, contextWindow, percent: usage.tokens / contextWindow * 100 };
  } catch {
    // A missing/failed projection isn't permission to display raw archived history.
    return unknown;
  }
}
