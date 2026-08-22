import type { ModelCatalogEntry } from "@rakazo/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { providerHint, waitForModelOAuth } from "./model-auth";
import { rpc } from "./rpc";

vi.mock("./rpc", () => ({
  rpc: { models: { completeOAuth: vi.fn() } },
}));

describe("waitForModelOAuth", () => {
  const completeOAuth = vi.mocked(rpc.models.completeOAuth);

  beforeEach(() => {
    completeOAuth.mockReset();
  });

  it("stops polling when its signal is aborted", async () => {
    completeOAuth.mockResolvedValue({ status: "pending" });
    const controller = new AbortController();
    const polling = waitForModelOAuth("login-id", controller.signal);

    await Promise.resolve();
    expect(completeOAuth).toHaveBeenCalledTimes(1);
    controller.abort();

    await expect(polling).rejects.toBeDefined();
    expect(completeOAuth).toHaveBeenCalledTimes(1);
  });

  it("returns readiness without waiting for another poll", async () => {
    completeOAuth.mockResolvedValue({ status: "ready" });

    await expect(waitForModelOAuth("login-id")).resolves.toMatchObject({ status: "ready" });
    expect(completeOAuth).toHaveBeenCalledTimes(1);
  });
});

describe("providerHint", () => {
  const entry = {
    provider: "example",
    id: "example-model",
    label: "Example Model",
    billing: "server",
  } satisfies ModelCatalogEntry;

  it("localizes generic authentication hints", () => {
    expect(providerHint({ ...entry, signIn: "device-code" })).toBe("로그인");
    expect(providerHint({ ...entry, auth: "oauth" })).toBe("건너뛰기 또는 서버 키 사용");
    expect(providerHint({ ...entry, auth: "api-key" })).toBe("API 키");
  });

  it("keeps provider product names while localizing the key label", () => {
    expect(providerHint({ ...entry, provider: "xai", signIn: "device-code" })).toBe(
      "SuperGrok / API 키",
    );
  });
});
