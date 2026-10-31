/**
 * The hash a pairing session is unlocked with.
 *
 * Separate from `browser-pair.ts`, and reached only through `@rakazo/core/node/...`, because
 * `node:crypto` is not a thing a browser bundle can have — the rest of that module is shared
 * with the web app and this half is not. Same arrangement, same reason, as
 * `approval-effect-key.ts`.
 *
 * The extension computes this with WebCrypto, because a Chrome service worker has no
 * `node:crypto` either. One agreement, two implementations: sha256 over the utf-8 verifier,
 * base64url, unpadded. Both sides test themselves against it, because if they ever disagree
 * then nothing pairs and no error says why.
 */

import { createHash } from "node:crypto";

export function browserPairChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "utf8").digest("base64url");
}
