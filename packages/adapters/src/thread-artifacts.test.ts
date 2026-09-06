import type {
  AdapterContext,
  AgentHomeStore,
  ArtifactStore,
  ComputerRef,
  SandboxProvider,
} from "@rakazo/adapter-kit";
import type { MessageBlock } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import {
  attachWorkspaceFileToThread,
  currentTurnFilesInstruction,
  materializeCurrentTurnFiles,
} from "./thread-artifacts.js";

describe("current-turn thread files", () => {
  it("removes stored bytes when artifact metadata cannot be created", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const failure = new Error("database unavailable");

    await expect(
      attachWorkspaceFileToThread(
        {
          prisma: {
            artifact: { create: vi.fn().mockRejectedValue(failure) },
          } as unknown as PrismaClient,
          artifacts: {
            put: vi.fn().mockResolvedValue({ id: "stored-1", hash: "hash" }),
            remove,
          } as unknown as ArtifactStore,
        },
        {
          spaceId: "workspace-1",
          userId: "user-1",
          botId: "bot-1",
          runId: "run-1",
          filePath: "report.pdf",
          bytes: new Uint8Array([1, 2, 3]),
          operationId: "attach-1",
        },
      ),
    ).rejects.toBe(failure);
    expect(remove).toHaveBeenCalledWith(
      "stored-1",
      expect.objectContaining({ spaceId: "workspace-1", botId: "bot-1" }),
    );
  });

  it("copies non-image attachments into the bot workspace and describes their paths", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "artifact-1",
        spaceId: "workspace-1",
        botId: "bot-1",
        name: "../quarterly report.pdf",
        mimeType: "application/pdf",
        size: 4,
        storageKey: "stored-1",
      },
    ]);
    const get = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const markWorkspaceDirty = vi.fn();
    const context: AdapterContext & { botId: string } = {
      operationId: "run-1",
      traceId: "run-1",
      spaceId: "workspace-1",
      userId: "user-1",
      botId: "bot-1",
      runId: "run-1",
      signal: new AbortController().signal,
    };
    const computer: ComputerRef = {
      id: "computer-1",
      botId: "bot-1",
      kind: "fake",
      providerRef: "fake-1",
    };
    const blocks: MessageBlock[] = [
      {
        kind: "file",
        artifactId: "artifact-1",
        name: "../quarterly report.pdf",
        mimeType: "application/pdf",
        size: 4,
      },
    ];

    const files = await materializeCurrentTurnFiles(
      {
        prisma: { artifact: { findMany } } as unknown as PrismaClient,
        artifacts: { get } as unknown as ArtifactStore,
        sandbox: { writeFile } as unknown as SandboxProvider,
      },
      blocks,
      { context, computer, computerMode: "team", markWorkspaceDirty },
    );

    expect(get).toHaveBeenCalledWith("stored-1", context);
    expect(writeFile).toHaveBeenCalledWith(
      computer,
      {
        path: "bots/bot-1/attachments/artifact-1.pdf",
        content: new Uint8Array([1, 2, 3, 4]),
      },
      context,
    );
    expect(markWorkspaceDirty).toHaveBeenCalledOnce();
    expect(markWorkspaceDirty.mock.invocationCallOrder[0]).toBeLessThan(
      writeFile.mock.invocationCallOrder[0]!,
    );
    expect(files).toEqual([
      {
        name: "../quarterly report.pdf",
        mimeType: "application/pdf",
        size: 4,
        path: "attachments/artifact-1.pdf",
      },
    ]);
    expect(currentTurnFilesInstruction(files)).toContain('"attachments/artifact-1.pdf"');
  });

  it("does not load images as computer files", async () => {
    const findMany = vi.fn();
    const files = await materializeCurrentTurnFiles(
      {
        prisma: { artifact: { findMany } } as unknown as PrismaClient,
        artifacts: {} as ArtifactStore,
        sandbox: {} as SandboxProvider,
      },
      [
        {
          kind: "image",
          artifactId: "image-1",
          name: "photo.png",
          mimeType: "image/png",
        },
      ],
      {
        context: {
          operationId: "run-1",
          traceId: "run-1",
          spaceId: "workspace-1",
          userId: "user-1",
          botId: "bot-1",
          signal: new AbortController().signal,
        },
        computer: {
          id: "computer-1",
          botId: "bot-1",
          kind: "fake",
          providerRef: "fake-1",
        },
        computerMode: "team",
      },
    );

    expect(files).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("attaches SVG, video, and audio files in their native formats", async () => {
    const create = vi.fn().mockImplementation(({ data }) =>
      Promise.resolve({
        id: `row-${data.name}`,
        name: data.name,
        mimeType: data.mimeType,
        size: data.size,
      }),
    );
    const cases = [
      { filePath: "diagram.svg", mimeType: "image/svg+xml", kind: "image" as const },
      { filePath: "clip.mp4", mimeType: "video/mp4", kind: "file" as const },
      { filePath: "clip.webm", mimeType: "video/webm", kind: "file" as const },
      { filePath: "audio.mp3", mimeType: "audio/mpeg", kind: "file" as const },
      { filePath: "tone.wav", mimeType: "audio/wav", kind: "file" as const },
    ];
    for (const expected of cases) {
      const result = await attachWorkspaceFileToThread(
        {
          prisma: { artifact: { create } } as unknown as PrismaClient,
          artifacts: {
            put: vi.fn().mockResolvedValue({ id: "stored", hash: "hash" }),
            remove: vi.fn(),
          } as unknown as ArtifactStore,
        },
        {
          spaceId: "workspace-1",
          userId: "user-1",
          botId: "bot-1",
          runId: "run-1",
          filePath: expected.filePath,
          bytes: new Uint8Array([1]),
          operationId: `attach-${expected.filePath}`,
        },
      );
      expect(result.block.kind).toBe(expected.kind);
      expect(result.block.mimeType).toBe(expected.mimeType);
    }
  });

  it("copies Browserbase current-turn files into AgentHome without provider file access", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "artifact-html",
        spaceId: "workspace-1",
        botId: "bot-1",
        name: "source.html",
        mimeType: "text/html",
        size: 4,
        storageKey: "stored-html",
      },
    ]);
    const bytes = new Uint8Array([0, 1, 2, 255]);
    const writeBytes = vi.fn().mockResolvedValue(undefined);
    const sandboxWriteFile = vi.fn();
    const context: AdapterContext & { botId: string } = {
      operationId: "run-browser",
      traceId: "run-browser",
      spaceId: "workspace-1",
      userId: "user-1",
      botId: "bot-1",
      signal: new AbortController().signal,
    };

    const files = await materializeCurrentTurnFiles(
      {
        prisma: { artifact: { findMany } } as unknown as PrismaClient,
        artifacts: {
          get: vi.fn().mockResolvedValue(bytes),
        } as unknown as ArtifactStore,
        sandbox: { writeFile: sandboxWriteFile } as unknown as SandboxProvider,
        home: { writeBytes } as unknown as AgentHomeStore,
      },
      [
        {
          kind: "file",
          artifactId: "artifact-html",
          name: "source.html",
          mimeType: "text/html",
          size: 4,
        },
      ],
      {
        context,
        computer: {
          id: "browserbase:v1:test",
          botId: "bot-1",
          kind: "browserbase",
          providerRef: "browserbase:v1:test",
        },
        computerMode: "dedicated",
        homeKey: "bot-1",
      },
    );

    expect(writeBytes).toHaveBeenCalledWith(
      "bot-1",
      "attachments/artifact-html.html",
      bytes,
      context,
    );
    expect(sandboxWriteFile).not.toHaveBeenCalled();
    expect(files[0]?.path).toBe("attachments/artifact-html.html");
  });
});
