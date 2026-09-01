import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { ChatMarkdown } from "@rakazo/chat-ui/web";
import { Download, FileText, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  type ArtifactTarget,
  downloadArtifact,
  downloadArtifactBytes,
  fetchArtifactBytes,
} from "../lib/artifact-open";

type ArtifactFileCardProps = {
  target: ArtifactTarget;
  artifactId: string;
  name: string;
  mimeType: string;
  size: number;
};

type PreviewKind = "markdown" | "text" | "pdf" | "html";

function previewKindForMimeType(mimeType: string): PreviewKind | null {
  if (mimeType === "text/markdown") return "markdown";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "text/html") return "html";
  if (mimeType === "text/plain" || mimeType === "text/csv" || mimeType === "application/json") {
    return "text";
  }
  return null;
}

function isInlineMediaMimeType(mimeType: string): boolean {
  return mimeType.startsWith("video/") || mimeType.startsWith("audio/");
}

export function ArtifactFileCard(props: ArtifactFileCardProps) {
  if (isInlineMediaMimeType(props.mimeType)) {
    return <InlineMediaCard {...props} />;
  }
  if (props.mimeType === "text/html") {
    return <InlineHtmlCard {...props} />;
  }
  if (!previewKindForMimeType(props.mimeType)) {
    return <DownloadOnlyCard {...props} />;
  }
  return <PreviewableFileCard {...props} />;
}

/** HTML results render right in the transcript inside a scripts-only sandbox
    (no same-origin, so the page gets no cookies or app APIs). */
function InlineHtmlCard(props: ArtifactFileCardProps) {
  const { t } = useLingui();
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const targetBotId = "botId" in props.target ? props.target.botId : undefined;
  const targetGroupId = "groupId" in props.target ? props.target.groupId : undefined;

  useEffect(() => {
    const element = container.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "320px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void fetchArtifactBytes(
      targetBotId !== undefined ? { botId: targetBotId } : { groupId: targetGroupId! },
      props.artifactId,
    )
      .then((bytes) => {
        if (cancelled) return;
        try {
          setHtml(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        } catch {
          setFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [props.artifactId, targetBotId, targetGroupId, visible]);

  if (failed) return <PreviewableFileCard {...props} />;

  return (
    <div ref={container} className="w-full max-w-[560px]">
      <div className="overflow-hidden rounded-[20px] border border-[#343438] bg-[#1B1B1E]">
        {html ? (
          <iframe
            sandbox="allow-scripts"
            srcDoc={html}
            title={props.name}
            className="h-[300px] w-full border-0 bg-white"
          />
        ) : (
          <div className="grid h-[120px] place-items-center text-[13px] text-[#85858A]">
            <Trans>Loading preview…</Trans>
          </div>
        )}
        <div className="flex items-center gap-1 border-t border-[#343438] px-3 py-1.5 text-[13px] text-[#85858A]">
          <span className="min-w-0 flex-1 truncate">
            {props.name} · {formatBytes(props.size)}
          </span>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="shrink-0 rounded-md px-2 py-1 hover:bg-[#222226] hover:text-[#ECECEE]"
          >
            <Trans>Expand</Trans>
          </button>
          <button
            type="button"
            aria-label={t`Download ${props.name}`}
            title={t`Download ${props.name}`}
            onClick={() => void startDownload(props, setDownloadError)}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full hover:bg-[#222226] hover:text-[#ECECEE]"
          >
            <Download size={15} strokeWidth={1.8} />
          </button>
        </div>
      </div>
      {downloadError ? <DownloadError message={downloadError} /> : null}
      {expanded ? <FilePreviewModal {...props} onClose={() => setExpanded(false)} /> : null}
    </div>
  );
}

function DownloadOnlyCard(props: ArtifactFileCardProps) {
  const [downloadError, setDownloadError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        onClick={() => void startDownload(props, setDownloadError)}
        className="rounded-[20px] border border-[#26262A] bg-[#17171A] px-4 py-3 text-left text-[14px] text-[#DFDFE2] hover:bg-[#1F1F22]"
      >
        <div className="font-medium">{props.name}</div>
        <div className="mt-1 text-[#85858A]">{formatBytes(props.size)}</div>
      </button>
      {downloadError ? <DownloadError message={downloadError} /> : null}
    </div>
  );
}

async function startDownload(
  props: ArtifactFileCardProps,
  setError: (message: string | null) => void,
) {
  setError(null);
  try {
    await downloadArtifact(props.target, props.artifactId, props.name, props.mimeType);
  } catch {
    setError(t`Could not download ${props.name}. Try again.`);
  }
}

function InlineMediaCard(props: ArtifactFileCardProps) {
  const { t } = useLingui();
  const [src, setSrc] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const targetBotId = "botId" in props.target ? props.target.botId : undefined;
  const targetGroupId = "groupId" in props.target ? props.target.groupId : undefined;

  useEffect(() => {
    const element = container.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "320px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setSrc(null);
    void fetchArtifactBytes(
      targetBotId !== undefined ? { botId: targetBotId } : { groupId: targetGroupId! },
      props.artifactId,
    )
      .then((bytes) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(
          new Blob([new Uint8Array(bytes)], { type: props.mimeType }),
        );
        setSrc(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [props.artifactId, props.mimeType, targetBotId, targetGroupId, visible]);

  return (
    <div ref={container} className="max-w-[320px]">
      {src ? (
        props.mimeType.startsWith("video/") ? (
          // biome-ignore lint/a11y/useMediaCaption: arbitrary chat media ships without caption tracks
          <video
            controls
            preload="metadata"
            src={src}
            aria-label={props.name}
            className="max-h-64 w-full rounded-[20px] bg-black"
          />
        ) : (
          // biome-ignore lint/a11y/useMediaCaption: arbitrary chat media ships without caption tracks
          <audio controls preload="metadata" src={src} aria-label={props.name} className="w-full" />
        )
      ) : (
        <button
          type="button"
          onClick={() => void startDownload(props, setDownloadError)}
          className="rounded-[20px] border border-[#26262A] bg-[#17171A] px-4 py-3 text-left text-[14px] text-[#85858A] hover:bg-[#1F1F22]"
        >
          {props.name} · {formatBytes(props.size)}
        </button>
      )}
      <div className="mt-1 flex items-center gap-2 text-[13px] text-[#85858A]">
        <span className="truncate">{props.name}</span>
        <button
          type="button"
          aria-label={t`Download ${props.name}`}
          title={t`Download ${props.name}`}
          onClick={() => void startDownload(props, setDownloadError)}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full hover:bg-[#222226] hover:text-[#ECECEE]"
        >
          <Download size={15} strokeWidth={1.8} />
        </button>
      </div>
      {downloadError ? <DownloadError message={downloadError} /> : null}
    </div>
  );
}

function PreviewableFileCard(props: ArtifactFileCardProps) {
  const previewButton = useRef<HTMLButtonElement>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  function closePreview() {
    setPreviewOpen(false);
    window.requestAnimationFrame(() => previewButton.current?.focus());
  }

  return (
    <>
      <div>
        <div className="flex min-w-[280px] overflow-hidden rounded-[20px] border border-[#343438] bg-[#1B1B1E] text-left text-[#DFDFE2]">
          <button
            ref={previewButton}
            type="button"
            aria-label={t`Preview ${props.name}`}
            onClick={() => setPreviewOpen(true)}
            className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left hover:bg-[#222226]"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-[#24344A] text-[#68A7FF]">
              <FileText size={21} strokeWidth={1.8} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-medium">{props.name}</span>
              <span className="mt-0.5 block text-[13px] text-[#85858A]">
                {formatBytes(props.size)}
              </span>
            </span>
          </button>
          <button
            type="button"
            aria-label={t`Download ${props.name}`}
            title={t`Download ${props.name}`}
            onClick={() => void startDownload(props, setDownloadError)}
            className="grid w-14 shrink-0 place-items-center border-l border-[#343438] text-[#9A9AA0] hover:bg-[#222226] hover:text-[#ECECEE]"
          >
            <Download size={19} strokeWidth={1.8} />
          </button>
        </div>
        {downloadError ? <DownloadError message={downloadError} /> : null}
      </div>
      {previewOpen ? <FilePreviewModal {...props} onClose={closePreview} /> : null}
    </>
  );
}

function FilePreviewModal({
  target,
  artifactId,
  name,
  mimeType,
  onClose,
}: ArtifactFileCardProps & { onClose: () => void }) {
  const { t } = useLingui();
  const titleId = useId();
  const dialog = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ready"; bytes: Uint8Array; url: string | null }
    | { status: "error"; message: string }
  >({ status: "loading" });
  const targetBotId = "botId" in target ? target.botId : undefined;
  const targetGroupId = "groupId" in target ? target.groupId : undefined;

  useEffect(() => {
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    const artifactTarget: ArtifactTarget =
      targetBotId !== undefined ? { botId: targetBotId } : { groupId: targetGroupId! };
    void fetchArtifactBytes(artifactTarget, artifactId)
      .then((bytes) => {
        if (cancelled) return;
        if (previewKindForMimeType(mimeType) === "pdf") {
          objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mimeType }));
          setState({ status: "ready", bytes, url: objectUrl });
          return;
        }
        try {
          new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          setState({ status: "ready", bytes, url: null });
        } catch {
          setState({ status: "error", message: t`Could not load this file.` });
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: error instanceof Error ? error.message : t`Could not load this file.`,
        });
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [artifactId, mimeType, targetBotId, targetGroupId, t]);

  // Render through a portal so page-level overlays (computer side panel) can
  // never intercept clicks on the modal.
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-5 backdrop-blur-sm">
      <button
        type="button"
        tabIndex={-1}
        aria-label={t`Close preview`}
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <section
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex h-[min(88vh,900px)] w-[min(960px,94vw)] flex-col overflow-hidden rounded-[18px] border border-[#2B2B2F] bg-[#0D0D0F] shadow-2xl"
      >
        <header className="flex h-14 shrink-0 items-center border-b border-[#27272B] px-5">
          <h2
            id={titleId}
            className="min-w-0 flex-1 truncate text-[14px] font-medium text-[#E7E7E9]"
          >
            {name}
          </h2>
          <button
            type="button"
            aria-label={t`Download ${name}`}
            title={t`Download ${name}`}
            onClick={() =>
              void (async () => {
                setDownloadError(null);
                try {
                  if (state.status === "ready") {
                    downloadArtifactBytes(name, mimeType, state.bytes);
                  } else {
                    await downloadArtifact(target, artifactId, name, mimeType);
                  }
                } catch {
                  setDownloadError(t`Could not download ${name}. Try again.`);
                }
              })()
            }
            className="grid h-9 w-9 place-items-center rounded-full text-[#929298] hover:bg-[#1D1D20] hover:text-[#ECECEE]"
          >
            <Download size={18} strokeWidth={1.8} />
          </button>
          <button
            ref={closeButton}
            type="button"
            aria-label={t`Close preview`}
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full text-[#929298] hover:bg-[#1D1D20] hover:text-[#ECECEE]"
          >
            <X size={19} strokeWidth={1.8} />
          </button>
        </header>
        {downloadError ? (
          <div className="shrink-0 px-5 pt-4">
            <DownloadError message={downloadError} />
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {state.status === "loading" ? (
            <div className="px-8 py-10 text-[#85858A]">
              <Trans>Loading preview…</Trans>
            </div>
          ) : state.status === "error" ? (
            <div className="px-8 py-10">
              <div className="rounded-[14px] border border-[#5A2A2A] bg-[#2A1717] px-4 py-3 text-[#F1A8A8]">
                {state.message}
              </div>
            </div>
          ) : (
            <PreviewContent name={name} mimeType={mimeType} bytes={state.bytes} url={state.url} />
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}

function PreviewContent({
  name,
  mimeType,
  bytes,
  url,
}: {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
  url: string | null;
}) {
  const kind = previewKindForMimeType(mimeType);
  if (kind === "pdf") {
    if (!url) return null;
    return <iframe src={url} title={name} className="h-full min-h-[70vh] w-full border-0" />;
  }
  if (kind === "html") {
    return (
      <iframe
        sandbox="allow-scripts"
        srcDoc={new TextDecoder().decode(bytes)}
        title={name}
        className="h-full min-h-[70vh] w-full border-0 bg-white"
      />
    );
  }
  if (kind === "markdown") {
    return (
      <article className="mx-auto w-full max-w-[760px] px-8 py-10 text-[16px] leading-7 text-[#D5D5D8] sm:px-12 sm:py-12">
        <ChatMarkdown>{new TextDecoder().decode(bytes)}</ChatMarkdown>
      </article>
    );
  }
  return (
    <pre className="mx-auto w-full max-w-[960px] overflow-x-auto px-8 py-10 font-mono text-[13px] leading-6 whitespace-pre text-[#D5D5D8]">
      {new TextDecoder().decode(bytes)}
    </pre>
  );
}

function DownloadError({ message }: { message: string }) {
  return (
    <div role="alert" className="mt-2 text-left text-[13px] text-[#F1A8A8]">
      {message}
    </div>
  );
}

function formatBytes(size: number) {
  const locale = i18n.locale || "en";
  if (size < 1024) return t`${size} B`;
  const format = (value: number) =>
    new Intl.NumberFormat(locale, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(value);
  if (size < 1024 * 1024) return t`${format(size / 1024)} KB`;
  return t`${format(size / (1024 * 1024))} MB`;
}
