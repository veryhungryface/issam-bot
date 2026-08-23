/**
 * noVNC understands `view_only`, but Browserbase Live View is interactive by
 * default and documents read-only embedding through the iframe's pointer
 * policy. Mutating Browserbase's signed debugger URL can leave its own client
 * in a non-interactive state even when the outer iframe accepts pointer input.
 */
export function applyScreenViewPolicy(url: string, kind: string, viewOnly: boolean) {
  if (kind === "browserbase") return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("view_only", viewOnly ? "true" : "false");
    return parsed.toString();
  } catch {
    const join = url.includes("?") ? "&" : "?";
    return `${url}${join}view_only=${viewOnly ? "true" : "false"}`;
  }
}
