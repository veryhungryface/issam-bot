/**
 * Where sign-in may send someone afterwards.
 *
 * The QR pairing flow is the reason this exists: a phone camera opens `/pair/<id>` while the
 * teacher is signed out, so sign-in has to come back to it rather than dropping them in the
 * app with the pairing forgotten. Which puts a redirect target in a query string, and a
 * redirect target in a query string is an open redirect unless somebody checks it.
 *
 * Only a same-origin path is allowed, and by allowlist rather than by banning what is known to
 * be dangerous — `//evil.test` is protocol-relative, a backslash is normalised to a slash by
 * browsers so `/\evil.test` leaves too, and whitespace or a control character is how both get
 * past a check that only looks at the first byte. Nothing outside the characters a URL path,
 * query and fragment are made of gets through here.
 */
const SAFE_PATH = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@/?#%[\]]*$/;

export function safeReturnPath(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !SAFE_PATH.test(value)) return null;
  if (value.startsWith("//")) return null;
  return value;
}
