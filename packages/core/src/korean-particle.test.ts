import { describe, expect, it } from "vitest";
import { subjectParticle, withSubjectParticle } from "./korean-particle.js";

describe("subjectParticle", () => {
  it("follows the final consonant of the last Hangul syllable", () => {
    expect(subjectParticle("연구원")).toBe("이");
    expect(subjectParticle("비서")).toBe("가");
    expect(subjectParticle("봇")).toBe("이");
    expect(subjectParticle("도우미")).toBe("가");
  });

  it("reads a Latin or numeric ending the way it is said aloud", () => {
    expect(subjectParticle("ERP")).toBe("가"); // 피
    expect(subjectParticle("Gmail")).toBe("이"); // 엘
    expect(subjectParticle("Scheduler")).toBe("이"); // 알
    expect(subjectParticle("Bot")).toBe("가"); // 티
    expect(subjectParticle("Model 3")).toBe("이"); // 삼
    expect(subjectParticle("GPT-4")).toBe("가"); // 사
  });

  it("falls back to 가 for a name with no reading, and for no name at all", () => {
    expect(subjectParticle("🤖")).toBe("가");
    expect(subjectParticle("")).toBe("가");
    expect(subjectParticle("   ")).toBe("가");
  });

  it("ignores trailing whitespace when looking at the ending", () => {
    expect(subjectParticle("연구원  ")).toBe("이");
    expect(withSubjectParticle("ERP비서")).toBe("ERP비서가");
  });
});
