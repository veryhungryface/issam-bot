type AskSnapshot = {
  messages: readonly {
    id: string;
    runId?: string | null;
    blocks: readonly { kind: string; status?: string }[];
  }[];
  run?: { id: string; status: string } | null;
  activeRuns?: readonly { id: string; status: string }[];
};

/**
 * A block the user can still act on. The sign-in sheet is not an `ask` block, and leaving it
 * out here disabled its own fields, checkbox and buttons: the card rendered, said "action
 * needed", and accepted nothing.
 */
function awaitsUser(block: { kind: string; status?: string }): boolean {
  if (block.kind === "ask") return block.status !== "answered";
  if (block.kind === "browser_login") {
    return block.status !== "filled" && block.status !== "cancelled";
  }
  return false;
}

export function latestAnswerableAskMessageId(snapshot: AskSnapshot | null): string | null {
  if (!snapshot) return null;
  const waitingRunIds = new Set(
    (snapshot.activeRuns ?? (snapshot.run ? [snapshot.run] : []))
      .filter((run) => run.status === "waiting_input")
      .map((run) => run.id),
  );
  for (let index = snapshot.messages.length - 1; index >= 0; index -= 1) {
    const message = snapshot.messages[index];
    if (!message?.runId || !waitingRunIds.has(message.runId)) continue;
    if (message.blocks.some(awaitsUser)) {
      return message.id;
    }
  }
  return null;
}

export function selectedAskActionLabel(
  answer: string,
  actions?: readonly { id: string; label: string }[],
): string {
  return resolveAskChoice(answer, actions)?.label ?? answer;
}

/**
 * Match an answer to one of the offered choices, by id or by the label the user was shown.
 * Someone who types "네" instead of tapping the "네" button means that choice; anything
 * else is a custom reply, which the caller passes through as free text.
 */
export function resolveAskChoice(
  answer: string,
  actions?: readonly { id: string; label: string }[],
): { id: string; label: string } | undefined {
  if (!actions?.length) return undefined;
  const trimmed = answer.trim();
  if (!trimmed) return undefined;
  const byId = actions.find((action) => action.id === trimmed);
  if (byId) return byId;
  const lower = trimmed.toLowerCase();
  return actions.find((action) => action.label.trim().toLowerCase() === lower);
}
