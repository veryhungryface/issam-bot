import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./return-to.js";

describe("safeReturnPath", () => {
  it("allows a same-origin path, with a query and a hash", () => {
    expect(safeReturnPath("/pair/abc")).toBe("/pair/abc");
    expect(safeReturnPath("/app?tab=1#top")).toBe("/app?tab=1#top");
  });

  it("refuses anything that leaves the site", () => {
    expect(safeReturnPath("//evil.test")).toBeNull();
    expect(safeReturnPath("/\\evil.test")).toBeNull();
    expect(safeReturnPath("https://evil.test")).toBeNull();
    expect(safeReturnPath("javascript:alert(1)")).toBeNull();
  });

  it("refuses whitespace and control characters, which is how the above get smuggled", () => {
    expect(safeReturnPath("/ /evil.test")).toBeNull();
    expect(safeReturnPath("/\n//evil.test")).toBeNull();
    expect(safeReturnPath("/\u0000")).toBeNull();
  });

  it("refuses a relative path and nothing at all", () => {
    expect(safeReturnPath("pair/abc")).toBeNull();
    expect(safeReturnPath(null)).toBeNull();
    expect(safeReturnPath(undefined)).toBeNull();
    expect(safeReturnPath("")).toBeNull();
  });
});
