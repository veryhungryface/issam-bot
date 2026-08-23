import { describe, expect, it } from "vitest";
import { deploymentModelKeyForProvider, loadEnv } from "./env.js";

const base = {
  DATABASE_URL: "postgres://rakazo:rakazo@127.0.0.1:5433/rakazo",
  NODE_ENV: "test",
};

describe("loadEnv", () => {
  it("defaults the product path to Pi, Docker, and Graphile Worker", () => {
    const env = loadEnv(base);
    expect(env.agentRuntime).toBe("pi");
    expect(env.sandboxProvider).toBe("docker");
    expect(env.wakeupDriver).toBe("graphile");
  });

  it("keeps explicit emulator settings for pnpm test", () => {
    const env = loadEnv({
      ...base,
      AGENT_RUNTIME: "scripted",
      SANDBOX_PROVIDER: "fake",
      WAKEUP_DRIVER: "memory",
    });
    expect(env.agentRuntime).toBe("scripted");
    expect(env.sandboxProvider).toBe("fake");
    expect(env.wakeupDriver).toBe("memory");
  });

  it("selects the deployment key for the configured model provider", () => {
    expect(
      loadEnv({
        ...base,
        PI_DEFAULT_PROVIDER: "openai",
        OPENAI_API_KEY: "  test-openai-key  ",
        OPENROUTER_API_KEY: "test-openrouter-key",
      }),
    ).toMatchObject({
      defaultProvider: "openai",
      openAiKey: "test-openai-key",
      openRouterKey: "test-openrouter-key",
      deploymentModelKey: "test-openai-key",
    });

    expect(
      loadEnv({
        ...base,
        PI_DEFAULT_PROVIDER: "openrouter",
        OPENAI_API_KEY: "test-openai-key",
        OPENROUTER_API_KEY: "test-openrouter-key",
      }).deploymentModelKey,
    ).toBe("test-openrouter-key");
  });

  it("does not leak a deployment key across unrelated providers", () => {
    expect(
      deploymentModelKeyForProvider("qwen", {
        openAiKey: "test-openai-key",
        openRouterKey: "test-openrouter-key",
      }),
    ).toBeUndefined();
  });

  it("loads provider-specific Daytona configuration", () => {
    const env = loadEnv({
      ...base,
      SANDBOX_PROVIDER: "daytona",
      DAYTONA_API_KEY: "test-daytona-key",
      DAYTONA_API_URL: "https://daytona.test/api",
      DAYTONA_TARGET: "test-target",
    });
    expect(env).toMatchObject({
      sandboxProvider: "daytona",
      daytonaApiKey: "test-daytona-key",
      daytonaApiUrl: "https://daytona.test/api",
      daytonaTarget: "test-target",
    });
  });

  it("loads provider-specific Box configuration", () => {
    const env = loadEnv({
      ...base,
      SANDBOX_PROVIDER: "box",
      BOX_API_KEY: "test-box-key",
      BOX_API_URL: "https://box.test/api/v1",
    });
    expect(env).toMatchObject({
      sandboxProvider: "box",
      boxApiKey: "test-box-key",
      boxApiUrl: "https://box.test/api/v1",
    });
  });

  it("loads provider-specific Browserbase configuration", () => {
    const env = loadEnv({
      ...base,
      SANDBOX_PROVIDER: "browserbase",
      BROWSERBASE_API_KEY: "  test-browserbase-key  ",
      BROWSERBASE_PROJECT_ID: "  test-project  ",
      BROWSERBASE_TASK_TIMEOUT_SECONDS: "300",
      BROWSERBASE_REGION: "ap-southeast-1",
    });
    expect(env).toMatchObject({
      sandboxProvider: "browserbase",
      browserbaseApiKey: "test-browserbase-key",
      browserbaseProjectId: "test-project",
      browserbaseTaskTimeoutSeconds: 300,
      browserbaseRegion: "ap-southeast-1",
    });
  });

  it("defaults Browserbase to the closest available region for Korean users", () => {
    expect(loadEnv(base).browserbaseRegion).toBe("ap-southeast-1");
  });

  it("rejects an unsupported Browserbase region", () => {
    expect(() => loadEnv({ ...base, BROWSERBASE_REGION: "ap-northeast-2" })).toThrow(
      /Unsupported Browserbase region/,
    );
  });

  it("rejects a non-integer Browserbase timeout", () => {
    expect(() => loadEnv({ ...base, BROWSERBASE_TASK_TIMEOUT_SECONDS: "ten" })).toThrow(/integer/);
  });

  it("throws when production omits secrets", () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: base.DATABASE_URL,
        NODE_ENV: "production",
      }),
    ).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("throws when production uses placeholder secrets", () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: base.DATABASE_URL,
        NODE_ENV: "production",
        BETTER_AUTH_SECRET: "dev-secret-change-me-please-32chars",
        ENCRYPTION_KEY: "real-encryption-key-value",
      }),
    ).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("loads real secrets in production", () => {
    const env = loadEnv({
      DATABASE_URL: base.DATABASE_URL,
      NODE_ENV: "production",
      BETTER_AUTH_SECRET: "prod-auth-secret-with-enough-length",
      ENCRYPTION_KEY: "prod-encryption-key-with-enough-length",
    });
    expect(env.authSecret).toBe("prod-auth-secret-with-enough-length");
    expect(env.encryptionKey).toBe("prod-encryption-key-with-enough-length");
  });

  it("exposes a deployed git revision when GIT_SHA is set", () => {
    expect(loadEnv(base).gitSha).toBeUndefined();
    expect(loadEnv({ ...base, GIT_SHA: "  3c6e209  " }).gitSha).toBe("3c6e209");
    expect(loadEnv({ ...base, RAKAZO_GIT_SHA: "abc1234" }).gitSha).toBe("abc1234");
  });
});
