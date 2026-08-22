import { describe, expect, it, vi } from "vitest";
import { createClientNonce } from "./client-nonce.js";

describe("createClientNonce", () => {
  it("uses randomUUID in secure contexts", () => {
    const randomUUID = vi.fn(() => "uuid-1" as `${string}-${string}-${string}-${string}-${string}`);
    const getRandomValues = vi.fn();

    expect(createClientNonce({ randomUUID, getRandomValues })).toBe("uuid-1");
    expect(getRandomValues).not.toHaveBeenCalled();
  });

  it("uses getRandomValues when randomUUID is unavailable on an HTTP origin", () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.fill(0xab);
      return bytes;
    }) as Crypto["getRandomValues"];

    expect(createClientNonce({ getRandomValues })).toBe("ab".repeat(16));
  });
});
