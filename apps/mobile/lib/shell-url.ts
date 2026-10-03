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
