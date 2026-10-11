import type { MessageBlock } from "@rakazo/contracts";
import { redactSecrets } from "@rakazo/core";

const MAX_APPROVAL_SUMMARY_LENGTH = 500;
const MAX_APPROVAL_DETAIL_LENGTH = 4_000;
/** A value the model chose is cut here, so the question keeps the verb it ends on. */
const MAX_APPROVAL_VALUE_LENGTH = 80;

/** The arguments worth showing under the question, in the order they are read. */
const DETAIL_LABELS: ReadonlyArray<readonly [string, string]> = [
  ["collection", "저장 위치"],
  ["title", "제목"],
  ["to", "받는 사람"],
  ["subject", "제목"],
  ["amount", "금액"],
  ["body", "내용"],
];

export function buildApprovalAskBlock(
  effectId: string,
  toolName: string,
  args: Record<string, unknown>,
  secrets: string[],
  options?: { reviewReason?: string },
): MessageBlock {
  const summary = describeApprovalAction(toolName, args);
  const detail = formatApprovalDetail(toolName, args, options?.reviewReason);
  const safeDetail = detail ? redactSecrets(detail, secrets) : undefined;
  return {
    kind: "ask",
    approvalEffectId: effectId,
    text: truncate(redactSecrets(summary, secrets), MAX_APPROVAL_SUMMARY_LENGTH),
    detail: safeDetail ? truncate(safeDetail, MAX_APPROVAL_DETAIL_LENGTH) : undefined,
    status: "pending",
    actions:
      toolName === "create_space"
        ? [
            { id: "allow", label: "Create space", outcome: "created" },
            { id: "deny", label: "Cancel", outcome: "cancelled" },
          ]
        : [
            { id: "allow", label: "Allow once" },
            { id: "always", label: "Always allow this tool" },
            { id: "deny", label: "Deny" },
          ],
  };
}

/**
 * The one line the card asks, written out per action rather than assembled from a prefix:
 * Korean puts the verb last, so "Review before X" has no shape to translate into. Every
 * sentence ends on fixed words, never on a value the model chose, because a particle picked
 * for someone's subject line or a collection name is a particle picked wrong.
 */
function describeApprovalAction(toolName: string, args: Record<string, unknown>): string {
  if (toolName === "destination.write") {
    const collection = args.collection ? value(args.collection) : "기록";
    const title = args.title ? ` “${value(args.title)}”` : "";
    return `${collection}에${title} 저장하기 전에 확인해 주세요`;
  }
  if (toolName === "delete_bot" || toolName === "archive_bot") {
    const verb = toolName === "delete_bot" ? "삭제" : "보관";
    const name = args.confirm_name ?? args.confirmName;
    return `${name ? `${value(name)} ` : "봇 "}${verb}하기 전에 확인해 주세요`;
  }
  if (toolName === "create_space") {
    return `“${args.name ? value(args.name) : "제목 없음"}” 스페이스를 만들까요?`;
  }
  const target = pickScopeLabel(args);
  return `${target ? `${toolName} → ${target}` : toolName} 실행 전에 확인해 주세요`;
}

function formatApprovalDetail(
  toolName: string,
  args: Record<string, unknown>,
  reviewReason?: string,
): string | undefined {
  const lines: string[] = [];
  if (reviewReason?.trim()) {
    lines.push(reviewReason.trim().replace(/\u2014|\u2013/g, "-"));
  }
  if (toolName === "create_space") {
    lines.push("이 스페이스의 봇, 그룹, 대화, 파일, 기억, 연동은 다른 스페이스와 분리됩니다.");
  }
  for (const [key, label] of DETAIL_LABELS) {
    const value = args[key];
    if (value == null || value === "") continue;
    lines.push(`${label}: ${String(value)}`);
  }
  if (lines.length === 0) return undefined;
  return lines.join("\n");
}

function pickScopeLabel(args: Record<string, unknown>): string | undefined {
  for (const key of ["to", "title", "collection", "subject", "amount"]) {
    const scope = args[key];
    if (scope != null && scope !== "") return value(scope);
  }
  return undefined;
}

function value(raw: unknown): string {
  return truncate(String(raw), MAX_APPROVAL_VALUE_LENGTH);
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}
