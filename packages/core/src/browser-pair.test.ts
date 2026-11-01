import { describe, expect, it } from "vitest";
import {
  BROWSER_PAIR_ID_BYTES,
  BROWSER_PAIR_TTL_MS,
  BROWSER_PAIR_VERIFIER_BYTES,
  browserPairExpired,
  browserPairSecondsLeft,
  browserPairSessionFromScan,
  browserPairUrl,
  normalizeBrowserPairChallenge,
  normalizeBrowserPairId,
  normalizeBrowserPairVerifier,
} from "./browser-pair.js";

function base64url(bytes: number, fill = 0x41): string {
  return Buffer.alloc(bytes, fill).toString("base64url");
}

describe("normalizers", () => {
  it("accept exactly the right length and alphabet", () => {
    expect(normalizeBrowserPairId(base64url(BROWSER_PAIR_ID_BYTES))).toBe(
      base64url(BROWSER_PAIR_ID_BYTES),
    );
    expect(normalizeBrowserPairVerifier(base64url(BROWSER_PAIR_VERIFIER_BYTES))).not.toBeNull();
  });

  it("refuse a verifier offered where an id belongs", () => {
    // The two are different lengths on purpose: a caller that mixes them up is told no rather
    // than being let through on a string that happens to decode.
    expect(normalizeBrowserPairId(base64url(BROWSER_PAIR_VERIFIER_BYTES))).toBeNull();
  });

  it("refuse padding, standard base64 and anything else", () => {
    expect(normalizeBrowserPairId(`${base64url(BROWSER_PAIR_ID_BYTES).slice(0, -1)}+`)).toBeNull();
    expect(normalizeBrowserPairId(`${base64url(BROWSER_PAIR_ID_BYTES)}=`)).toBeNull();
    expect(normalizeBrowserPairId(null)).toBeNull();
    expect(normalizeBrowserPairId("")).toBeNull();
    expect(normalizeBrowserPairVerifier(undefined)).toBeNull();
  });

  it("tolerate whitespace around a pasted value", () => {
    const id = base64url(BROWSER_PAIR_ID_BYTES);
    expect(normalizeBrowserPairId(`  ${id}\n`)).toBe(id);
  });
});

describe("browserPairUrl", () => {
  it("is a plain https link a phone camera can open", () => {
    expect(browserPairUrl("https://issam-bot.vercel.app", "abc")).toBe(
      "https://issam-bot.vercel.app/pair/abc",
    );
  });

  it("does not double the slash when the origin carries one", () => {
    expect(browserPairUrl("https://example.test/", "abc")).toBe("https://example.test/pair/abc");
  });
});

describe("expiry", () => {
  const now = new Date("2026-10-31T00:00:00.000Z");

  it("is not expired while there is time left", () => {
    const expiresAt = new Date(now.getTime() + BROWSER_PAIR_TTL_MS);
    expect(browserPairExpired({ expiresAt }, now)).toBe(false);
    expect(browserPairSecondsLeft(expiresAt, now)).toBe(300);
  });

  it("is expired once the deadline passes, and the countdown floors at zero", () => {
    const expiresAt = new Date(now.getTime() - 1);
    expect(browserPairExpired({ expiresAt }, now)).toBe(true);
    expect(browserPairSecondsLeft(expiresAt, now)).toBe(0);
  });
});

describe("browserPairSessionFromScan", () => {
  const origin = "https://issam-bot.vercel.app";
  const id = Buffer.alloc(BROWSER_PAIR_ID_BYTES, 0x41).toString("base64url");

  it("reads the id out of our own pairing link", () => {
    expect(browserPairSessionFromScan(`${origin}/pair/${id}`, origin)).toBe(id);
    expect(browserPairSessionFromScan(`  ${origin}/pair/${id}  `, origin)).toBe(id);
  });

  it("refuses a link to anywhere else, which is most of what a camera sees", () => {
    expect(browserPairSessionFromScan(`https://evil.test/pair/${id}`, origin)).toBeNull();
    expect(browserPairSessionFromScan(`http://issam-bot.vercel.app/pair/${id}`, origin)).toBeNull();
    expect(browserPairSessionFromScan(`${origin}:8443/pair/${id}`, origin)).toBeNull();
  });

  it("refuses our origin with a different path", () => {
    expect(browserPairSessionFromScan(`${origin}/app`, origin)).toBeNull();
    expect(browserPairSessionFromScan(`${origin}/pair/${id}/more`, origin)).toBeNull();
    expect(browserPairSessionFromScan(`${origin}/pair/`, origin)).toBeNull();
  });

  it("refuses an id of the wrong shape even on the right path", () => {
    expect(browserPairSessionFromScan(`${origin}/pair/short`, origin)).toBeNull();
  });

  it("refuses what is not a url at all", () => {
    expect(browserPairSessionFromScan("WIFI:S=staffroom;T=WPA;P=hunter2;;", origin)).toBeNull();
    expect(browserPairSessionFromScan(id, origin)).toBeNull();
    expect(browserPairSessionFromScan(null, origin)).toBeNull();
  });
});
