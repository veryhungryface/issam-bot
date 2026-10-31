import { describe, expect, it } from "vitest";
import { normalizeBrowserPairChallenge } from "../browser-pair.js";
import { browserPairChallenge } from "./browser-pair-challenge.js";

describe("browserPairChallenge", () => {
  it("is sha256 in base64url with no padding", () => {
    expect(browserPairChallenge("hello")).toBe("LPJNul-wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ");
    expect(browserPairChallenge("hello")).not.toContain("=");
  });

  it("produces exactly what the collect endpoint will accept as a challenge", () => {
    const verifier = Buffer.alloc(32, 0x41).toString("base64url");
    expect(normalizeBrowserPairChallenge(browserPairChallenge(verifier))).not.toBeNull();
  });

  it("is a different digest for a different verifier", () => {
    expect(browserPairChallenge("a")).not.toBe(browserPairChallenge("b"));
  });
});
