import { describe, expect, it } from "vitest";
import {
  elementChoices,
  formatElementLabel,
  formatElementTable,
  MAX_ELEMENT_CHOICES,
  NO_ELEMENT_CHOICE,
  PAGE_ELEMENT_COLLECTOR,
  prepareElements,
  refSelector,
} from "./page-elements.js";

describe("prepareElements", () => {
  it("orders top to bottom, then left to right, and numbers from there", () => {
    const prepared = prepareElements([
      { ref: "r1", role: "link", name: "아래", x: 10, y: 400 },
      { ref: "r2", role: "button", name: "오른쪽 위", x: 900, y: 100 },
      { ref: "r3", role: "button", name: "왼쪽 위", x: 20, y: 100 },
    ]);
    expect(prepared.map((element) => [element.order, element.name])).toEqual([
      [1, "왼쪽 위"],
      [2, "오른쪽 위"],
      [3, "아래"],
    ]);
  });

  it("drops nameless links and buttons but keeps nameless inputs", () => {
    const prepared = prepareElements([
      { ref: "r1", role: "link", name: "", x: 0, y: 0 },
      { ref: "r2", role: "button", name: "   ", x: 0, y: 10 },
      { ref: "r3", role: "textbox", name: "", x: 0, y: 20 },
      { ref: "r4", role: "password", name: "", x: 0, y: 30 },
    ]);
    // Three options that all read `link ""` are not a choice; an empty field still is.
    expect(prepared.map((element) => element.ref)).toEqual(["r3", "r4"]);
  });

  it("collapses whitespace, strips control characters, and truncates long names", () => {
    const [element] = prepareElements([
      {
        ref: "r1",
        role: "link",
        name: `구매 1천+\n\t동국제약\u0007 ${"덴트릭스 ".repeat(20)}`,
        x: 0,
        y: 0,
      },
    ]);
    expect(element?.name.startsWith("구매 1천+ 동국제약 덴트릭스")).toBe(true);
    expect(element?.name).not.toMatch(/[\u0000-\u001f]/);
    expect(element?.name.length).toBeLessThanOrEqual(60);
  });

  it("caps the table so a decision stays cheap", () => {
    const many = Array.from({ length: 200 }, (_, index) => ({
      ref: `r${index + 1}`,
      role: "link",
      name: `항목 ${index + 1}`,
      x: 0,
      y: index,
    }));
    expect(prepareElements(many)).toHaveLength(MAX_ELEMENT_CHOICES);
    expect(prepareElements(many, { max: 5 })).toHaveLength(5);
  });

  it("ignores entries with no ref", () => {
    expect(prepareElements([{ role: "link", name: "무명", x: 0, y: 0 }])).toEqual([]);
  });
});

describe("formatElementLabel", () => {
  it("carries order, role, name, placeholder and section", () => {
    const [element] = prepareElements([
      {
        ref: "r7",
        role: "textbox",
        name: "검색어 입력",
        placeholder: "검색어를 입력해주세요.",
        heading: "치약 : 다나와 통합검색",
        x: 100,
        y: 50,
      },
    ]);
    expect(formatElementLabel(element!)).toBe(
      '#1 textbox "검색어 입력" placeholder="검색어를 입력해주세요." under "치약 : 다나와 통합검색"',
    );
  });

  it("leaves out the parts a page did not provide", () => {
    const [element] = prepareElements([{ ref: "r2", role: "button", name: "로그인", x: 0, y: 0 }]);
    expect(formatElementLabel(element!)).toBe('#1 button "로그인"');
  });
});

describe("elementChoices", () => {
  it("always offers a way to say the page has nothing that fits", () => {
    const choices = elementChoices(
      prepareElements([{ ref: "r1", role: "button", name: "검색", x: 0, y: 0 }]),
    );
    expect(Object.keys(choices)).toEqual(["r1", NO_ELEMENT_CHOICE]);
    expect(choices[NO_ELEMENT_CHOICE]).toBeTruthy();
  });
});

describe("refSelector", () => {
  it("addresses the tag the collector wrote", () => {
    expect(refSelector("r12")).toBe('[data-rk="12"]');
    expect(refSelector(" r3 ")).toBe('[data-rk="3"]');
  });

  it("refuses anything it did not hand out", () => {
    expect(() => refSelector("e3")).toThrow(/Unknown element ref/);
    expect(() => refSelector('r1"] , [data-rk="2')).toThrow(/Unknown element ref/);
  });
});

describe("formatElementTable", () => {
  it("reads as one line per element under the page identity", () => {
    const table = formatElementTable({
      url: "https://example.test/search",
      title: "검색",
      elements: prepareElements([
        { ref: "r1", role: "textbox", name: "검색어", x: 0, y: 0 },
        { ref: "r2", role: "button", name: "검색", x: 200, y: 0 },
      ]),
    });
    expect(table.split("\n")).toEqual([
      "검색 — https://example.test/search",
      'r1: #1 textbox "검색어"',
      'r2: #2 button "검색"',
    ]);
  });
});

describe("PAGE_ELEMENT_COLLECTOR", () => {
  it("is a single self-contained expression, so one round trip collects the page", () => {
    expect(PAGE_ELEMENT_COLLECTOR.startsWith("(() => {")).toBe(true);
    expect(PAGE_ELEMENT_COLLECTOR.trimEnd().endsWith("})()")).toBe(true);
    // The viewport filter and the tagging are what make the table actable; keep them.
    expect(PAGE_ELEMENT_COLLECTOR).toContain("innerHeight");
    expect(PAGE_ELEMENT_COLLECTOR).toContain("data-rk");
  });
});
