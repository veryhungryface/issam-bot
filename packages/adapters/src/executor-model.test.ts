import { describe, expect, it } from "vitest";
import { resolveExecutionModel } from "./executor.js";

describe("execution model selection", () => {
  it("uses the deployment provider and model when the user has no credential", () => {
    expect(
      resolveExecutionModel({
        deploymentModelProvider: "openai",
        deploymentModelId: "gpt-5.6-luna",
      }),
    ).toEqual({ provider: "openai", id: "gpt-5.6-luna" });
  });

  it("prefers a user credential over deployment defaults", () => {
    expect(
      resolveExecutionModel({
        credential: { provider: "anthropic", defaultModel: "claude-sonnet" },
        settings: { defaultModelProvider: "openrouter", defaultModelId: "fallback" },
        deploymentModelProvider: "openai",
        deploymentModelId: "gpt-5.6-luna",
      }),
    ).toEqual({ provider: "anthropic", id: "claude-sonnet" });
  });
});
