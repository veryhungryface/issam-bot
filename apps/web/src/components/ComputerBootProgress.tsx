import { Trans } from "@lingui/react/macro";
import { BotAvatar } from "@rakazo/ui-web";
import { useEffect, useState } from "react";

/**
 * Booting a cloud browser takes ten seconds or more (session, context, page restore).
 * A bar that never moves reads as "stuck", so this walks named stages on a timer:
 * the wait is unchanged but the user can see what it is waiting on.
 */
const STAGES = [
  { afterMs: 0, label: <Trans>Reserving a browser session</Trans> },
  { afterMs: 3_500, label: <Trans>Restoring your saved logins</Trans> },
  { afterMs: 8_000, label: <Trans>Opening the browser</Trans> },
  { afterMs: 14_000, label: <Trans>Almost ready — loading the last page</Trans> },
] as const;

export function ComputerBootProgress({
  botName,
  botColor,
  botId,
}: {
  botName: string;
  botColor?: string;
  botId?: string;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsed(Date.now() - startedAt), 500);
    return () => window.clearInterval(timer);
  }, []);

  const stageIndex = STAGES.reduce(
    (current, stage, index) => (elapsed >= stage.afterMs ? index : current),
    0,
  );

  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-7 bg-background/95"
    >
      <div className="relative grid place-items-center">
        {/* Two rings breathing outward read as "working" without spinning anything. */}
        <span className="rk-boot-ring absolute h-[104px] w-[104px] rounded-full border border-primary/25" />
        <span
          className="rk-boot-ring absolute h-[104px] w-[104px] rounded-full border border-primary/25"
          style={{ animationDelay: "-1.1s" }}
        />
        {botId ? (
          <BotAvatar color={botColor ?? "#5B8DEF"} identity={botId} size={56} />
        ) : (
          <span className="h-14 w-14 rounded-full bg-accent" />
        )}
      </div>

      <div className="flex flex-col items-center gap-2.5">
        <div className="text-[19px] font-medium text-foreground" dir="auto">
          <Trans>Booting up {botName}’s computer</Trans>
        </div>
        <div
          key={stageIndex}
          className="rk-boot-stage text-[14px] text-muted-foreground"
          dir="auto"
        >
          {STAGES[stageIndex]?.label}
        </div>
      </div>

      <div className="h-[5px] w-[min(420px,70%)] overflow-hidden rounded-full bg-accent">
        <div className="rk-boot-sweep h-full w-2/5 rounded-full bg-primary" />
      </div>
    </div>
  );
}
