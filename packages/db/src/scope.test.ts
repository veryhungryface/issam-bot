import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "./client.js";
import { requireMembership } from "./scope.js";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("requireMembership", () => {
  it("loads membership and deployment ownership concurrently", async () => {
    const member = deferred<{
      userId: string;
      organizationId: string;
      user: { email: string };
    } | null>();
    const settings = deferred<{ ownerUserId: string | null } | null>();
    const findMember = vi.fn(() => member.promise);
    const findSettings = vi.fn(() => settings.promise);
    const prisma = {
      member: { findFirst: findMember },
      deploymentSettings: { findUnique: findSettings },
    } as unknown as PrismaClient;

    const actor = requireMembership(prisma, "user-1");

    expect(findMember).toHaveBeenCalledOnce();
    expect(findSettings).toHaveBeenCalledOnce();
    settings.resolve({ ownerUserId: "user-1" });
    member.resolve({
      userId: "user-1",
      organizationId: "workspace-1",
      user: { email: "owner@example.test" },
    });
    await expect(actor).resolves.toEqual({
      userId: "user-1",
      workspaceId: "workspace-1",
      email: "owner@example.test",
      isDeploymentOwner: true,
    });
  });
});
