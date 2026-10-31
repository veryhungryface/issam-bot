/**
 * Pairing a browser by showing a QR code on it.
 *
 * The code in `browser-device.ts` is one string that carries everything the extension needs,
 * which works when the thing that mints it and the thing that reads it are both on the same
 * screen. They are not. The extension lives on the teacher's computer; the phone in their
 * hand is what has a camera and is already signed in. So the computer displays and the phone
 * reads, which means the token has to travel phone → computer, and that needs a rendezvous
 * row on the server. This is the arithmetic for it.
 *
 * The id in the QR is public — it is on a screen in a staff room, and anyone who can see the
 * screen can photograph it. So the id alone must be worth nothing. The extension keeps a
 * verifier it never shows and sends only its hash when it opens the session; the token is
 * handed back to whoever can present the verifier, which is the one computer that made it.
 * This is the device-authorization flow's trick (RFC 8628 §5.2 with PKCE's hash), and the
 * reason is the same: the screen is not a secret.
 *
 * Pure: the sizes, the lifetime, the URL, the wording. The row and the token live in the api,
 * and the hash itself lives in `node/browser-pair-challenge.ts` because `node:crypto` is not
 * something the web app's bundle can carry.
 */

/** Where a pairing session can be. */
export const BROWSER_PAIR_STATUSES = ["pending", "claimed", "used", "expired"] as const;
export type BrowserPairStatus = (typeof BROWSER_PAIR_STATUSES)[number];

/**
 * How long a displayed QR is good for.
 *
 * Long enough to find the phone, unlock it and get the camera up; short enough that a QR left
 * on an unlocked screen at the end of a lesson is no longer a way in. The extension can always
 * draw a new one.
 */
export const BROWSER_PAIR_TTL_MS = 5 * 60_000;

/**
 * Length of the id that goes in the QR, in bytes before base64url.
 *
 * It is a bearer name for a row that anyone on the internet may ask about, so it is guessing-
 * proof rather than merely unique: 16 bytes is 128 bits, and it still leaves the QR sparse
 * enough to scan off a laptop screen from arm's length.
 */
export const BROWSER_PAIR_ID_BYTES = 16;

/** Length of the verifier the extension keeps to itself, in bytes before base64url. */
export const BROWSER_PAIR_VERIFIER_BYTES = 32;

/**
 * Enough sessions in one minute to be a script rather than a staff room.
 *
 * Counted across the whole deployment, not per caller: the point is to bound how many rows an
 * endpoint that cannot authenticate anybody is able to create, and a per-IP count behind two
 * proxies would be a number this server cannot actually trust. The cost of counting it this way
 * is that a flood stops everyone drawing a QR for a minute — annoying, and the pasted code still
 * works, which is the other reason that path stays.
 */
export const BROWSER_PAIR_BURST_LIMIT = 60;
export const BROWSER_PAIR_BURST_WINDOW_MS = 60_000;

/** A base64url token of the expected shape, trimmed, or `null`. */
function normalizeOpaque(value: unknown, bytes: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  // base64url of n bytes is ceil(n * 4 / 3) characters once the padding is dropped.
  const expected = Math.ceil((bytes * 4) / 3);
  if (text.length !== expected) return null;
  return /^[A-Za-z0-9_-]+$/.test(text) ? text : null;
}

export function normalizeBrowserPairId(value: unknown): string | null {
  return normalizeOpaque(value, BROWSER_PAIR_ID_BYTES);
}

export function normalizeBrowserPairVerifier(value: unknown): string | null {
  return normalizeOpaque(value, BROWSER_PAIR_VERIFIER_BYTES);
}

/** The challenge as the extension sends it: a sha256 digest in base64url, so 32 bytes. */
export function normalizeBrowserPairChallenge(value: unknown): string | null {
  return normalizeOpaque(value, 32);
}

export function browserPairExpired(session: { expiresAt: Date }, now: Date = new Date()): boolean {
  return now.getTime() > session.expiresAt.getTime();
}

/**
 * What the QR says.
 *
 * A plain https link, not the pairing string and not a custom scheme: the phone's own camera
 * recognises it without the teacher having to find a scanner inside an app, and a link that
 * opens a page which explains itself is a far better thing to point a camera at than an opaque
 * blob. It carries only the session id, which is why the id is worth nothing on its own.
 */
export function browserPairUrl(origin: string, sessionId: string): string {
  return `${origin.replace(/\/+$/, "")}/pair/${sessionId}`;
}

/** Seconds left to scan, floored at zero, for the countdown under the QR. */
export function browserPairSecondsLeft(expiresAt: Date, now: Date = new Date()): number {
  return Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
}
