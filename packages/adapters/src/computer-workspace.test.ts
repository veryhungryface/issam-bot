import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkpointComputerWorkspace,
  ensureComputerWorkspaceLayout,
  restoreComputerWorkspace,
} from "./computer-workspace.js";
import { FakeSandboxProvider } from "./fake-sandbox.js";
import { LocalAgentHomeStore } from "./home.js";

const context = {
  operationId: "workspace-test",
  traceId: "workspace-test",
  workspaceId: "workspace",
  userId: "user",
  signal: new AbortController().signal,
};
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("provider-neutral computer workspace", () => {
  it("prepares shared and bot folders for a Team Computer", async () => {
    const provider = new FakeSandboxProvider();
    const computer = await provider.provision(
      { botId: "team-workspace", homePath: "/ignored" },
      context,
    );
    const execute = vi.spyOn(provider, "execute");

    await ensureComputerWorkspaceLayout(provider, computer, "team", "bot-1", context);

    expect(execute).toHaveBeenCalledWith(
      computer,
      { argv: ["mkdir", "-p", "shared", "bots/bot-1"] },
      context,
    );
  });

  it("does not run shell workspace setup for Browserbase computers", async () => {
    const provider = new FakeSandboxProvider();
    const provisioned = await provider.provision(
      { botId: "browser-workspace", homePath: "/ignored" },
      context,
    );
    const browserComputer = { ...provisioned, kind: "browserbase" as const };
    const execute = vi.spyOn(provider, "execute");

    await ensureComputerWorkspaceLayout(provider, browserComputer, "team", "bot-1", context);

    expect(execute).not.toHaveBeenCalled();
  });

  it("restores a checkpoint into a replacement provider machine", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rakazo-workspace-store-"));
    roots.push(root);
    const home = new LocalAgentHomeStore(root);
    const firstProvider = new FakeSandboxProvider();
    const first = await firstProvider.provision({ botId: "bot-1", homePath: "/ignored" }, context);

    await firstProvider.writeFile(
      first,
      { path: "notes/result.txt", content: new TextEncoder().encode("portable") },
      context,
    );
    const revision = await checkpointComputerWorkspace(
      home,
      firstProvider,
      "bot-1",
      first,
      context,
    );

    const replacementProvider = new FakeSandboxProvider();
    const replacement = await replacementProvider.provision(
      { botId: "bot-1", homePath: "/different-provider" },
      context,
    );
    await restoreComputerWorkspace(home, replacementProvider, "bot-1", replacement, context);

    expect(revision).toMatch(/^rev-/);
    expect(
      new TextDecoder().decode(
        await replacementProvider.readFile(replacement, "notes/result.txt", context),
      ),
    ).toBe("portable");
  });

  it("preserves AgentHome files when Browserbase checkpoints an empty provider workspace", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rakazo-workspace-store-"));
    roots.push(root);
    const home = new LocalAgentHomeStore(root);
    const provider = new FakeSandboxProvider();
    const provisioned = await provider.provision(
      { botId: "browser-workspace", homePath: "/ignored" },
      context,
    );
    const browserComputer = { ...provisioned, kind: "browserbase" as const };
    await home.writeFile("bot-1", "results/result.html", "<h1>preserved</h1>", context);
    const exportWorkspace = vi.spyOn(provider, "exportWorkspace");

    const revision = await checkpointComputerWorkspace(
      home,
      provider,
      "bot-1",
      browserComputer,
      context,
    );

    expect(revision).toMatch(/^rev-/);
    expect(await home.readFile("bot-1", "results/result.html", context)).toBe("<h1>preserved</h1>");
    expect(exportWorkspace).not.toHaveBeenCalled();
  });
});
