/**
 * Models have no clock. Without an explicit anchor they infer "now" from training data
 * or from timestamps that happen to appear in the conversation, and then reason about
 * deadlines, recency and scheduling from a stale date. Every run states the real present
 * moment in its system instructions so that never has to be guessed.
 *
 * UTC is always stated because it is unambiguous. This deployment serves one country, so
 * DEPLOYMENT_TIME_ZONE adds the local reading the user actually thinks in — a Korean
 * teacher asking about "오늘" means the Seoul date, which is a day ahead of UTC all evening.
 */
export function formatCurrentTimeInstruction(
  now: Date = new Date(),
  timeZone: string | undefined = process.env.DEPLOYMENT_TIME_ZONE?.trim() || undefined,
): string {
  const iso = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(
    now,
  );
  return [
    `Current date and time: ${weekday}, ${iso} (UTC).`,
    formatLocalTime(now, timeZone),
    "Treat this as the present moment for everything you say and do.",
    "Use it to judge what is past, upcoming, or overdue, convert it to the user's time zone when one is known, and write absolute dates rather than relative ones.",
    "Never infer today's date from your training data or from timestamps quoted in the conversation.",
  ]
    .filter(Boolean)
    .join(" ");
}

function formatLocalTime(now: Date, timeZone: string | undefined): string | undefined {
  if (!timeZone) return undefined;
  try {
    const local = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      weekday: "long",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(now);
    return `In the user's time zone (${timeZone}) that is ${local}; answer in those local terms.`;
  } catch {
    // A misconfigured zone must not take down every run.
    return undefined;
  }
}
