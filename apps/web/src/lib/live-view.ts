import type { SandboxKind } from "@rakazo/contracts";

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
