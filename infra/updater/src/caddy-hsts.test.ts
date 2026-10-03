import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const composeDir = path.resolve(import.meta.dirname, "../../compose");
const caddyfiles = ["Caddyfile.prod", "Caddyfile.cloudflare.example"];

/**
 * The HTTPS site answered without Strict-Transport-Security, so a first visit typed as
 * http:// could be intercepted before the redirect ever happened.
 */
describe.each(caddyfiles)("%s transport security", (filename) => {
  const config = readFileSync(path.join(composeDir, filename), "utf8");

  it("sends HSTS for a year, including subdomains", () => {
    expect(config).toContain(
      'header @hsts Strict-Transport-Security "max-age=31536000; includeSubDomains"',
    );
  });

  it("never sends it for localhost", () => {
    // Pinning HTTPS on localhost would break every other local dev server on the machine.
    expect(config).toContain("@hsts not host localhost 127.0.0.1");
  });

  it("stops short of preload, which cannot be undone quickly", () => {
    expect(config).not.toContain("preload");
  });
});
