import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import "./markdown.web.css";
import {
  type ChatMarkdownProps,
  closeUnterminatedFence,
  hasMath,
  normalizeTexDelimiters,
  sanitizeMarkdownUrl,
} from "./markdown";

/**
 * KaTeX, fetched only by the messages that need it.
 *
 * The typesetter and its fonts are about a third of a megabyte, and most messages in this
 * product are prose. Teachers read them on phones on school networks, so it is not loaded
 * with the app — the first message containing math fetches it, every later one reuses it,
 * and one shared promise means ten formulas on screen cause one download.
 *
 * Until it lands, and if it never lands, the formula renders as the text the model wrote.
 * That is the right failure: `$x^2$` on screen is readable and obviously unfinished, where
 * an empty space or an error box is neither.
 */
type MathPlugins = { remark: Options["remarkPlugins"]; rehype: Options["rehypePlugins"] };

let mathRequest: Promise<MathPlugins> | undefined;
let loadedMath: MathPlugins | undefined;

function loadMath(): Promise<MathPlugins> {
  if (!mathRequest) {
    mathRequest = Promise.all([
      import("remark-math"),
      import("rehype-katex"),
      import("katex/dist/katex.min.css"),
    ]).then(([remarkMath, rehypeKatex]) => {
      loadedMath = {
        remark: [remarkMath.default],
        rehype: [
          [
            rehypeKatex.default,
            {
              // A formula that does not parse shows as the source text in the error colour
              // rather than taking the whole message down with it.
              throwOnError: false,
              strict: false,
              // `trust` stays off. With it on, KaTeX honours \href, \url and
              // \includegraphics, and the text in these messages can come from a web page
              // the bot was reading — that is somebody else's link in a teacher's chat.
              trust: false,
              // Caps \rule and friends, so a formula cannot paint itself over the page.
              maxSize: 50,
            },
          ],
        ],
      };
      return loadedMath;
    });
    mathRequest.catch(() => {
      // Let a later message try again rather than remembering the failure forever.
      mathRequest = undefined;
    });
  }
  return mathRequest;
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="9"
        y="9"
        width="12"
        height="12"
        rx="2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 12.5 9.5 18 20 6"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CodeBlock(props: React.ComponentPropsWithoutRef<"pre">) {
  const preRef = useRef<HTMLPreElement>(null);
  const resetTimerRef = useRef<number | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (!navigator.clipboard) return;
    const text = preRef.current?.textContent ?? "";
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        window.clearTimeout(resetTimerRef.current);
        resetTimerRef.current = window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="rk-chat-markdown-pre-wrap">
      <pre {...props} ref={preRef} />
      <button
        type="button"
        className="rk-chat-markdown-copy"
        onClick={handleCopy}
        aria-label={copied ? "Copied" : "Copy code"}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
    </div>
  );
}

const components: Components = {
  a({ node: _node, children, href, ...props }) {
    // Links the agent invents to local workspace paths (e.g. documents/x.hwpx)
    // can never resolve in the chat — render them as plain text instead of a
    // dead anchor.
    if (!href || !/^(https?:|mailto:)/i.test(href)) {
      return <span>{children}</span>;
    }
    return (
      <a {...props} href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    );
  },
  img({ node: _node, ...props }) {
    return <img {...props} alt={props.alt ?? ""} loading="lazy" />;
  },
  pre({ node: _node, ...props }) {
    return <CodeBlock {...props} />;
  },
};

export const ChatMarkdown = memo(function ChatMarkdown({
  children,
  streaming = false,
}: ChatMarkdownProps) {
  const source = useMemo(
    () => normalizeTexDelimiters(streaming ? closeUnterminatedFence(children) : children),
    [children, streaming],
  );
  // While a reply is still arriving the formula is often half-written, and an unclosed `$`
  // is not math to any parser — it stays text until the closing one lands, then typesets.
  const needsMath = useMemo(() => hasMath(source), [source]);
  const [math, setMath] = useState<MathPlugins | undefined>(loadedMath);

  useEffect(() => {
    if (!needsMath || math) return;
    let active = true;
    void loadMath()
      .then((plugins) => {
        if (active) setMath(plugins);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [needsMath, math]);

  const remarkPlugins = useMemo(
    () => (needsMath && math ? [remarkGfm, ...(math.remark ?? [])] : [remarkGfm]),
    [needsMath, math],
  );

  return (
    <div className={streaming ? "rk-chat-markdown rk-chat-markdown-streaming" : "rk-chat-markdown"}>
      <ReactMarkdown
        components={components}
        remarkPlugins={remarkPlugins}
        rehypePlugins={needsMath && math ? math.rehype : undefined}
        skipHtml
        urlTransform={(url) => sanitizeMarkdownUrl(url, true) ?? ""}
      >
        {source}
      </ReactMarkdown>
      {streaming ? <span aria-hidden="true" className="rk-chat-markdown-cursor" /> : null}
    </div>
  );
});

export type { ChatMarkdownProps } from "./markdown";
