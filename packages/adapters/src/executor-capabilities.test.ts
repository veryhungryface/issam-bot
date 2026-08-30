import { describe, expect, it } from "vitest";
import {
  agentToolsForSandboxCapabilities,
  computerInstructionForSandboxCapabilities,
} from "./executor.js";

const browserbaseCapabilities = {
  graphical: true,
  pty: false,
  shell: false,
  filesystem: false,
  localFileOpen: false,
  appLaunch: false,
  snapshots: false,
  takeover: true,
  persistentHome: true,
  multiScreen: false,
};

describe("executor sandbox capabilities", () => {
  it("offers contained files but no shell or app launch to browser-only providers", () => {
    const tools = agentToolsForSandboxCapabilities(browserbaseCapabilities);
    const names = tools.map((tool) => tool.name);

    expect(names).toEqual(
      expect.arrayContaining([
        "list_files",
        "read_file",
        "write_file",
        "attach_file",
        "attach_screenshot",
      ]),
    );
    expect(names).not.toContain("shell");
    expect(names).not.toContain("launch_app");
    expect(tools.find((tool) => tool.name === "attach_screenshot")).toBeDefined();
    expect(tools.find((tool) => tool.name === "open_path")?.description).toContain("http(s)");
  });

  it("describes Browserbase recovery and takeover without claiming shell access", () => {
    const instruction = computerInstructionForSandboxCapabilities(browserbaseCapabilities);

    expect(instruction).toContain("blank, stale, or 404");
    expect(instruction).toContain("navigate to the site's home page");
    expect(instruction).toContain("login, MFA, CAPTCHA");
    expect(instruction).toContain("CSS pixels");
    expect(instruction).toContain("open_path");
    expect(instruction).toContain("omnibox");
    expect(instruction).toContain(
      "Shell commands and installed application launching are unavailable",
    );
    expect(instruction).not.toContain("filesystem and shell");
  });
});
