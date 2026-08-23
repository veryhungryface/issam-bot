import type { ComputerStatus, MessageBlock, RunStatus, SearchHitKind } from "@rakazo/contracts";

type SubagentStatus = Extract<MessageBlock, { kind: "subagent" }>["status"];
type KnownStatus = RunStatus | ComputerStatus["state"] | SubagentStatus | "idle";

const STATUS_LABELS = {
  idle: "",
  queued: "대기 중",
  leased: "준비 중",
  running: "실행 중",
  waiting_input: "응답 대기",
  waiting_takeover: "직접 제어 대기",
  completed: "완료",
  failed: "실패",
  cancelled: "취소됨",
  stopped: "종료",
  booting: "시작 중",
  suspended: "다음 작업 대기",
  error: "오류",
} satisfies Record<KnownStatus, string>;

const SEARCH_KIND_LABELS = {
  conversation: "대화",
  message: "메시지",
  file: "파일",
  link: "링크",
  routine: "자동 작업",
} satisfies Record<SearchHitKind, string>;

export function koreanStatusLabel(status: string | null | undefined): string {
  if (!status) return "상태 확인 중";
  return Object.hasOwn(STATUS_LABELS, status)
    ? STATUS_LABELS[status as KnownStatus]
    : "상태 확인 중";
}

export function koreanSearchKindLabel(kind: SearchHitKind): string {
  return SEARCH_KIND_LABELS[kind];
}
