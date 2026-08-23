import { describe, expect, it } from "vitest";
import { artifactBlobMimeType, decodeArtifactBase64 } from "./artifact-open";

describe("artifact opening policy", () => {
  it("forces executable HTML to a download-only binary type", () => {
    expect(artifactBlobMimeType("text/html")).toBe("application/octet-stream");
    expect(artifactBlobMimeType("application/pdf")).toBe("application/octet-stream");
    expect(artifactBlobMimeType("image/png")).toBe("image/png");
  });

  it("decodes artifact content", () => {
    expect(new TextDecoder().decode(decodeArtifactBase64("aGVsbG8="))).toBe("hello");
  });
});
