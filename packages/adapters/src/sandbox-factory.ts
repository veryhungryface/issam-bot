import type { SandboxProvider } from "@rakazo/adapter-kit";
import { BoxSandboxEmulator } from "./box-emulator.js";
import { BoxSandboxProvider } from "./box-sandbox.js";
import { BrowserbaseSandboxProvider } from "./browserbase-sandbox.js";
import { DaytonaSandboxEmulator } from "./daytona-emulator.js";
import { DaytonaSandboxProvider } from "./daytona-sandbox.js";
import { DesktopSandboxProvider } from "./desktop-sandbox.js";
import { DockerSandboxProvider } from "./docker-sandbox.js";
import { ManagedSandboxEmulator } from "./e2b-emulator.js";
import { E2BSandboxProvider } from "./e2b-sandbox.js";
import { FakeSandboxProvider } from "./fake-sandbox.js";

export interface SandboxProviderOptions {
  supervisorUrl?: string;
  supervisorToken?: string;
  e2bApiKey?: string;
  daytonaApiKey?: string;
  daytonaApiUrl?: string;
  daytonaTarget?: string;
  boxApiKey?: string;
  boxApiUrl?: string;
  browserbaseApiKey?: string;
  browserbaseProjectId?: string;
  browserbaseTaskTimeoutSeconds?: number;
  dataDir?: string;
}

export function createSandboxProvider(kind: string, opts: SandboxProviderOptions): SandboxProvider {
  switch (kind) {
    case "e2b":
      if (!opts.e2bApiKey) throw new Error("E2B_API_KEY is required for the e2b sandbox provider");
      return new E2BSandboxProvider(opts.e2bApiKey);
    case "daytona":
      if (!opts.daytonaApiKey) {
        throw new Error("DAYTONA_API_KEY is required for the daytona sandbox provider");
      }
      return new DaytonaSandboxProvider({
        apiKey: opts.daytonaApiKey,
        apiUrl: opts.daytonaApiUrl,
        target: opts.daytonaTarget,
      });
    case "box":
      if (!opts.boxApiKey) throw new Error("BOX_API_KEY is required for the box sandbox provider");
      return new BoxSandboxProvider({ apiKey: opts.boxApiKey, apiUrl: opts.boxApiUrl });
    case "browserbase":
      if (!opts.browserbaseApiKey || !opts.browserbaseProjectId) {
        throw new Error(
          "BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID are required for the browserbase sandbox provider",
        );
      }
      return new BrowserbaseSandboxProvider({
        apiKey: opts.browserbaseApiKey,
        projectId: opts.browserbaseProjectId,
        timeoutSeconds: opts.browserbaseTaskTimeoutSeconds,
      });
    case "docker":
      return new DockerSandboxProvider(
        opts.supervisorUrl ?? "http://127.0.0.1:7091",
        opts.supervisorToken,
      );
    case "e2b-emulator":
      return new ManagedSandboxEmulator();
    case "daytona-emulator":
      return new DaytonaSandboxEmulator();
    case "box-emulator":
      return new BoxSandboxEmulator();
    case "desktop":
      return new DesktopSandboxProvider({
        root: opts.dataDir,
      });
    case "fake":
      return new FakeSandboxProvider();
    default:
      throw new Error(
        `Unknown SANDBOX_PROVIDER "${kind}". Use docker | e2b | daytona | box | browserbase | e2b-emulator | daytona-emulator | box-emulator | desktop | fake.`,
      );
  }
}
