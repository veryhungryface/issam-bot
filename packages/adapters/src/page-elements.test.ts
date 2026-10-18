import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  elementChoices,
  formatElementLabel,
  formatElementTable,
  MAX_ELEMENT_CHOICES,
  MAX_PAGE_TEXT,
  NO_ELEMENT_CHOICE,
  pageElementCollector,
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
    expect(element?.name).not.toMatch(/\p{Cc}/u);
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

describe("pageElementCollector", () => {
  it("is a single self-contained expression, so one round trip collects the page", () => {
    const collector = pageElementCollector(1);
    expect(collector.startsWith("((floor) => {")).toBe(true);
    expect(collector.trimEnd().endsWith("})(1)")).toBe(true);
    // The viewport filter and the tagging are what make the table actable; keep them.
    expect(collector).toContain("innerHeight");
    expect(collector).toContain("data-rk");
  });

  it("collects what the page says, capped, so reading never needs a screenshot", () => {
    // Without text in the snapshot a model that must read an answer off the page falls back
    // to screenshots: measured in production at 7-9s per look against 2-3s for a snapshot.
    const collector = pageElementCollector(1);
    expect(collector).toContain("innerText");
    expect(collector).toContain("main, article, [role=main]");
    expect(collector).toContain(String(MAX_PAGE_TEXT));
    expect(MAX_PAGE_TEXT).toBeLessThanOrEqual(8_000);
  });

  it("only ever inlines a sane starting number", () => {
    for (const bad of [0, -3, 1.5, Number.NaN, 2 ** 60]) {
      expect(pageElementCollector(bad).trimEnd().endsWith("})(1)")).toBe(true);
    }
    expect(pageElementCollector(42).trimEnd().endsWith("})(42)")).toBe(true);
  });
});

type Collected = { elements: { ref: string; name: string }[]; nextRef: number };

/**
 * A page of 60px buttons 100px apart in an 800x600 viewport. jsdom has no layout, so each
 * button's box comes from its data-y minus the scroll offset.
 */
function scrollingPage(count = 40) {
  const buttons = Array.from(
    { length: count },
    (_, index) => `<button style="opacity:1" data-y="${index * 100}">Item ${index}</button>`,
  ).join("");
  const dom = new JSDOM(`<!doctype html><main>${buttons}</main>`, {
    runScripts: "outside-only",
  });
  const { window } = dom;
  let scrollY = 0;
  Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
  Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
  window.HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const top = Number(this.getAttribute("data-y") ?? 0) - scrollY;
    return {
      left: 0,
      top,
      right: 120,
      bottom: top + 60,
      width: 120,
      height: 60,
      x: 0,
      y: top,
      toJSON: () => ({}),
    } as DOMRect;
  };
  Object.defineProperty(window.HTMLElement.prototype, "innerText", {
    configurable: true,
    get(this: HTMLElement) {
      return this.textContent ?? "";
    },
  });
  return {
    document: window.document,
    scrollTo(y: number) {
      scrollY = y;
    },
    collect(nextRef = 1): Collected {
      return window.eval(pageElementCollector(nextRef)) as Collected;
    },
    /** What clicking this ref would hit, as Playwright's strict locator would see it. */
    matches(ref: string): string[] {
      return Array.from(window.document.querySelectorAll(refSelector(ref))).map(
        (element) => element.textContent ?? "",
      );
    },
  };
}

describe("page element refs across snapshots", () => {
  it("never gives one ref to two elements after scrolling and snapshotting again", () => {
    // The production failure: after a scroll the new view was numbered from 1 again while the
    // old view kept its tags, and clicking r1 failed strict mode against two buttons.
    const page = scrollingPage();
    page.collect();
    page.scrollTo(1_500);
    const second = page.collect();

    expect(second.elements.length).toBeGreaterThan(0);
    for (const element of second.elements) {
      expect(page.matches(element.ref)).toEqual([element.name]);
    }
  });

  it("keeps the ref of an element that stays in view", () => {
    const page = scrollingPage();
    const first = page.collect();
    page.scrollTo(200);
    const second = page.collect();

    const before = new Map(first.elements.map((element) => [element.name, element.ref]));
    const stayed = second.elements.filter((element) => before.has(element.name));
    expect(stayed.length).toBeGreaterThan(0);
    for (const element of stayed) expect(element.ref).toBe(before.get(element.name));
  });

  it("lets a ref from an older snapshot match nothing once its element left the view", () => {
    const page = scrollingPage();
    const first = page.collect();
    const gone = first.elements.find((element) => element.name === "Item 0");
    page.scrollTo(1_500);
    const second = page.collect();

    expect(gone).toBeDefined();
    expect(page.matches(gone!.ref)).toEqual([]);
    // And no new element took over that number.
    expect(second.elements.map((element) => element.ref)).not.toContain(gone!.ref);
  });

  it("numbers a new document from the floor the caller carried over", () => {
    const page = scrollingPage(3);
    const collected = page.collect(41);

    expect(collected.elements.map((element) => element.ref)).toEqual(["r41", "r42", "r43"]);
    expect(collected.nextRef).toBe(44);
  });

  it("gives a copy of a tagged element its own ref", () => {
    const page = scrollingPage(3);
    page.collect();
    const original = page.document.querySelector("button");
    const copy = original!.cloneNode(true) as HTMLElement;
    copy.textContent = "Copy";
    copy.setAttribute("data-y", "400");
    page.document.querySelector("main")!.append(copy);
    const second = page.collect();

    const refs = second.elements.map((element) => element.ref);
    expect(new Set(refs).size).toBe(refs.length);
    for (const element of second.elements) {
      expect(page.matches(element.ref)).toEqual([element.name]);
    }
  });

  it("does not let a number the page made up run the counter away", () => {
    const page = scrollingPage(2);
    page.document.querySelector("button")!.setAttribute("data-rk", "99999999999");
    const collected = page.collect();

    expect(collected.elements.map((element) => element.ref)).toEqual(["r1", "r2"]);
    expect(collected.nextRef).toBe(3);
  });
});
