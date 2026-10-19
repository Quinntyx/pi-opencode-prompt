import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const LIVE_CONTEXT_USAGE = Symbol.for("billion-context-pi.live-context-usage.v1");
export interface DisplayContextUsage {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

/**
 * Use the sent view when ACP owns context. ACP publishes a projection on every
 * request for the models it manages, so a missing projection means it is not
 * managing this session/model/provider (for example ACP is disabled for that
 * model) and the native Pi counter is the right number to show.
 */
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
    if (!usage) return ctx.getContextUsage();
    if (usage.sessionId !== sessionId || usage.modelId !== modelId ||
        usage.provider !== provider || usage.source !== "sent-view-estimate" ||
        typeof usage.tokens !== "number" || !Number.isFinite(usage.tokens) || usage.tokens < 0) {
      return unknown;
    }
    return { tokens: usage.tokens, contextWindow, percent: usage.tokens / contextWindow * 100 };
  } catch {
    // A failing projection lookup may still be mid-fold, so don't display raw archived history.
    return unknown;
  }
}
