import { describe, expect, it } from "vitest";
import {
  closeUnterminatedFence,
  hasMath,
  normalizeTexDelimiters,
  sanitizeMarkdownUrl,
} from "./markdown";

describe("sanitizeMarkdownUrl", () => {
  it("allows normal external links and optionally allows local links", () => {
    expect(sanitizeMarkdownUrl("https://example.com/docs")).toBe("https://example.com/docs");
    expect(sanitizeMarkdownUrl("mailto:hello@example.com")).toBe("mailto:hello@example.com");
    expect(sanitizeMarkdownUrl("/docs", true)).toBe("/docs");
    expect(sanitizeMarkdownUrl("#section", true)).toBe("#section");
  });

  it("rejects executable and embedded-data URLs", () => {
    expect(sanitizeMarkdownUrl("javascript:alert(1)", true)).toBeUndefined();
    expect(sanitizeMarkdownUrl("data:text/html,<script>alert(1)</script>", true)).toBeUndefined();
    expect(sanitizeMarkdownUrl("/docs")).toBeUndefined();
  });
});

describe("closeUnterminatedFence", () => {
  it("temporarily closes a partial streaming code fence", () => {
    expect(closeUnterminatedFence("Before\n```ts\nconst value = 1;")).toBe(
      "Before\n```ts\nconst value = 1;\n```",
    );
  });

  it("leaves complete markdown unchanged", () => {
    const markdown = "```ts\nconst value = 1;\n```\n\nDone";
    expect(closeUnterminatedFence(markdown)).toBe(markdown);
  });
});

describe("normalizeTexDelimiters", () => {
  it("rewrites the notation the models actually emit", () => {
    expect(normalizeTexDelimiters("비율은 \\(x^2\\) 입니다")).toBe("비율은 $x^2$ 입니다");
    expect(normalizeTexDelimiters("\\[E = mc^2\\]")).toBe("$$\nE = mc^2\n$$");
  });

  it("leaves inline dollar notation alone, and text with none of it untouched", () => {
    expect(normalizeTexDelimiters("$x^2$ 입니다")).toBe("$x^2$ 입니다");
    expect(normalizeTexDelimiters("no math here")).toBe("no math here");
    // `$$…$$` in the middle of a sentence is the author's own inline maths; only a pair
    // that has a line to itself is treated as a displayed equation.
    expect(normalizeTexDelimiters("앞 $$a+b$$ 뒤")).toBe("앞 $$a+b$$ 뒤");
  });

  it("carries display math across the lines it is usually written on", () => {
    expect(normalizeTexDelimiters("\\[\n  a + b\n\\]")).toBe("$$\n  a + b\n$$");
  });

  it("puts a lone dollar pair onto its own lines, which is the only display form", () => {
    // remark-math reads `$$a+b$$` on one line as *inline* maths and sets it small in the
    // middle of the sentence. On its own line it means a displayed equation, so it is given
    // the shape that parses as one.
    expect(normalizeTexDelimiters("$$a+b$$")).toBe("$$\na+b\n$$");
    expect(normalizeTexDelimiters("앞\n\n$$a+b$$\n\n뒤")).toBe("앞\n\n$$\na+b\n$$\n\n뒤");
    // Already in block form: left exactly as it is, with no blank line opened inside it.
    expect(normalizeTexDelimiters("$$\na+b\n$$")).toBe("$$\na+b\n$$");
  });

  it("leaves a lone dollar pair inside a fence as text", () => {
    const fenced = "```md\n$$a+b$$\n```";
    expect(normalizeTexDelimiters(fenced)).toBe(fenced);
  });

  it("keeps out of fenced code, where both notations are text", () => {
    // The one document that must show `\(` verbatim is the one teaching LaTeX.
    const fenced = "```tex\n\\(x^2\\)\n```";
    expect(normalizeTexDelimiters(fenced)).toBe(fenced);
    const tilde = "~~~\n\\[a\\]\n~~~";
    expect(normalizeTexDelimiters(tilde)).toBe(tilde);
  });

  it("keeps out of inline code spans", () => {
    expect(normalizeTexDelimiters("쓰려면 `\\(x\\)` 처럼")).toBe("쓰려면 `\\(x\\)` 처럼");
    // A span of several backticks closes on the same run length, not on the first tick.
    expect(normalizeTexDelimiters("``\\(x\\)``")).toBe("``\\(x\\)``");
  });

  it("converts math that sits beside code rather than inside it", () => {
    expect(normalizeTexDelimiters("`code` then \\(x\\)")).toBe("`code` then $x$");
  });

  it("leaves an opener with no partner exactly as it found it", () => {
    // Otherwise a stray delimiter would hang an unbalanced dollar on the message.
    expect(normalizeTexDelimiters("\\(x^2")).toBe("\\(x^2");
    expect(normalizeTexDelimiters("see \\[ and nothing else")).toBe("see \\[ and nothing else");
  });

  it("will not let a delimiter swallow a blank line", () => {
    // A paragraph break ends math in every TeX dialect, so an opener that only finds its
    // partner on the far side of one has no partner at all.
    const across = "\\(x\n\nlater \\) 끝";
    expect(normalizeTexDelimiters(across)).toBe(across);
  });

  it("does not mistake an escaped backslash for an opener", () => {
    expect(normalizeTexDelimiters("경로 \\\\(x) 아님")).toBe("경로 \\\\(x) 아님");
  });

  it("handles several expressions in one message", () => {
    expect(normalizeTexDelimiters("\\(a\\) 와 \\(b\\) 그리고 \\[c\\]")).toBe(
      "$a$ 와 $b$ 그리고 $$c$$",
    );
  });
});

describe("hasMath", () => {
  it("finds both shapes of dollar math", () => {
    expect(hasMath("$x^2$")).toBe(true);
    expect(hasMath("$$\\frac{1}{2}$$")).toBe(true);
    expect(hasMath("답은 $y = ax + b$ 입니다")).toBe(true);
  });

  it("does not fetch a typesetter for prices", () => {
    // "$1,450원" on its own is one dollar sign, which is money, not math.
    expect(hasMath("환율은 $1,450원")).toBe(false);
    expect(hasMath("no math at all")).toBe(false);
    expect(hasMath("$")).toBe(false);
  });
});
