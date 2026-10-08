/**
 * The phone app is this web app in a native shell, so that both say exactly the same thing
 * and a change here reaches the phone without a store build. The shell keeps the two jobs a
 * browser cannot do: it holds the push token the operating system issued, and it reopens
 * the app on the right conversation when a notification is tapped.
 *
 * The token arrives on `window`, injected before this bundle runs. The session lives here,
 * in the web app's own cookies, so registering the token is this side's job — the shell has
 * no way to call an authenticated endpoint.
 */

const TOKEN_KEY = "__ISSAM_NATIVE__";

type NativeShell = { pushToken?: unknown; platform?: unknown };

function shell(): NativeShell | undefined {
  if (typeof window === "undefined") return undefined;
  const value = (window as unknown as Record<string, unknown>)[TOKEN_KEY];
  return value && typeof value === "object" ? (value as NativeShell) : undefined;
}

/** True when this page is running inside the phone app rather than a browser. */
export function inNativeShell(): boolean {
  return shell() !== undefined;
}

/** The Expo push token the shell was given, when there is one to register. */
export function nativePushToken(): string | null {
  const token = shell()?.pushToken;
  if (typeof token !== "string") return null;
  const trimmed = token.trim();
  // Matches what the API accepts; anything else is not worth a round trip.
  return trimmed.length >= 8 && trimmed.length <= 512 ? trimmed : null;
}

/**
 * Hand the shell's push token to the API once, from inside an authenticated session.
 *
 * The shell cannot do this itself: the session is a cookie in this web view, not something
 * native code holds. Failure is silent on purpose — a phone without push is still a working
 * app, and there is nothing the user could do about it here.
 */
export async function registerNativePushToken(
  register: (input: { token: string }) => Promise<unknown>,
): Promise<"registered" | "no-token" | "failed"> {
  const token = nativePushToken();
  if (!token) return "no-token";
  try {
    await register({ token });
    return "registered";
  } catch {
    return "failed";
  }
}
