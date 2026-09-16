import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@rakazo/ui-web";
import { useCallback, useEffect, useState } from "react";
import { rpc } from "../lib/rpc";

type SavedLogin = { name: string; origin: string; updatedAt: string };

function hostLabel(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/** Sites this bot can sign in to on its own. Values are never readable here or anywhere else. */
export function SavedLoginsSection({ botId }: { botId: string }) {
  const { t } = useLingui();
  const [logins, setLogins] = useState<SavedLogin[] | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLogins(await rpc.computer.savedLogins({ botId }));
    } catch {
      setLogins([]);
    }
  }, [botId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!logins || logins.length === 0) return null;

  async function forget(name: string) {
    setPending(name);
    setError(null);
    try {
      await rpc.computer.forgetLogin({ botId, name });
      await refresh();
    } catch {
      setError(t`Could not remove this sign-in.`);
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="mt-4" data-testid="saved-logins">
      <div className="text-[14px] text-muted-foreground">
        <Trans>Saved sign-ins</Trans>
      </div>
      <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground/80">
        <Trans>
          Used only to fill the sign-in form on these sites. Passwords stay encrypted and are never
          shown to the bot or to you.
        </Trans>
      </p>
      <ul className="mt-2 space-y-1.5">
        {logins.map((login) => (
          <li
            key={login.name}
            className="flex items-center justify-between gap-3 rounded-[11px] border border-border px-3 py-2"
          >
            <span className="min-w-0 truncate text-[14px] text-foreground">
              {hostLabel(login.origin)}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending === login.name}
              onClick={() => void forget(login.name)}
            >
              {pending === login.name ? <Trans>Removing…</Trans> : <Trans>Remove</Trans>}
            </Button>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
