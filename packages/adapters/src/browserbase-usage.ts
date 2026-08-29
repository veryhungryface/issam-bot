import type { SandboxProvider } from "@rakazo/adapter-kit";
import type { PrismaClient } from "@rakazo/db";
import type { BrowserbaseSessionSummary } from "./browserbase-client.js";

interface SessionUsageSource {
  listSessionUsage(): Promise<BrowserbaseSessionSummary[]>;
}

function hasSessionUsage(
  sandbox: SandboxProvider,
): sandbox is SandboxProvider & SessionUsageSource {
  return typeof (sandbox as Partial<SessionUsageSource>).listSessionUsage === "function";
}

export interface BrowserSessionUsageRow {
  workspaceId: string;
  userId: string | null;
  botId: string | null;
  sessionId: string;
  region: string | null;
  status: string | null;
  startedAt: Date;
  endedAt: Date | null;
  seconds: number;
}

/** Map one provider session into an upsertable usage row; null when unusable. */
export function toBrowserSessionUsageRow(
  session: BrowserbaseSessionSummary,
  now = new Date(),
): BrowserSessionUsageRow | null {
  const meta = session.userMetadata ?? {};
  const workspaceId = typeof meta.workspaceId === "string" ? meta.workspaceId : null;
  if (!session.id || !workspaceId) return null;
  const startedRaw = session.startedAt ?? session.createdAt;
  if (!startedRaw) return null;
  const startedAt = new Date(startedRaw);
  if (Number.isNaN(startedAt.getTime())) return null;
  const endedAt = session.endedAt ? new Date(session.endedAt) : null;
  const effectiveEnd = endedAt && !Number.isNaN(endedAt.getTime()) ? endedAt : null;
  const seconds = Math.max(
    0,
    Math.round(((effectiveEnd ?? now).getTime() - startedAt.getTime()) / 1000),
  );
  return {
    workspaceId,
    userId: typeof meta.userId === "string" && meta.userId ? meta.userId : null,
    botId: typeof meta.botId === "string" && meta.botId ? meta.botId : null,
    sessionId: session.id,
    region: session.region ?? null,
    status: session.status ?? null,
    startedAt,
    endedAt: effectiveEnd,
    seconds,
  };
}

/**
 * Pull recent provider sessions and upsert their billable time. Best-effort:
 * a provider outage must never break the usage screen, so failures return
 * false instead of throwing.
 */
export async function syncBrowserSessionUsage(
  prisma: PrismaClient,
  sandbox: SandboxProvider,
): Promise<boolean> {
  if (!hasSessionUsage(sandbox)) return false;
  let sessions: BrowserbaseSessionSummary[];
  try {
    sessions = await sandbox.listSessionUsage();
  } catch (error) {
    console.error("browser session usage sync failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
  const now = new Date();
  for (const session of sessions) {
    const row = toBrowserSessionUsageRow(session, now);
    if (!row) continue;
    const { sessionId, ...data } = row;
    await prisma.browserSessionUsage
      .upsert({
        where: { sessionId },
        create: { sessionId, ...data },
        update: {
          status: data.status,
          endedAt: data.endedAt,
          seconds: data.seconds,
          userId: data.userId ?? undefined,
          botId: data.botId ?? undefined,
        },
      })
      .catch(() => undefined);
  }
  return true;
}
