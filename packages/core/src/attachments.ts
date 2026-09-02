import {
  ATTACHMENT_MAX_BASE64_LENGTH,
  ATTACHMENT_MAX_BYTES,
  type AttachmentMimeType,
  isAllowedAttachmentMimeType,
  isAttachmentImageMimeType,
  type MessageBlock,
} from "@rakazo/contracts";

export class AttachmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentValidationError";
  }
}

/** V8's regex engine overflows its backtrack stack on multi-megabyte inputs, so
 * validate the body in bounded chunks and only the 4-char tail with padding rules. */
const BASE64_VALIDATION_CHUNK = 1 << 20;

function isValidBase64(value: string): boolean {
  if (value.length % 4 !== 0) return false;
  const bodyEnd = Math.max(0, value.length - 4);
  for (let start = 0; start < bodyEnd; start += BASE64_VALIDATION_CHUNK) {
    const chunk = value.slice(start, Math.min(start + BASE64_VALIDATION_CHUNK, bodyEnd));
    if (!/^[A-Za-z0-9+/]*$/.test(chunk)) return false;
  }
  const tail = value.slice(bodyEnd);
  return /^(?:[A-Za-z0-9+/]{4}|[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(tail);
}

export function decodeAttachmentBase64(contentBase64: string): Uint8Array {
  const normalized = contentBase64.trim();
  if (!normalized) throw new AttachmentValidationError("Attachment content is empty");
  if (normalized.length > ATTACHMENT_MAX_BASE64_LENGTH) {
    throw new AttachmentValidationError("Attachment exceeds the 10 MiB limit");
  }
  if (!isValidBase64(normalized)) {
    throw new AttachmentValidationError("Attachment content is not valid base64");
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(normalized, "base64");
  } catch {
    throw new AttachmentValidationError("Attachment content is not valid base64");
  }
  if (bytes.byteLength === 0) throw new AttachmentValidationError("Attachment content is empty");
  if (bytes.byteLength > ATTACHMENT_MAX_BYTES) {
    throw new AttachmentValidationError("Attachment exceeds the 10 MiB limit");
  }
  return new Uint8Array(bytes);
}

export function validateAttachmentMimeType(mimeType: string): void {
  if (!isAllowedAttachmentMimeType(mimeType)) {
    throw new AttachmentValidationError(`Unsupported attachment type: ${mimeType}`);
  }
}

export function attachmentKindForMimeType(mimeType: string): "image" | "file" {
  return isAttachmentImageMimeType(mimeType) ? "image" : "file";
}

export function messageBlockForArtifact(artifact: {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}): Extract<MessageBlock, { kind: "image" | "file" }> {
  if (attachmentKindForMimeType(artifact.mimeType) === "image") {
    return {
      kind: "image",
      artifactId: artifact.id,
      mimeType: artifact.mimeType,
      name: artifact.name,
    };
  }
  return {
    kind: "file",
    artifactId: artifact.id,
    mimeType: artifact.mimeType,
    name: artifact.name,
    size: artifact.size,
  };
}

export function promptTextForAttachments(
  text: string | undefined,
  artifacts: Array<{ name: string; mimeType: string; size: number }>,
): string {
  const caption = text?.trim() ?? "";
  const notes = artifacts
    .filter((artifact) => !isAttachmentImageMimeType(artifact.mimeType))
    .map(
      (artifact) =>
        `User attached file ${JSON.stringify(artifact.name)} (${artifact.mimeType}, ${artifact.size} bytes).`,
    );
  return [caption, ...notes].filter(Boolean).join("\n\n") || "See attached files.";
}

export function blocksToAgentHistoryText(blocks: MessageBlock[]): string {
  return blocks
    .map((block) => {
      if (block.kind === "text") return block.text;
      if (block.kind === "chart") return `[chart: ${block.name}]`;
      if (block.kind === "image") return `[image: ${block.name}]`;
      if (block.kind === "file") {
        return `[file: ${block.name} (${block.mimeType}, ${block.size} bytes)]`;
      }
      // Keep attribution on peer messages: without it a later turn cannot tell
      // which lines came from another bot rather than the user.
      if (block.kind === "bot_message_received") return `[from ${block.fromBotName}] ${block.text}`;
      if (block.kind === "bot_message_sent") return `[to ${block.toBotName}] ${block.text}`;
      if ("text" in block && typeof block.text === "string") return block.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

const EXTENSION_MIME_TYPES: Record<string, AttachmentMimeType> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".mpeg": "audio/mpeg",
  ".wav": "audio/wav",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".csv": "text/csv",
  ".html": "text/html",
  ".htm": "text/html",
  ".json": "application/json",
  ".hwp": "application/haansofthwp",
  ".hwpx": "application/haansofthwp+zip",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const MIME_TYPE_EXTENSIONS: Record<AttachmentMimeType, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "application/pdf": ".pdf",
  "text/plain": ".txt",
  "text/markdown": ".md",
  "text/csv": ".csv",
  "text/html": ".html",
  "application/json": ".json",
  "application/haansofthwp": ".hwp",
  "application/haansofthwp+zip": ".hwpx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
};

export function inferAttachmentMimeType(
  name: string,
  reportedType?: string,
): AttachmentMimeType | null {
  const dot = name.lastIndexOf(".");
  const extensionType = dot < 0 ? undefined : EXTENSION_MIME_TYPES[name.slice(dot).toLowerCase()];
  // Some browsers and native document pickers report Markdown as text/plain.
  if (extensionType === "text/markdown" && (!reportedType || reportedType === "text/plain")) {
    return extensionType;
  }
  if (reportedType && isAllowedAttachmentMimeType(reportedType)) return reportedType;
  return extensionType ?? null;
}

export function attachmentExtensionForMimeType(mimeType: string): string {
  return isAllowedAttachmentMimeType(mimeType) ? MIME_TYPE_EXTENSIONS[mimeType] : "";
}

export function attachmentsForThread<T extends { threadKey: string }>(
  attachments: readonly T[],
  threadKey: string | undefined,
): T[] {
  if (!threadKey) return [];
  return attachments.filter((attachment) => attachment.threadKey === threadKey);
}

export function attachmentsForBot<T extends { botId: string }>(
  attachments: readonly T[],
  botId: string | undefined,
): T[] {
  if (!botId) return [];
  return attachments.filter((attachment) => attachment.botId === botId);
}

export function userTurnBlocksForRun(
  trigger: string,
  runId: string,
  messages: Array<{
    id?: string;
    role: string;
    runId?: string | null;
    blocks: MessageBlock[];
  }>,
  sourceMessageId?: string | null,
): MessageBlock[] | undefined {
  if (trigger !== "user") return undefined;
  return messages.find(
    (message) =>
      message.role === "user" &&
      (sourceMessageId ? message.id === sourceMessageId : message.runId === runId),
  )?.blocks;
}
