import { describe, expect, it, vi } from "vitest";
import {
  authRateLimitOptions,
  isBlockedAuthPath,
  passwordResetEmail,
  resolveSignupPolicy,
  withoutSessionTokens,
} from "./index.js";

describe("auth policy", () => {
  it("closes every organization route, not a list of names", () => {
    // A session could call /organization/delete on its own default Space and cascade
    // every Space away, skipping the checks spaces/remove enforces.
    for (const path of [
      "/organization/delete",
      "/organization/leave",
      "/organization/update",
      "/organization/create",
      "/organization/invite",
      "/organization/remove-member",
      "/organization/something-a-future-version-adds",
    ]) {
      expect(isBlockedAuthPath(path)).toBe(true);
    }
  });

  it("leaves the routes the clients actually use alone", () => {
    for (const path of [
      "/sign-in/email",
      "/sign-up/email",
      "/get-session",
      "/list-sessions",
      "/request-password-reset",
    ]) {
      expect(isBlockedAuthPath(path)).toBe(false);
    }
  });
});

describe("passwordResetEmail", () => {
  it("keeps the reset URL in text and escapes user-controlled HTML", () => {
    const message = passwordResetEmail(
      { id: "user-1", email: "ada@example.test", name: '<Ada & "team">' },
      "https://rakazo.test/reset-password?token=secret&next=1",
    );

    expect(message).toMatchObject({
      to: "ada@example.test",
      subject: "Reset your Rakazo password",
    });
    expect(message.text).toContain("https://rakazo.test/reset-password?token=secret&next=1");
    expect(message.html).toContain("&lt;Ada &amp; &quot;team&quot;&gt;");
    expect(message.html).toContain("token=secret&amp;next=1");
    expect(message.html).not.toContain('<Ada & "team">');
  });
});

describe("resolveSignupPolicy", () => {
  it("uses environment defaults before deployment settings exist", async () => {
    const prisma = {
      deploymentSettings: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    await expect(
      resolveSignupPolicy(prisma as never, {
        signupsEnabled: "false",
        signupAllowlist: "you@example.com,@company.test",
      }),
    ).resolves.toEqual({
      enabled: false,
      allowlist: ["you@example.com", "@company.test"],
    });
  });

  it("keeps using the environment policy for a pre-upgrade uninitialized row", async () => {
    const prisma = {
      deploymentSettings: {
        findUnique: vi.fn().mockResolvedValue({
          signupsEnabled: true,
          signupAllowlist: "",
          signupPolicyInitialized: false,
        }),
      },
    };
    await expect(
      resolveSignupPolicy(prisma as never, {
        signupsEnabled: "false",
        signupAllowlist: "existing-policy@example.com",
      }),
    ).resolves.toEqual({ enabled: false, allowlist: ["existing-policy@example.com"] });
  });

  it("uses live deployment settings as the effective policy after initial seeding", async () => {
    const prisma = {
      deploymentSettings: {
        findUnique: vi.fn().mockResolvedValue({
          signupsEnabled: false,
          signupAllowlist: "approved@example.com",
          signupPolicyInitialized: true,
        }),
      },
    };
    await expect(
      resolveSignupPolicy(prisma as never, {
        signupsEnabled: "false",
        signupAllowlist: "environment-only@example.com",
      }),
    ).resolves.toEqual({ enabled: false, allowlist: ["approved@example.com"] });
  });
});

describe("authRateLimitOptions", () => {
  it("caps credential attempts in production", () => {
    const options = authRateLimitOptions("production");
    expect(options.enabled).toBe(true);
    expect(options.storage).toBe("database");
    // Shared across API processes, so two workers cannot each grant the full allowance.
    for (const path of ["/sign-in/email", "/sign-up/email", "/request-password-reset"]) {
      expect(options.customRules[path]).toEqual({ window: 15 * 60, max: 10 });
    }
  });

  it("stays off elsewhere, where the suites sign in constantly", () => {
    expect(authRateLimitOptions("test").enabled).toBe(false);
    expect(authRateLimitOptions(undefined).enabled).toBe(false);
  });
});

describe("withoutSessionTokens", () => {
  it("strips the token from every listed session", () => {
    const listed = withoutSessionTokens("/list-sessions", [
      { id: "s1", token: "secret-1", userAgent: "iPhone" },
      { id: "s2", token: "secret-2", userAgent: "Chrome" },
    ]);
    expect(listed).toEqual([
      { id: "s1", userAgent: "iPhone" },
      { id: "s2", userAgent: "Chrome" },
    ]);
  });

  it("strips the token from a session read", () => {
    for (const path of ["/get-session", "/update-session"]) {
      expect(
        withoutSessionTokens(path, {
          session: { id: "s1", token: "secret" },
          user: { id: "u1" },
        }),
      ).toEqual({ session: { id: "s1" }, user: { id: "u1" } });
    }
  });

  it("leaves sign-in and sign-up alone, which must return the token they issued", () => {
    const issued = { token: "fresh", user: { id: "u1" } };
    expect(withoutSessionTokens("/sign-in/email", issued)).toBeUndefined();
    expect(withoutSessionTokens("/sign-up/email", issued)).toBeUndefined();
  });

  it("keeps a body it does not recognise", () => {
    expect(withoutSessionTokens("/list-sessions", { not: "an array" })).toBeUndefined();
    expect(withoutSessionTokens("/get-session", null)).toBeUndefined();
  });
});
