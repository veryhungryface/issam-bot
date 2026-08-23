import type { SandboxKind } from "@rakazo/contracts";
import { abortableDelay } from "@rakazo/core";

/**
 * Browserbase documents this sandbox policy for embedded Live Views. Keeping it
 * explicit also prevents a provider page from navigating the Rakazo top frame.
 */
export function screenIframeSandbox(
  url: string | null,
  kind: SandboxKind | undefined,
  baseUrl: string,
): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url, baseUrl);
    if (parsed.pathname.startsWith("/novnc/")) return "allow-scripts allow-pointer-lock";
    if (kind === "browserbase") return "allow-same-origin allow-scripts";
    return undefined;
  } catch {
    return kind === "browserbase" ? "allow-same-origin allow-scripts" : undefined;
  }
}

/** Ignore same-shaped postMessages that did not come from the active Live View iframe. */
export function isBrowserbaseDisconnectedMessage(data: unknown, fromActiveFrame: boolean) {
  return fromActiveFrame && data === "browserbase-disconnected";
}

export async function pollBrowserbaseLiveViewRecovery(
  refresh: () => Promise<string | null>,
  options: {
    signal: AbortSignal;
    attempts?: number;
    intervalMs?: number;
    wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  },
): Promise<string | null> {
  const attempts = options.attempts ?? 15;
  const intervalMs = options.intervalMs ?? 2_000;
  const wait = options.wait ?? abortableDelay;
  for (let attempt = 0; attempt < attempts && !options.signal.aborted; attempt += 1) {
    try {
      await wait(intervalMs, options.signal);
      if (options.signal.aborted) return null;
      const url = await refresh();
      if (url) return url;
    } catch {
      if (options.signal.aborted) return null;
    }
  }
  return null;
}
