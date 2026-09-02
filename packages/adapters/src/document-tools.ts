export class DocumentToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentToolError";
  }
}
export const DOCUMENT_FORMATS = ["hwpx", "docx", "xlsx", "pptx"] as const;

export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];

export const DOCUMENT_FORMAT_EXTENSIONS: Record<DocumentFormat, string> = {
  hwpx: ".hwpx",
  docx: ".docx",
  xlsx: ".xlsx",
  pptx: ".pptx",
};

const FORMATS_BY_EXTENSION: Record<string, DocumentFormat> = Object.fromEntries(
  DOCUMENT_FORMATS.map((format) => [DOCUMENT_FORMAT_EXTENSIONS[format], format]),
);

/** Cap the markdown the model may hand to a generator so a runaway call cannot stall the worker. */
export const MAX_DOCUMENT_SOURCE_CHARS = 120_000;

/** Cap the markdown returned by read_document so a huge file cannot flood model context. */
export const MAX_PARSED_DOCUMENT_CHARS = 120_000;

/** Long documents are served this many pages per read_document call; the agent
 * answers from the returned window and asks the user before reading the next one. */
export const DOCUMENT_READ_PAGE_WINDOW = 30;

export type DocumentPageRange = { start: number; end: number };

/** Accepts "N" or "N-M" (1-based, inclusive) and clamps the span to the page window. */
export function normalizeDocumentPageRange(value: string): DocumentPageRange {
  const match = /^\s*(\d{1,5})\s*(?:-\s*(\d{1,5})\s*)?$/.exec(value);
  if (!match) {
    throw new DocumentToolError(`invalid page range: ${value} (use "31" or "31-60")`);
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : start + DOCUMENT_READ_PAGE_WINDOW - 1;
  if (start < 1 || end < start) {
    throw new DocumentToolError(`invalid page range: ${value} (use "31" or "31-60")`);
  }
  return { start, end: Math.min(end, start + DOCUMENT_READ_PAGE_WINDOW - 1) };
}

export const HWPX_PRESETS = [
  "개조식",
  "보고서",
  "계획서",
  "기안문",
  "보도자료",
  "통지",
  "회의록",
] as const;

export type HwpxPreset = (typeof HWPX_PRESETS)[number];

export function hwpxPreset(value: string | undefined): HwpxPreset | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  if ((HWPX_PRESETS as readonly string[]).includes(normalized)) {
    return normalized as HwpxPreset;
  }
  throw new DocumentToolError(
    `unknown hwpx preset: ${normalized} (use one of ${HWPX_PRESETS.join(", ")})`,
  );
}

export function isDocumentFormat(value: string): value is DocumentFormat {
  return (DOCUMENT_FORMATS as readonly string[]).includes(value);
}

export function documentFormatForPath(path: string): DocumentFormat | null {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return null;
  return FORMATS_BY_EXTENSION[path.slice(dot).toLowerCase()] ?? null;
}

export function sanitizeDocumentFileName(title: string, format: DocumentFormat): string {
  const cleaned = title
    .replace(/[/\\:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${cleaned || "document"}${DOCUMENT_FORMAT_EXTENSIONS[format]}`;
}

type MdRun = { text: string; bold: boolean; italic: boolean };

type MdBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; runs: MdRun[] }
  | { kind: "list"; ordered: boolean; items: MdRun[][] }
  | { kind: "table"; rows: string[][] };

function parseInlineRuns(text: string): MdRun[] {
  const runs: MdRun[] = [];
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|[^*_*]+)/g;
  for (const match of text.matchAll(pattern)) {
    const token = match[0];
    if (!token) continue;
    if (
      (token.startsWith("**") && token.endsWith("**")) ||
      (token.startsWith("__") && token.endsWith("__"))
    ) {
      const text = token.slice(2, -2);
      if (text) runs.push({ text, bold: true, italic: false });
    } else if (token.startsWith("*") && token.endsWith("*") && token.length > 2) {
      const text = token.slice(1, -1);
      if (text) runs.push({ text, bold: false, italic: true });
    } else {
      const text = token.replace(/`/g, "");
      if (text) runs.push({ text, bold: false, italic: false });
    }
  }
  return runs.length ? runs : [{ text: "", bold: false, italic: false }];
}

export function parseMarkdownBlocks(markdown: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: MdRun[][] } | null = null;
  let table: string[][] | null = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ kind: "paragraph", runs: parseInlineRuns(paragraph.join(" ")) });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push({ kind: "list", ...list });
      list = null;
    }
  };
  const flushTable = () => {
    if (table) {
      blocks.push({ kind: "table", rows: table });
      table = null;
    }
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushTable();
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const listItem = /^(?:[-*]|\d+[.)])\s+(.*)$/.exec(line.trim());
    const tableRow = /^\|.*\|$/.exec(line.trim());

    if (heading) {
      flushAll();
      blocks.push({
        kind: "heading",
        level: heading[1]?.length ?? 1,
        text: (heading[2] ?? "").trim(),
      });
      continue;
    }
    if (tableRow) {
      flushParagraph();
      flushList();
      const cells = line
        .trim()
        .slice(1, -1)
        .split("|")
        .map((cell) => cell.trim());
      // The |---|---| separator row is dropped.
      if (cells.every((cell) => /^:?-+:?$/.test(cell) || cell === "")) continue;
      table ??= [];
      table.push(cells);
      continue;
    }
    if (table) {
      flushTable();
    }
    if (listItem?.[1] !== undefined) {
      flushParagraph();
      const ordered = /^\d/.test(line.trim());
      list ??= { ordered, items: [] };
      list.items.push(parseInlineRuns(listItem[1].trim()));
      continue;
    }
    if (list) {
      flushList();
    }
    if (line.trim() === "") {
      flushParagraph();
      continue;
    }
    paragraph.push(line.trim());
  }
  flushAll();
  return blocks;
}

async function createHwpxBytes(
  markdown: string,
  opts: { title?: string; preset?: string },
): Promise<Uint8Array> {
  const kordoc = await import("kordoc");
  const preset = hwpxPreset(opts.preset);
  const result = await kordoc.markdownToHwpx(markdown, {
    ...(opts.title ? { title: opts.title } : {}),
    ...(preset ? { gongmun: { preset } } : {}),
  });
  return new Uint8Array(result);
}

async function createDocxBytes(markdown: string, opts: { title?: string }): Promise<Uint8Array> {
  const docx = await import("docx");
  const blocks = parseMarkdownBlocks(markdown);
  const headingLevels = [
    docx.HeadingLevel.HEADING_1,
    docx.HeadingLevel.HEADING_2,
    docx.HeadingLevel.HEADING_3,
    docx.HeadingLevel.HEADING_4,
    docx.HeadingLevel.HEADING_5,
    docx.HeadingLevel.HEADING_6,
  ];
  const toRuns = (runs: MdRun[]) =>
    runs.map(
      (run) =>
        new docx.TextRun({
          text: run.text,
          bold: run.bold,
          italics: run.italic,
        }),
    );
  const children: Array<InstanceType<typeof docx.Paragraph> | InstanceType<typeof docx.Table>> = [];
  for (const block of blocks) {
    if (block.kind === "heading") {
      children.push(
        new docx.Paragraph({
          text: block.text,
          heading: headingLevels[Math.min(block.level, 6) - 1] ?? docx.HeadingLevel.HEADING_1,
        }),
      );
      continue;
    }
    if (block.kind === "paragraph") {
      children.push(new docx.Paragraph({ children: toRuns(block.runs) }));
      continue;
    }
    if (block.kind === "list") {
      for (const [index, item] of block.items.entries()) {
        children.push(
          block.ordered
            ? new docx.Paragraph({
                children: [new docx.TextRun({ text: `${index + 1}. ` }), ...toRuns(item)],
              })
            : new docx.Paragraph({ children: toRuns(item), bullet: { level: 0 } }),
        );
      }
      continue;
    }
    const rows = block.rows;
    if (!rows.length) continue;
    children.push(
      new docx.Table({
        width: { size: 100, type: docx.WidthType.PERCENTAGE },
        rows: rows.map(
          (cells) =>
            new docx.TableRow({
              children: cells.map(
                (cell) => new docx.TableCell({ children: [new docx.Paragraph({ text: cell })] }),
              ),
            }),
        ),
      }),
    );
  }
  const document = new docx.Document({
    creator: "Issam Bot",
    title: opts.title || undefined,
    sections: [{ children }],
  });
  const buffer = await docx.Packer.toBuffer(document);
  return new Uint8Array(buffer);
}

async function createXlsxBytes(markdown: string): Promise<Uint8Array> {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Issam Bot";
  const blocks = parseMarkdownBlocks(markdown);
  const tables = blocks.filter(
    (block): block is Extract<MdBlock, { kind: "table" }> => block.kind === "table",
  );
  if (tables.length > 0) {
    let heading = "";
    let tableIndex = 0;
    for (const block of blocks) {
      if (block.kind === "heading") heading = block.text;
      if (block.kind !== "table") continue;
      tableIndex += 1;
      const sheet = workbook.addWorksheet(
        (heading || `Table ${tableIndex}`).slice(0, 31).replace(/[/\\?*[\]:]/g, " "),
      );
      for (const [rowIndex, cells] of block.rows.entries()) {
        const row = sheet.addRow(cells);
        if (rowIndex === 0) {
          row.eachCell((cell) => {
            cell.font = { bold: true };
          });
        }
      }
    }
  } else {
    const sheet = workbook.addWorksheet("Content");
    for (const block of blocks) {
      if (block.kind === "heading") sheet.addRow([block.text]);
      if (block.kind === "paragraph") sheet.addRow([block.runs.map((run) => run.text).join("")]);
      if (block.kind === "list") {
        for (const item of block.items) sheet.addRow([item.map((run) => run.text).join("")]);
      }
    }
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

async function createPptxBytes(markdown: string, opts: { title?: string }): Promise<Uint8Array> {
  const pptxModule = await import("pptxgenjs");
  type PptxSlide = {
    addText(
      text: string,
      options: { x: number; y: number; w?: string; h?: string; fontSize?: number; bold?: boolean },
    ): unknown;
  };
  type PptxInstance = {
    author: string;
    title?: string;
    addSlide(): PptxSlide;
    write(options: { outputType: "nodebuffer" }): Promise<Buffer>;
  };
  const PptxCtor = pptxModule.default as unknown as new () => PptxInstance;
  const presentation = new PptxCtor();
  presentation.author = "Issam Bot";
  if (opts.title) presentation.title = opts.title;
  const blocks = parseMarkdownBlocks(markdown);
  type SlideContent = { title: string; bullets: string[] };
  const slides: SlideContent[] = [];
  let current: SlideContent | null = null;
  let sawHeading = false;
  const pushContent = (text: string) => {
    if (!current) current = { title: opts.title || "Slides", bullets: [] };
    current.bullets.push(text);
  };
  for (const block of blocks) {
    if (block.kind === "heading" && block.level === 1) {
      if (current) slides.push(current);
      current = { title: block.text, bullets: [] };
      sawHeading = true;
      continue;
    }
    if (block.kind === "heading") {
      pushContent(block.text);
      continue;
    }
    if (block.kind === "paragraph") {
      pushContent(block.runs.map((run) => run.text).join(""));
      continue;
    }
    if (block.kind === "list") {
      for (const item of block.items) {
        pushContent(`• ${item.map((run) => run.text).join("")}`);
      }
      continue;
    }
    if (block.kind === "table") {
      for (const cells of block.rows) pushContent(`• ${cells.join(" · ")}`);
    }
  }
  if (current) slides.push(current);
  if (!sawHeading && slides.length > 0) {
    const first = slides[0];
    if (first) first.title = opts.title || first.title || "Slides";
  }
  if (slides.length === 0) {
    slides.push({ title: opts.title || "Slides", bullets: [] });
  }
  for (const slide of slides) {
    const added = presentation.addSlide();
    added.addText(slide.title, { x: 0.6, y: 0.5, w: "90%", fontSize: 24, bold: true });
    if (slide.bullets.length > 0) {
      added.addText(slide.bullets.join("\n"), {
        x: 0.6,
        y: 1.4,
        w: "90%",
        h: "70%",
        fontSize: 16,
      });
    }
  }
  const buffer = (await presentation.write({ outputType: "nodebuffer" })) as Buffer;
  return new Uint8Array(buffer);
}

export async function createDocumentBytes(
  format: DocumentFormat,
  markdown: string,
  opts: { title?: string; preset?: string } = {},
): Promise<Uint8Array> {
  if (markdown.trim().length === 0) {
    throw new DocumentToolError("document content is empty");
  }
  if (markdown.length > MAX_DOCUMENT_SOURCE_CHARS) {
    throw new DocumentToolError(`document content exceeds ${MAX_DOCUMENT_SOURCE_CHARS} characters`);
  }
  switch (format) {
    case "hwpx":
      return createHwpxBytes(markdown, opts);
    case "docx":
      return createDocxBytes(markdown, opts);
    case "xlsx":
      return createXlsxBytes(markdown);
    case "pptx":
      return createPptxBytes(markdown, opts);
  }
}

export type ParsedDocument = {
  fileType: string;
  markdown: string;
  warnings: string[];
  truncated: boolean;
  /** Total pages/sections in the whole document, regardless of the range read. */
  pageCount?: number;
  /** "layout" = real typeset pages; "section" = section-based approximation. */
  pageMode?: "layout" | "section";
};

const PARSE_TIMEOUT_MS = 90_000;

/**
 * kordoc.parse on hostile real-world files (scanned PDFs, big tables) can
 * allocate far beyond the worker's container budget — one such parse OOMs the
 * whole worker and crash-loops every retry. Run it in a disposable child
 * process with its own heap cap and a hard timeout: if it dies, the worker
 * survives and the run fails gracefully.
 */
async function parseDocumentInChildProcess(
  bytes: Uint8Array,
  pages?: DocumentPageRange,
): Promise<{
  success: boolean;
  fileType?: string;
  markdown?: string;
  warnings?: string[];
  pageCount?: number;
  pageMode?: "layout" | "section";
  error?: string;
}> {
  const { spawn } = await import("node:child_process");
  const child = spawn(
    process.execPath,
    [
      "--max-old-space-size=192",
      "-e",
      `
      let input = [];
      process.stdin.on("data", (chunk) => input.push(chunk));
      process.stdin.on("end", async () => {
        try {
          const kordoc = require("kordoc");
          const pages = process.env.KORDOC_PAGES || undefined;
          const result = await kordoc.parse(Buffer.concat(input), { ocr: false, ...(pages ? { pages } : {}) });
          process.stdout.write(JSON.stringify({
            ok: true,
            fileType: result?.fileType,
            markdown: result?.markdown,
            warnings: result?.warnings,
            pageCount: result?.pageCount ?? result?.metadata?.pageCount,
            pageMode: result?.metadata?.pageMode,
          }));
        } catch (error) {
          process.stdout.write(JSON.stringify({ ok: false, error: String(error?.message ?? error) }));
        }
        process.exit(0);
      });
    `,
    ],
    {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        ...(pages ? { KORDOC_PAGES: `${pages.start}-${pages.end}` } : {}),
      },
    },
  );

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      settle(() => reject(new DocumentToolError("document parsing timed out")));
    }, PARSE_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", (error) =>
      settle(() =>
        reject(new DocumentToolError(`document parser failed to start: ${error.message}`)),
      ),
    );
    child.on("close", (code) => {
      settle(() => {
        const output = Buffer.concat(chunks).toString("utf8");
        let parsed: {
          ok?: boolean;
          error?: string;
          fileType?: string;
          markdown?: string;
          warnings?: string[];
          pageCount?: number;
          pageMode?: "layout" | "section";
        };
        try {
          parsed = JSON.parse(output);
        } catch {
          throw new DocumentToolError(
            `document parser exited unexpectedly (code ${code}) — the file may be too complex to parse`,
          );
        }
        if (!parsed.ok) {
          throw new DocumentToolError(
            `could not parse document: ${parsed.error ?? "unknown error"}`,
          );
        }
        resolve({
          success: true,
          fileType: parsed.fileType,
          markdown: parsed.markdown,
          warnings: parsed.warnings,
          pageCount: parsed.pageCount,
          pageMode: parsed.pageMode,
        });
      });
    });
    child.stdin.write(Buffer.from(bytes));
    child.stdin.end();
  });
}

export async function parseDocumentMarkdown(
  bytes: Uint8Array,
  opts: { pages?: DocumentPageRange } = {},
): Promise<ParsedDocument> {
  const result = await parseDocumentInChildProcess(bytes, opts.pages);
  if (!result.success) {
    throw new DocumentToolError(`could not parse document: ${result.error ?? "unknown error"}`);
  }
  const markdown = String(result.markdown ?? "");
  const truncated = markdown.length > MAX_PARSED_DOCUMENT_CHARS;
  return {
    fileType: String(result.fileType ?? ""),
    markdown: truncated ? markdown.slice(0, MAX_PARSED_DOCUMENT_CHARS) : markdown,
    warnings: Array.isArray(result.warnings)
      ? result.warnings.map((warning) => {
          if (warning && typeof warning === "object") {
            const { code, message } = warning as { code?: string; message?: string };
            return [code, message].filter(Boolean).join(": ") || JSON.stringify(warning);
          }
          return String(warning);
        })
      : [],
    truncated,
    ...(typeof result.pageCount === "number" ? { pageCount: result.pageCount } : {}),
    ...(result.pageMode ? { pageMode: result.pageMode } : {}),
  };
}
