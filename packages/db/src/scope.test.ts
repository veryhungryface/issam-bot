import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "./client.js";
import { IsolationError, requireMembership } from "./scope.js";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function prismaForMembership(found: boolean) {
  return {
    spaceMember: {
      findFirst: vi.fn(async ({ where }: { where: { userId: string; spaceId?: string } }) =>
        found
          ? {
              userId: where.userId,
              spaceId: where.spaceId ?? "space-default",
              member: { user: { email: "owner@example.test" } },
            }
          : null,
      ),
    },
    deploymentSettings: {
      findUnique: vi.fn(async () => ({ ownerUserId: "user-1" })),
    },
  } as unknown as PrismaClient;
}

describe("requireMembership", () => {
  it("scopes the actor to an explicitly requested space", async () => {
    const prisma = prismaForMembership(true);

    await expect(requireMembership(prisma, "user-1", "space-support")).resolves.toEqual({
      userId: "user-1",
      spaceId: "space-support",
      email: "owner@example.test",
      isDeploymentOwner: true,
    });
    expect(prisma.spaceMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1", spaceId: "space-support" },
      }),
    );
  });

  it("rejects a requested space the user does not belong to", async () => {
    await expect(
      requireMembership(prismaForMembership(false), "user-1", "space-foreign"),
    ).rejects.toBeInstanceOf(IsolationError);
  });

  it("selects the explicit default Space before older non-default memberships", async () => {
    const prisma = prismaForMembership(true);

    await requireMembership(prisma, "user-1");

    expect(prisma.spaceMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ space: { isDefault: "desc" } }, { createdAt: "asc" }, { id: "asc" }],
      }),
    );
  });

  it("loads membership and deployment ownership concurrently", async () => {
    const membership = deferred<{
      userId: string;
      spaceId: string;
      member: { user: { email: string } };
    } | null>();
    const settings = deferred<{ ownerUserId: string | null } | null>();
    const findMembership = vi.fn(() => membership.promise);
    const findSettings = vi.fn(() => settings.promise);
    const prisma = {
      spaceMember: { findFirst: findMembership },
      deploymentSettings: { findUnique: findSettings },
    } as unknown as PrismaClient;

    const actor = requireMembership(prisma, "user-1");

    expect(findMembership).toHaveBeenCalledOnce();
    expect(findSettings).toHaveBeenCalledOnce();
    settings.resolve({ ownerUserId: "user-1" });
    membership.resolve({
      userId: "user-1",
      spaceId: "space-1",
      member: { user: { email: "owner@example.test" } },
    });
    await expect(actor).resolves.toEqual({
      userId: "user-1",
      spaceId: "space-1",
      email: "owner@example.test",
      isDeploymentOwner: true,
    });
  });
});
