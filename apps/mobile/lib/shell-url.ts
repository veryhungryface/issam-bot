/**
 * Where the web view should be pointed.
 *
 * The phone app is the web app in a native shell, so these are the web app's own routes.
 * A notification carries the bot or group it belongs to, and tapping it should land on that
 * conversation rather than wherever the view happened to be.
 */

/** The signed-in home of the web app. */
export function shellHomeUrl(origin: string): string {
  return `${trimTrailingSlash(origin)}/app`;
}

/** The conversation a notification points at, or the home when it names nothing. */
export function shellNotificationUrl(
  origin: string,
  data: Record<string, unknown> | null | undefined,
): string {
  const base = trimTrailingSlash(origin);
  const groupId = readId(data, "groupId");
  if (groupId) return `${base}/app/g/${groupId}`;
  const botId = readId(data, "botId");
  if (botId) return `${base}/app/${botId}`;
  return `${base}/app`;
}

/**
 * True when a URL belongs to our own web app. Anything else - a login page for a site the
 * bot is working on, a link in a message - belongs in the phone's browser, not in here.
 */
export function isShellUrl(origin: string, url: string): boolean {
  try {
    return new URL(url).origin === new URL(trimTrailingSlash(origin)).origin;
  } catch {
    return false;
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/** Notification payloads carry both plain and prefixed keys depending on their age. */
function readId(data: Record<string, unknown> | null | undefined, key: string): string | null {
  if (!data) return null;
  for (const candidate of [data[key], data[`rakazo.${key}`]]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}
/**
 * The page's own background colour, read off the `theme-color` meta tag it keeps in step
 * with the user's light or dark choice. The shell paints the status-bar and navigation-bar
 * strips with it, so the inset areas belong to the page instead of framing it in a colour
 * from a different theme.
 */
export function parseShellMessage(raw: string): { themeColor: string } | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const message = parsed as { type?: unknown; color?: unknown };
    if (message.type !== "theme" || typeof message.color !== "string") return null;
    const color = message.color.trim();
    return /^#[0-9a-f]{3,8}$/i.test(color) ? { themeColor: color } : null;
  } catch {
    return null;
  }
}

/** Whether black or white text sits legibly on the page's background. */
export function isLightColor(color: string): boolean {
  const hex = color.replace("#", "");
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex.slice(0, 6);
  const value = Number.parseInt(full, 16);
  if (!Number.isFinite(value)) return false;
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  // Rec. 601 luma: close enough to decide between two status-bar styles.
  return (r * 299 + g * 587 + b * 114) / 1000 > 140;
}
