import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listAgentWorkspaceFiles,
  readAgentWorkspaceFile,
  writeAgentWorkspaceTextFile,
} from "./agent-workspace-files.js";
import { FakeSandboxProvider } from "./fake-sandbox.js";
import { LocalAgentHomeStore } from "./home.js";

const context = {
  operationId: "agent-files-test",
  traceId: "agent-files-test",
  workspaceId: "workspace",
  userId: "user",
  botId: "bot-1",
  signal: new AbortController().signal,
};
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("agent workspace file routing", () => {
  it("uses contained AgentHome files when the provider has no filesystem", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rakazo-agent-files-"));
    roots.push(root);
    const home = new LocalAgentHomeStore(root);
    const sandbox = new FakeSandboxProvider();
    const base = sandbox.describe();
    vi.spyOn(sandbox, "describe").mockReturnValue({
      ...base,
      capabilities: { ...base.capabilities, filesystem: false, shell: false },
    });
    const computer = {
      id: "browserbase:v1:test",
      botId: "bot-1",
      kind: "browserbase" as const,
      providerRef: "browserbase:v1:test",
    };
    const readProviderFile = vi.spyOn(sandbox, "readFile");
    const writeProviderFile = vi.spyOn(sandbox, "writeFile");
    const listProviderFiles = vi.spyOn(sandbox, "listFiles");
    const deps = { home, sandbox, computer, homeKey: "bot-1", context };

    await writeAgentWorkspaceTextFile(deps, "results/result.html", "<h1>safe</h1>");
    expect(
      new TextDecoder().decode(await readAgentWorkspaceFile(deps, "results/result.html")),
    ).toBe("<h1>safe</h1>");
    expect(await listAgentWorkspaceFiles(deps, "results")).toEqual([
      { path: "results/result.html", kind: "file", size: 13 },
    ]);
    expect(readProviderFile).not.toHaveBeenCalled();
    expect(writeProviderFile).not.toHaveBeenCalled();
    expect(listProviderFiles).not.toHaveBeenCalled();
  });

  it("retains AgentHome traversal protection", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rakazo-agent-files-"));
    roots.push(root);
    const home = new LocalAgentHomeStore(root);
    const sandbox = new FakeSandboxProvider();
    const base = sandbox.describe();
    vi.spyOn(sandbox, "describe").mockReturnValue({
      ...base,
      capabilities: { ...base.capabilities, filesystem: false },
    });
    const deps = {
      home,
      sandbox,
      computer: {
        id: "browserbase:v1:test",
        botId: "bot-1",
        kind: "browserbase" as const,
        providerRef: "browserbase:v1:test",
      },
      homeKey: "bot-1",
      context,
    };

    await expect(writeAgentWorkspaceTextFile(deps, "../../escape.html", "no")).rejects.toThrow(
      /outside|escapes/i,
    );
  });
});
