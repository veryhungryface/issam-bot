import type { MessageBlock } from "@rakazo/contracts";
import { t } from "./i18n";

export type BrowserLoginBlock = Extract<MessageBlock, { kind: "browser_login" }>;

/** The host alone: what the teacher recognises, and all they need to judge where this goes. */
export function browserLoginHost(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/**
 * What the sign-in sheet shows, decided away from the view so it can be tested.
 *
 * `canSubmit` is deliberately every-field-filled rather than any: a half-filled sheet submits
 * a username with an empty password, the page rejects it, and the run resumes believing it
 * signed in.
 */
export function browserLoginPresentation(
  block: BrowserLoginBlock,
  values: Record<string, string> = {},
) {
  const resolved = block.status === "filled" || block.status === "cancelled";
  return {
    host: browserLoginHost(block.origin),
    resolved,
    statusLabel: resolved
      ? block.status === "filled"
        ? t("Signed in")
        : t("Skipped")
      : t("Action needed"),
    canSubmit: block.fields.every((field) => (values[field.id] ?? "").length > 0),
  };
}
