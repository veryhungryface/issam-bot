import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@rakazo/ui-web";
import { useEffect, useState } from "react";
import { rpc } from "../lib/rpc";

type Outcome = { cancelledRuns: number; sleepingComputers: number };

/**
 * The deployment owner's one switch for when something is going wrong or costing too much.
 * Stopping takes a second, deliberate press because it cancels every user's work at once.
 */
export function EmergencyStopSection({ isDeploymentOwner }: { isDeploymentOwner: boolean }) {
  const { t, i18n } = useLingui();
  // undefined while loading; null when bots may work.
  const [pausedAt, setPausedAt] = useState<string | null | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    if (!isDeploymentOwner) return;
    let cancelled = false;
    void rpc.deployment
      .get()
      .then((deployment) => {
        if (!cancelled) setPausedAt(deployment.agentsPausedAt);
      })
      .catch(() => {
        if (!cancelled) setError(t`Could not load the emergency stop.`);
      });
    return () => {
      cancelled = true;
    };
  }, [isDeploymentOwner, t]);

  if (!isDeploymentOwner) return null;
  if (pausedAt === undefined && !error) return null;

  async function apply(paused: boolean) {
    setBusy(true);
    setError(null);
    try {
      const result = await rpc.deployment.setAgentsPaused({ paused });
      setPausedAt(result.deployment.agentsPausedAt);
      setOutcome(paused ? result : null);
      setConfirming(false);
    } catch {
      setError(paused ? t`Could not stop the bots.` : t`Could not resume the bots.`);
    } finally {
      setBusy(false);
    }
  }

  const since = pausedAt
    ? new Date(pausedAt).toLocaleString(i18n.locale || "en", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

  return (
    <section
      data-testid="emergency-stop-settings"
      className="mt-5 rounded-xl border border-border px-4 py-4"
    >
      <h3 className="text-[15px] font-medium text-foreground">
        <Trans>Emergency stop</Trans>
      </h3>
      {pausedAt ? (
        <>
          <p role="status" className="mt-3 text-[14px] text-destructive">
            <Trans>All bots have been stopped since {since}.</Trans>
          </p>
          <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground/80">
            <Trans>
              New messages get a notice instead of an answer, and routines skip their turn. Nothing
              is replayed when you resume.
            </Trans>
          </p>
          {outcome ? (
            <p className="mt-2 text-[12.5px] text-muted-foreground/80">
              <Trans>
                Stopped {outcome.cancelledRuns} running tasks and shut down{" "}
                {outcome.sleepingComputers} browsers.
              </Trans>
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="mt-3"
            disabled={busy}
            onClick={() => void apply(false)}
          >
            {busy ? <Trans>Resuming…</Trans> : <Trans>Resume all bots</Trans>}
          </Button>
        </>
      ) : confirming ? (
        <>
          <p className="mt-3 text-[14px] text-foreground">
            <Trans>
              This cancels everything bots are doing right now, for every user, and shuts their
              browsers down. Nothing starts again until you resume.
            </Trans>
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => void apply(true)}
            >
              {busy ? <Trans>Stopping…</Trans> : <Trans>Stop all bots now</Trans>}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              <Trans>Cancel</Trans>
            </Button>
          </div>
        </>
      ) : pausedAt === null ? (
        <>
          <p className="mt-3 text-[12.5px] leading-5 text-muted-foreground/80">
            <Trans>
              For when something is going wrong or costing too much: stop every bot at once.
            </Trans>
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-3"
            onClick={() => setConfirming(true)}
          >
            <Trans>Stop all bots…</Trans>
          </Button>
        </>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-[12.5px] text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
