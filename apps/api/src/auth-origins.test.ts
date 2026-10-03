import { describe, expect, it } from "vitest";
import { isTrustedOrigin } from "./app.js";

/**
 * This guard used to trust any loopback origin, which meant anything else the user had
 * running locally - a dev server on another port, a page they opened - could call the API
 * with their session cookie. Only the configured origins and their loopback spellings now.
 */
const env = {
  webOrigin: "https://issam.example",
  apiUrl: "https://api.issam.example",
  authUrl: "https://issam.example/",
};

describe("isTrustedOrigin", () => {
  it("accepts the origins this deployment configures", () => {
    expect(isTrustedOrigin("https://issam.example", env)).toBe(true);
    expect(isTrustedOrigin("https://api.issam.example", env)).toBe(true);
  });

  it("ignores a trailing slash on a configured URL", () => {
    // A browser's Origin header never has one; WEB_ORIGIN or AUTH_URL may.
    expect(
      isTrustedOrigin("https://issam.example", { ...env, webOrigin: "https://issam.example/" }),
    ).toBe(true);
  });

  it("refuses another origin, including a lookalike host", () => {
    expect(isTrustedOrigin("https://issam.example.evil.test", env)).toBe(false);
    expect(isTrustedOrigin("http://issam.example", env)).toBe(false);
    expect(isTrustedOrigin("https://issam.example:8443", env)).toBe(false);
  });

  it("refuses a loopback page that is not what we configured", () => {
    expect(isTrustedOrigin("http://localhost:3000", env)).toBe(false);
    expect(isTrustedOrigin("http://127.0.0.1:5500", env)).toBe(false);
  });

  it("still accepts the local stack's own spellings when it is the configured origin", () => {
    const local = {
      webOrigin: "http://127.0.0.1:5173",
      apiUrl: "http://127.0.0.1:3100",
      authUrl: "http://127.0.0.1:5173",
    };
    for (const origin of [
      "http://127.0.0.1:5173",
      "http://localhost:5173",
      "http://[::1]:5173",
      "http://localhost:3100",
    ]) {
      expect(isTrustedOrigin(origin, local)).toBe(true);
    }
    // A different port on the same host is still a different application.
    expect(isTrustedOrigin("http://localhost:4173", local)).toBe(false);
  });

  it("keeps the native shell working and no longer trusts any Expo host", () => {
    // Native clients, Expo Go included, send rakazo://. Every exp:// URL used to match,
    // so an email verification link could redirect to any Expo host.
    expect(isTrustedOrigin("rakazo://app", env)).toBe(true);
    expect(isTrustedOrigin("exp://127.0.0.1:8081", env)).toBe(false);
    expect(isTrustedOrigin("exp://u.expo.dev/whatever", env)).toBe(false);
  });

  it("treats a missing Origin as a non-browser caller", () => {
    expect(isTrustedOrigin("", env)).toBe(true);
  });
});
