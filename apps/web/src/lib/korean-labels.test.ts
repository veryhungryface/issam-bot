import { describe, expect, it } from "vitest";
import { koreanSearchKindLabel, koreanStatusLabel } from "./korean-labels";

describe("Korean UI labels", () => {
  it("maps known statuses without exposing internal enum values", () => {
    expect(koreanStatusLabel("running")).toBe("실행 중");
    expect(koreanStatusLabel("waiting_takeover")).toBe("직접 제어 대기");
    expect(koreanStatusLabel("suspended")).toBe("다음 작업 대기");
    expect(koreanStatusLabel("idle")).toBe("");
  });

  it("uses a safe Korean fallback for unknown statuses", () => {
    expect(koreanStatusLabel("provider-specific-state")).toBe("상태 확인 중");
    expect(koreanStatusLabel(undefined)).toBe("상태 확인 중");
  });

  it("maps every workspace search kind", () => {
    expect(koreanSearchKindLabel("conversation")).toBe("대화");
    expect(koreanSearchKindLabel("message")).toBe("메시지");
    expect(koreanSearchKindLabel("file")).toBe("파일");
    expect(koreanSearchKindLabel("link")).toBe("링크");
    expect(koreanSearchKindLabel("routine")).toBe("자동 작업");
  });
});
