export type ChatMarkdownProps = {
  children: string;
  streaming?: boolean;
};

const protocolPattern = /^([a-z][a-z\d+.-]*):/i;
const safeProtocols = new Set(["http", "https", "mailto", "tel"]);

export function sanitizeMarkdownUrl(url: string, allowRelative = false): string | undefined {
  const value = url.trim();
  const protocol = value.match(protocolPattern)?.[1]?.toLowerCase();

  if (protocol) return safeProtocols.has(protocol) ? value : undefined;
  if (
    allowRelative &&
    (value.startsWith("/") ||
      value.startsWith("./") ||
      value.startsWith("../") ||
      value.startsWith("#"))
  ) {
    return value;
  }
  return undefined;
}

export function closeUnterminatedFence(markdown: string): string {
  let openFence: { marker: "`" | "~"; length: number } | undefined;

  for (const line of markdown.split("\n")) {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!match?.[1]) continue;

    const marker = match[1][0] as "`" | "~";
    if (!openFence) {
      openFence = { marker, length: match[1].length };
      continue;
    }

    if (
      marker === openFence.marker &&
      match[1].length >= openFence.length &&
      (match[2] ?? "").trim() === ""
    ) {
      openFence = undefined;
    }
  }

  return openFence ? `${markdown}\n${openFence.marker.repeat(openFence.length)}` : markdown;
}

/**
 * Math, and the two notations it arrives in.
 *
 * `remark-math` reads TeX between dollar signs — `$x^2$` inline, `$$…$$` on its own line.
 * The models write the other notation at least as often: `\(x^2\)` and `\[…\]`, which LaTeX
 * itself prefers and which OpenAI's models emit by habit. Rather than ask every teacher to
 * care which one came back, the source is normalized to dollars before parsing.
 *
 * The rewrite has to stay out of code. A shell snippet is full of `$`, a LaTeX tutorial is
 * the one document that must show `\(` as text, and rewriting inside a fence would corrupt
 * both. So this walks the source rather than running a regex over it, and it skips fenced
 * blocks and inline code spans.
 */

/**
 * Displayed maths needs its fences on their own lines.
 *
 * `remark-math` only builds a display equation when `$$` stands alone on a line; written as
 * `$$E = mc^2$$` on one line it is parsed as *inline* maths and typeset small, mid-sentence.
 * The models write it both ways, and `\[…\]` — which always means display — is usually
 * written on one line too. So a pair that has a line to itself is given the block form.
 */
function standsAlone(source: string, open: number, afterClose: number): boolean {
  const lineStart = source.lastIndexOf("\n", open - 1) + 1;
  if (source.slice(lineStart, open).trim() !== "") return false;
  const lineEnd = source.indexOf("\n", afterClose);
  return source.slice(afterClose, lineEnd < 0 ? undefined : lineEnd).trim() === "";
}

/** `$$\n…\n$$`, with the blank lines that would end the block trimmed off the body. */
function displayBlock(inner: string): string {
  const body = inner.replace(/^[ \t]*\n+/, "").replace(/\n+[ \t]*$/, "");
  return `$$\n${body}\n$$`;
}

/** A delimiter pair may not span a blank line — a stray `\(` must not eat the document. */
function closerIndex(source: string, closer: string, from: number): number {
  const found = source.indexOf(closer, from);
  if (found < 0) return -1;
  return source.slice(from, found).includes("\n\n") ? -1 : found;
}

const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})(.*)$/;

export function normalizeTexDelimiters(markdown: string): string {
  // The common case has none of them in it, and walking the string would be waste.
  if (!markdown.includes("\\(") && !markdown.includes("\\[") && !markdown.includes("$$")) {
    return markdown;
  }

  let out = "";
  let i = 0;
  let fence: { marker: "`" | "~"; length: number } | undefined;
  let atLineStart = true;

  while (i < markdown.length) {
    if (atLineStart) {
      const lineEnd = markdown.indexOf("\n", i);
      const line = markdown.slice(i, lineEnd < 0 ? undefined : lineEnd);
      const match = line.match(FENCE_PATTERN);
      if (match?.[1]) {
        const marker = match[1][0] as "`" | "~";
        if (!fence) {
          fence = { marker, length: match[1].length };
        } else if (
          marker === fence.marker &&
          match[1].length >= fence.length &&
          (match[2] ?? "").trim() === ""
        ) {
          fence = undefined;
        }
        // A fence line is never math, whichever side of the block it opens or shuts.
        out += line;
        if (lineEnd < 0) break;
        out += "\n";
        i = lineEnd + 1;
        continue;
      }
      if (fence) {
        out += line;
        if (lineEnd < 0) break;
        out += "\n";
        i = lineEnd + 1;
        continue;
      }
      const lone = line.match(/^\s*\$\$([^$]+)\$\$\s*$/);
      if (lone?.[1]) {
        out += displayBlock(lone[1]);
        if (lineEnd < 0) break;
        out += "\n";
        i = lineEnd + 1;
        continue;
      }
    }

    const char = markdown[i] as string;
    atLineStart = char === "\n";

    // An inline code span is copied whole: whatever notation is inside it is text.
    if (char === "`") {
      let run = 0;
      while (markdown[i + run] === "`") run += 1;
      const ticks = "`".repeat(run);
      const close = markdown.indexOf(ticks, i + run);
      if (close < 0) {
        out += ticks;
        i += run;
        continue;
      }
      out += markdown.slice(i, close + run);
      i = close + run;
      atLineStart = false;
      continue;
    }

    if (char === "\\") {
      const next = markdown[i + 1];
      if (next === "(") {
        const close = closerIndex(markdown, "\\)", i + 2);
        if (close >= 0) {
          out += `$${markdown.slice(i + 2, close)}$`;
          i = close + 2;
          atLineStart = false;
          continue;
        }
      } else if (next === "[") {
        const close = closerIndex(markdown, "\\]", i + 2);
        if (close >= 0) {
          const inner = markdown.slice(i + 2, close);
          out += standsAlone(markdown, i, close + 2) ? displayBlock(inner) : `$$${inner}$$`;
          i = close + 2;
          atLineStart = false;
          continue;
        }
      }
      // Any other escape, including `\\`, is copied with the character it protects, so a
      // literal backslash before a paren is never mistaken for an opener.
      out += markdown.slice(i, i + 2);
      i += 2;
      atLineStart = false;
      continue;
    }

    out += char;
    i += 1;
  }

  return out;
}

/**
 * Is there anything here for KaTeX to typeset?
 *
 * KaTeX and its fonts are a quarter of a megabyte, and most messages have no math in them,
 * so the renderer fetches it only when this says to. The test runs on already-normalized
 * source, so it only has to know about dollars. It errs toward yes: a false yes costs one
 * needless fetch, a false no silently leaves `$x^2$` sitting on screen as text.
 */
const MATH_PATTERN = /\$\$[^$]*\$\$|\$[^$\n]+\$/;

export function hasMath(markdown: string): boolean {
  return MATH_PATTERN.test(markdown);
}
