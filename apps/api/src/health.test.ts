import { describe, expect, it } from "vitest";
import { healthRoutes } from "./health.js";

const details = () => ({ sandbox: "browserbase", revision: "abc123" });

describe("health routes", () => {
  it("tells the public only that it is alive", async () => {
    const response = await healthRoutes(details).request("http://api.test/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("gives the details to a caller on the API port", async () => {
    const response = await healthRoutes(details).request("http://127.0.0.1:3100/internal/health");
    expect(await response.json()).toEqual({ ok: true, sandbox: "browserbase", revision: "abc123" });
  });

  it("refuses the details to anything that came through a proxy", async () => {
    for (const header of ["x-forwarded-for", "forwarded"]) {
      const response = await healthRoutes(details).request("http://api.test/internal/health", {
        headers: { [header]: "203.0.113.7" },
      });
      expect(response.status).toBe(404);
    }
  });
});
