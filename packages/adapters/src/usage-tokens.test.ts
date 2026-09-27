import type { AgentEvent } from "@rakazo/adapter-kit";
import { describe, expect, it } from "vitest";

/**
 * With prompt caching, a provider reports only the freshly sent tokens as `input`; the rest
 * of the prompt arrives as `cacheRead`. Recording `input` alone made a fully cached prompt
 * look like three tokens in production, which is both wrong billing and a wrong signal about
 * how big the prompt is.
 */
function promptTokens(event: Extract<AgentEvent, { type: "usage" }>): number {
  return event.inputTokens + (event.cacheReadTokens ?? 0) + (event.cacheWriteTokens ?? 0);
}

describe("prompt token accounting", () => {
  it("counts cached prompt tokens, not just the fresh ones", () => {
    const cachedTurn = {
      type: "usage" as const,
      inputTokens: 3,
      cacheReadTokens: 31_402,
      cacheWriteTokens: 0,
      outputTokens: 284,
      provider: "openai",
      model: "gpt-5.6-luna",
    };
    expect(promptTokens(cachedTurn)).toBe(31_405);
  });

  it("counts the write side of the first, uncached turn", () => {
    expect(
      promptTokens({
        type: "usage",
        inputTokens: 120,
        cacheReadTokens: 0,
        cacheWriteTokens: 28_000,
        outputTokens: 512,
        provider: "openai",
        model: "gpt-5.6-luna",
      }),
    ).toBe(28_120);
  });

  it("still works for a provider that reports no cache at all", () => {
    expect(
      promptTokens({
        type: "usage",
        inputTokens: 1_336,
        outputTokens: 120,
        provider: "openai",
        model: "gpt-5.6-luna",
      }),
    ).toBe(1_336);
  });
});
