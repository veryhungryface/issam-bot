import type {
  AdapterContext,
  AgentHomeStore,
  ComputerFileEntry,
  ComputerRef,
  SandboxProvider,
} from "@rakazo/adapter-kit";

export type AgentWorkspaceFileDeps = {
  home: AgentHomeStore;
  sandbox: SandboxProvider;
  computer: ComputerRef;
  homeKey: string;
  context: AdapterContext;
};

export function usesAgentHomeFiles(sandbox: SandboxProvider): boolean {
  return !sandbox.describe().capabilities.filesystem;
}

export async function listAgentWorkspaceFiles(
  deps: AgentWorkspaceFileDeps,
  storedPath: string,
): Promise<ComputerFileEntry[]> {
  return usesAgentHomeFiles(deps.sandbox)
    ? deps.home.list(deps.homeKey, storedPath, deps.context)
    : deps.sandbox.listFiles(deps.computer, storedPath, deps.context);
}

export async function readAgentWorkspaceFile(
  deps: AgentWorkspaceFileDeps,
  storedPath: string,
  options?: { maxBytes?: number },
): Promise<Uint8Array> {
  if (usesAgentHomeFiles(deps.sandbox)) {
    return deps.home.readBytes(deps.homeKey, storedPath, deps.context, options);
  }
  return deps.sandbox.readFile(deps.computer, storedPath, deps.context, options);
}

export async function writeAgentWorkspaceTextFile(
  deps: AgentWorkspaceFileDeps,
  storedPath: string,
  content: string,
): Promise<void> {
  if (usesAgentHomeFiles(deps.sandbox)) {
    await deps.home.writeFile(deps.homeKey, storedPath, content, deps.context);
    return;
  }
  await deps.sandbox.writeFile(
    deps.computer,
    { path: storedPath, content: new TextEncoder().encode(content) },
    deps.context,
  );
}

export async function writeAgentWorkspaceFile(
  deps: AgentWorkspaceFileDeps,
  storedPath: string,
  content: Uint8Array,
): Promise<void> {
  if (usesAgentHomeFiles(deps.sandbox)) {
    await deps.home.writeBytes(deps.homeKey, storedPath, content, deps.context);
    return;
  }
  await deps.sandbox.writeFile(deps.computer, { path: storedPath, content }, deps.context);
}
