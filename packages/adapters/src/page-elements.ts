/**
 * What a decision model is allowed to see of a web page.
 *
 * A screenshot costs a remote PNG round trip and ~1,300 vision tokens per step. The same
 * decision can be made from a short table of the elements a person could actually act on —
 * if the table is built the way the model reads best. These rules come from measurements
 * against live Korean pages through Jev (TypeSafe System One):
 *
 * - Visible and inside the viewport only. A search page exposes 1,401 candidates and 82
 *   visible ones; the first table included hidden dropdown entries and the model picked one,
 *   which then failed to click.
 * - The table belongs in the question's options, not repeated in the shared state: dropping
 *   the duplicate cut a decision from 6,800 to 1,990 tokens with the same answers.
 * - A visual-order number, the role, the accessible name, the placeholder and the nearest
 *   heading are worth their tokens. A guessed "which repeated card is this" grouping was not:
 *   it produced labels like `switch "on" - prodArea 2/3` and made answers worse.
 * - Always offer "none". Asked for a control the page does not have, the model takes it with
 *   0.94-0.96 confidence instead of inventing a target.
 *
 * Identity questions ("the password field", "the link named X") answer at 0.99-1.0 confidence.
 * Ordinal questions ("the second product") answer at 0.37-0.75 — order is the caller's job,
 * since the caller already has the table in visual order.
 */

/** One actionable element as the model sees it. */
export type PageElement = {
  /** Stable within a snapshot; the page carries it as `data-rk`. */
  ref: string;
  role: string;
  name: string;
  placeholder?: string;
  /** Nearest heading above the element, for section context. */
  heading?: string;
  /** Visual order (top to bottom, then left to right), starting at 1. */
  order: number;
  x: number;
  y: number;
};

export type PageElementSnapshot = {
  url: string;
  title: string;
  elements: PageElement[];
  /** The page's readable text, already collapsed and capped. */
  text?: string;
};

/** Enough of a page to answer from, without paying for a screenshot to read it. */
export const MAX_PAGE_TEXT = 5_000;

/** Kept even without a name: an empty input is still the thing you type into. */
const NAMELESS_ROLES = new Set(["textbox", "password", "combobox", "checkbox", "radio"]);

export const MAX_ELEMENT_NAME = 60;
export const MAX_ELEMENT_CHOICES = 60;
export const NO_ELEMENT_CHOICE = "none";

/**
 * Collected in one page.evaluate so a table costs a single round trip. Returns elements in
 * visual order, each tagged with `data-rk` so acting needs no second lookup.
 */
export const PAGE_ELEMENT_COLLECTOR = `(() => {
  const SELECTOR = 'a[href], button, input, select, textarea, [role=button], [role=link], [role=tab], [role=checkbox], [role=combobox], [role=textbox], [contenteditable="true"]';
  const clean = (value) => (value || "").replace(/\\s+/g, " ").replace(/\\p{Cc}/gu, "").trim();
  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;
  const collected = [];
  let index = 0;
  for (const element of document.querySelectorAll(SELECTOR)) {
    const box = element.getBoundingClientRect();
    if (box.width < 8 || box.height < 8) continue;
    const style = getComputedStyle(element);
    if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) < 0.1) continue;
    if (element.disabled || element.getAttribute("aria-hidden") === "true") continue;
    if (!(box.bottom > 0 && box.top < viewportHeight && box.right > 0 && box.left < viewportWidth)) continue;
    const tag = element.tagName.toLowerCase();
    const type = (element.getAttribute("type") || "").toLowerCase();
    const role =
      element.getAttribute("role") ||
      (tag === "a" ? "link"
        : tag === "button" ? "button"
        : tag === "select" ? "combobox"
        : tag === "textarea" ? "textbox"
        : tag === "input"
          ? (["button", "submit", "image"].includes(type) ? "button"
            : ["checkbox", "radio"].includes(type) ? type
            : type === "password" ? "password"
            : "textbox")
        : "element");
    const name = clean(
      element.getAttribute("aria-label") ||
        element.getAttribute("alt") ||
        element.getAttribute("title") ||
        element.getAttribute("placeholder") ||
        element.innerText ||
        element.value ||
        element.getAttribute("name"),
    );
    let heading = null;
    let node = element;
    while (node && !heading) {
      heading = node.previousElementSibling?.closest?.("h1,h2,h3") || null;
      node = node.parentElement;
    }
    index += 1;
    element.setAttribute("data-rk", String(index));
    collected.push({
      ref: "r" + index,
      role,
      name,
      placeholder: clean(element.getAttribute("placeholder")),
      heading: heading ? clean(heading.innerText) : "",
      x: Math.round(box.left),
      y: Math.round(box.top),
    });
  }
  // What a reader would see. A model that must read an answer off the page would otherwise
  // have to take a screenshot, which costs far more time and tokens than the words do.
  const readableRoot = document.querySelector("main, article, [role=main]") || document.body;
  const readable = clean(readableRoot ? readableRoot.innerText : "");
  return {
    url: location.href,
    title: document.title,
    elements: collected,
    text: readable.length > ${MAX_PAGE_TEXT} ? readable.slice(0, ${MAX_PAGE_TEXT}) + " […]" : readable,
  };
})()`;

/** CSS selector for an element the collector tagged. */
export function refSelector(ref: string): string {
  const index = /^r(\d+)$/.exec(ref.trim())?.[1];
  if (!index) throw new Error(`Unknown element ref "${ref}"`);
  return `[data-rk="${index}"]`;
}

type RawElement = Partial<PageElement> & { ref?: string; role?: string; name?: string };

/**
 * Order, trim and drop what would only add noise. Nameless links and buttons go: the model
 * cannot choose between three options that all read `link ""`, and neither could a person.
 */
export function prepareElements(
  raw: readonly RawElement[],
  options: { max?: number } = {},
): PageElement[] {
  const max = options.max ?? MAX_ELEMENT_CHOICES;
  const kept: PageElement[] = [];
  for (const entry of raw) {
    const ref = String(entry.ref ?? "").trim();
    const role = String(entry.role ?? "").trim() || "element";
    const name = truncate(String(entry.name ?? ""), MAX_ELEMENT_NAME);
    if (!ref) continue;
    if (!name && !NAMELESS_ROLES.has(role)) continue;
    kept.push({
      ref,
      role,
      name,
      placeholder: truncate(String(entry.placeholder ?? ""), 24) || undefined,
      heading: truncate(String(entry.heading ?? ""), 24) || undefined,
      order: 0,
      x: Number(entry.x ?? 0),
      y: Number(entry.y ?? 0),
    });
  }
  kept.sort((left, right) => left.y - right.y || left.x - right.x);
  return kept.slice(0, max).map((element, position) => ({ ...element, order: position + 1 }));
}

/** One option line. Short enough to keep 60 of them cheap, specific enough to tell them apart. */
export function formatElementLabel(element: PageElement): string {
  const parts = [`#${element.order}`, element.role, `"${element.name}"`];
  if (element.placeholder) parts.push(`placeholder="${element.placeholder}"`);
  if (element.heading) parts.push(`under "${element.heading}"`);
  return parts.join(" ");
}

/**
 * The options a decision model chooses between, including the escape hatch. Without a "none"
 * option a model asked for a control the page lacks will still name one.
 */
export function elementChoices(
  elements: readonly PageElement[],
  noneLabel = "No element here fits the goal",
): Record<string, string> {
  const choices: Record<string, string> = {};
  for (const element of elements) choices[element.ref] = formatElementLabel(element);
  choices[NO_ELEMENT_CHOICE] = noneLabel;
  return choices;
}

/** Plain-text rendering for a model that reads the page as text rather than as options. */
export function formatElementTable(snapshot: PageElementSnapshot): string {
  const lines = snapshot.elements.map(
    (element) => `${element.ref}: ${formatElementLabel(element)}`,
  );
  return [`${snapshot.title} — ${snapshot.url}`, ...lines].join("\n");
}

function truncate(value: string, max: number): string {
  const collapsed = value
    .replace(/\s+/g, " ")
    .replace(/\p{Cc}/gu, "")
    .trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1)}…`;
}
