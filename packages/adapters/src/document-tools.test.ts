import { describe, expect, it } from "vitest";
import {
  createDocumentBytes,
  DOCUMENT_READ_PAGE_WINDOW,
  DocumentToolError,
  documentFormatForPath,
  hwpxPreset,
  normalizeDocumentPageRange,
  parseDocumentMarkdown,
  parseMarkdownBlocks,
  sanitizeDocumentFileName,
} from "./document-tools.js";

const WORKSHEET_MARKDOWN = `# AI 뉴스 문해력 학습지

## 본문 읽기
최근 인공지능 기사 중 한국경제(8/28) 기사를 골랐습니다.

| 구분 | 내용 |
| --- | --- |
| 주제 | AI 산업자 선정 |
| 난이도 | 중 |

## 사실 확인
1. 기사에서 말하는 산업은 무엇인가?
2. 선정 기준은 무엇인가?
`;

describe("document tools", () => {
  it("generates a valid hwpx document and reads it back", async () => {
    const bytes = await createDocumentBytes("hwpx", WORKSHEET_MARKDOWN, {
      title: "AI 뉴스 문해력 학습지",
    });
    expect(Buffer.from(bytes.subarray(0, 2)).toString("latin1")).toBe("PK");
    const parsed = await parseDocumentMarkdown(bytes);
    expect(parsed.fileType).toBe("hwpx");
    expect(parsed.markdown).toContain("문해력");
    expect(parsed.markdown).toContain("산업자 선정");
  });

  it("normalizes page ranges and clamps them to the read window", () => {
    expect(normalizeDocumentPageRange("31-60")).toEqual({ start: 31, end: 60 });
    expect(normalizeDocumentPageRange("5")).toEqual({
      start: 5,
      end: 4 + DOCUMENT_READ_PAGE_WINDOW,
    });
    expect(normalizeDocumentPageRange("1-100")).toEqual({
      start: 1,
      end: DOCUMENT_READ_PAGE_WINDOW,
    });
    expect(() => normalizeDocumentPageRange("0-5")).toThrow(DocumentToolError);
    expect(() => normalizeDocumentPageRange("10-3")).toThrow(DocumentToolError);
    expect(() => normalizeDocumentPageRange("abc")).toThrow(DocumentToolError);
  });

  it("reports page counts and honors a page range when parsing", async () => {
    const bytes = await createDocumentBytes("hwpx", WORKSHEET_MARKDOWN, { title: "페이지 테스트" });
    const parsed = await parseDocumentMarkdown(bytes, { pages: { start: 1, end: 30 } });
    expect(parsed.markdown).toContain("문해력");
    expect(parsed.pageCount).toBeGreaterThanOrEqual(1);
    expect(["layout", "section"]).toContain(parsed.pageMode);
    const beyond = await parseDocumentMarkdown(bytes, { pages: { start: 100, end: 129 } });
    expect(beyond.markdown).toBe("");
    expect(beyond.pageCount).toBe(parsed.pageCount);
  });

  it("generates a docx that parses back to the same content", async () => {
    const bytes = await createDocumentBytes("docx", WORKSHEET_MARKDOWN, {
      title: "AI 뉴스 문해력 학습지",
    });
    expect(Buffer.from(bytes.subarray(0, 2)).toString("latin1")).toBe("PK");
    const parsed = await parseDocumentMarkdown(bytes);
    expect(parsed.markdown).toContain("문해력");
    expect(parsed.markdown).toContain("선정 기준은 무엇인가");
  });

  it("generates an xlsx sheet from a markdown table", async () => {
    const bytes = await createDocumentBytes("xlsx", WORKSHEET_MARKDOWN, {
      title: "AI 뉴스 문해력 학습지",
    });
    expect(Buffer.from(bytes.subarray(0, 2)).toString("latin1")).toBe("PK");
    const parsed = await parseDocumentMarkdown(bytes);
    expect(parsed.markdown).toContain("AI 산업자 선정");
  });

  it("generates a pptx deck with one slide per H1", async () => {
    const bytes = await createDocumentBytes(
      "pptx",
      "# 첫 슬라이드\n- 항목 하나\n\n# 둘째 슬라이드\n- 항목 둘",
      { title: "데크" },
    );
    expect(Buffer.from(bytes.subarray(0, 2)).toString("latin1")).toBe("PK");
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(bytes);
    expect(await zip.file("ppt/presentation.xml")?.async("string")).toContain("<p:presentation");
  });

  it("rejects empty content and unknown formats and presets", async () => {
    await expect(createDocumentBytes("hwpx", "   ", {})).rejects.toThrow(/empty/);
    expect(documentFormatForPath("notes.txt")).toBeNull();
    expect(() => hwpxPreset("없는프리셋")).toThrow(/unknown hwpx preset/);
    expect(hwpxPreset("보고서")).toBe("보고서");
  });

  it("sanitizes file names for the chosen format", () => {
    expect(sanitizeDocumentFileName("AI 뉴스/학습지", "hwpx")).toBe("AI 뉴스_학습지.hwpx");
    expect(sanitizeDocumentFileName("  ", "docx")).toBe("document.docx");
  });

  it("parses markdown blocks for structured writers", () => {
    const blocks = parseMarkdownBlocks(
      "# 제목\n\n본문 **강조** 문장입니다.\n\n- 항목\n- 항목 둘\n\n| a | b |\n| - | - |\n| 1 | 2 |",
    );
    expect(blocks).toEqual([
      { kind: "heading", level: 1, text: "제목" },
      {
        kind: "paragraph",
        runs: [
          { text: "본문 ", bold: false, italic: false },
          { text: "강조", bold: true, italic: false },
          { text: " 문장입니다.", bold: false, italic: false },
        ],
      },
      {
        kind: "list",
        ordered: false,
        items: [
          [{ text: "항목", bold: false, italic: false }],
          [{ text: "항목 둘", bold: false, italic: false }],
        ],
      },
      {
        kind: "table",
        rows: [
          ["a", "b"],
          ["1", "2"],
        ],
      },
    ]);
  });
});
