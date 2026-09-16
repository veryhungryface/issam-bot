import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ThreadMessage } from "@rakazo/contracts";
import { Button, Checkbox, Input } from "@rakazo/ui-web";
import { ShieldCheck } from "lucide-react";
import { useId, useState } from "react";
import { rpc } from "../lib/rpc";

export type BrowserLoginBlock = Extract<ThreadMessage["blocks"][number], { kind: "browser_login" }>;

function hostLabel(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/**
 * A sign-in sheet for the bot's own browser. What the user types goes straight to the
 * server, which fills it into the page at `origin` — the bot never receives the values,
 * so the note below is a literal description of the flow, not reassurance.
 */
export function BrowserLoginCard({
  block,
  botId,
  botName,
  runId,
  messageId,
  canAnswer,
  onResolved,
}: {
  block: BrowserLoginBlock;
  botId: string;
  botName: string;
  runId?: string;
  messageId: string;
  canAnswer: boolean;
  onResolved?: () => void;
}) {
  const { t: translate } = useLingui();
  const ids = useId();
  const [values, setValues] = useState<Record<string, string>>({});
  const [save, setSave] = useState(true);
  const [pending, setPending] = useState<"fill" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resolved = block.status === "filled" || block.status === "cancelled";
  const complete = block.fields.every((field) => (values[field.id] ?? "").length > 0);

  async function submit() {
    if (!runId || pending || !complete) return;
    setPending("fill");
    setError(null);
    try {
      const result = await rpc.computer.fillLogin({ botId, runId, messageId, values, save });
      setValues({});
      if (result.missing.length > 0) {
        setError(translate`Signed in, but some fields were not found on the page.`);
      }
      onResolved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : translate`Could not sign in.`);
    } finally {
      setPending(null);
    }
  }

  async function cancel() {
    if (!runId || pending) return;
    setPending("cancel");
    try {
      await rpc.computer.cancelLogin({ botId, runId, messageId });
      onResolved?.();
    } catch {
      setError(translate`Could not close this sign-in.`);
    } finally {
      setPending(null);
    }
  }

  return (
    <div
      data-testid="browser-login-card"
      className="w-[min(420px,100%)] rounded-[18px] border border-border bg-muted px-[18px] py-4"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-[15px] font-medium text-foreground" dir="auto">
          {block.title}
        </span>
        {resolved ? (
          <span className="rounded-full bg-success/15 px-[11px] py-1 text-[13px] text-success">
            {block.status === "filled" ? <Trans>Signed in</Trans> : <Trans>Skipped</Trans>}
          </span>
        ) : (
          <span className="rounded-full bg-warning/15 px-[11px] py-1 text-[13px] text-warning">
            <Trans>Action needed</Trans>
          </span>
        )}
      </div>

      {resolved ? (
        block.saved ? (
          <p className="mt-2 text-[13.5px] text-muted-foreground">
            <Trans>Saved for next time on {hostLabel(block.origin)}.</Trans>
          </p>
        ) : null
      ) : (
        <>
          <div className="mt-3 space-y-3">
            {block.fields.map((field) => (
              <label key={field.id} htmlFor={`${ids}-${field.id}`} className="block">
                <span className="text-[13px] text-muted-foreground">{field.label}</span>
                <Input
                  id={`${ids}-${field.id}`}
                  type={field.masked ? "password" : "text"}
                  autoComplete={field.masked ? "current-password" : "username"}
                  value={values[field.id] ?? ""}
                  disabled={!canAnswer || pending !== null}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field.id]: event.target.value }))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && complete) void submit();
                  }}
                  className="mt-1 w-full"
                />
              </label>
            ))}
          </div>

          <p className="mt-3 flex items-start gap-2 text-[12.5px] leading-5 text-muted-foreground">
            <ShieldCheck size={15} strokeWidth={1.7} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              <Trans>
                Fills only the page open in the browser at {hostLabel(block.origin)}. Masked fields
                are never shown to {botName}.
              </Trans>
            </span>
          </p>

          <div className="mt-3 flex items-center gap-2 text-[13px] text-muted-foreground">
            <Checkbox
              id={`${ids}-save`}
              checked={save}
              onCheckedChange={(checked) => setSave(checked === true)}
              disabled={!canAnswer || pending !== null}
            />
            <label htmlFor={`${ids}-save`}>
              <Trans>Save so {botName} can sign in next time</Trans>
            </label>
          </div>

          {error ? (
            <p role="alert" className="mt-2 text-[13px] text-destructive">
              {error}
            </p>
          ) : null}

          <div className="mt-4 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canAnswer || pending !== null}
              onClick={() => void cancel()}
            >
              <Trans>Skip</Trans>
            </Button>
            <Button
              type="button"
              size="sm"
              data-testid="browser-login-submit"
              disabled={!canAnswer || !complete || pending !== null}
              onClick={() => void submit()}
            >
              {pending === "fill" ? <Trans>Signing in…</Trans> : <Trans>Continue</Trans>}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
