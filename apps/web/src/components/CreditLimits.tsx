import type { CreditAccount } from "@rakazo/contracts";
import { Button, Input } from "@rakazo/ui-web";
import { useCallback, useEffect, useId, useState } from "react";
import { formatKrw } from "./CreditMeter";

/**
 * The deployment owner's view of everyone's week, and the two dials behind it.
 *
 * The default is one number for everyone, because a budget nobody has to administer is the
 * only kind that survives contact with a group of testers. The per-account field is for the
 * exception that always turns up: one person doing real work who needs more, which would
 * otherwise force the default up for all twenty accounts.
 *
 * Loaded on demand rather than with the page: it reads every account's week, which is a
 * query per account, and almost nobody opening their own settings wants it.
 */
export function CreditLimits({
  onLoad,
  onSetLimit,
  onSetDeploymentLimit,
}: {
  onLoad: () => Promise<CreditAccount[]>;
  onSetLimit: (userId: string, weeklyCreditKrw: number | null) => Promise<CreditAccount[]>;
  onSetDeploymentLimit: (weeklyCreditKrw: number) => Promise<unknown>;
}) {
  const [accounts, setAccounts] = useState<CreditAccount[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [defaultDraft, setDefaultDraft] = useState("");
  const defaultFieldId = useId();

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const rows = await onLoad();
      setAccounts(rows);
      const fromDeployment = rows.find((row) => row.status.limitSource === "deployment");
      if (fromDeployment?.status.limitKrw != null) {
        setDefaultDraft(String(fromDeployment.status.limitKrw));
      }
    } catch {
      setError("사용량을 불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }, [onLoad]);

  useEffect(() => {
    if (open && accounts === null) void load();
  }, [open, accounts, load]);

  if (!open) {
    return (
      <Button
        variant="ghost"
        data-testid="credit-limits-open"
        className="mt-3 h-auto justify-start px-0 text-[12.5px] font-normal text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        사용자별 한도 관리
      </Button>
    );
  }

  return (
    <div data-testid="credit-limits" className="mt-3 border-t border-border pt-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1 text-[12.5px] text-muted-foreground">
          <label htmlFor={defaultFieldId}>기본 한도 (주당, 원)</label>
          <Input
            id={defaultFieldId}
            value={defaultDraft}
            inputMode="numeric"
            className="h-8 w-28 tabular-nums"
            onChange={(event) => setDefaultDraft(event.target.value.replace(/[^0-9]/g, ""))}
          />
        </div>
        <Button
          variant="outline"
          className="h-8"
          disabled={busy || defaultDraft === ""}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onSetDeploymentLimit(Number(defaultDraft));
              setAccounts(await onLoad());
            } catch {
              setError("기본 한도를 저장하지 못했습니다.");
            } finally {
              setBusy(false);
            }
          }}
        >
          적용
        </Button>
      </div>
      <p className="m-0 mt-1.5 text-[11.5px] leading-4 text-muted-foreground/70">
        개별 한도가 없는 계정에 적용됩니다. 배포 소유자는 한도를 받지 않습니다.
      </p>

      {error ? <p className="m-0 mt-2 text-[12.5px] text-destructive">{error}</p> : null}

      <ul className="m-0 mt-3 flex list-none flex-col gap-1.5 p-0">
        {(accounts ?? []).map((account) => (
          <AccountRow
            key={account.userId}
            account={account}
            busy={busy}
            onSave={async (value) => {
              setBusy(true);
              setError(null);
              try {
                setAccounts(await onSetLimit(account.userId, value));
              } catch {
                setError("한도를 저장하지 못했습니다.");
              } finally {
                setBusy(false);
              }
            }}
          />
        ))}
      </ul>
      {accounts !== null && accounts.length === 0 ? (
        <p className="m-0 mt-2 text-[12.5px] text-muted-foreground">계정이 없습니다.</p>
      ) : null}
    </div>
  );
}

function AccountRow({
  account,
  busy,
  onSave,
}: {
  account: CreditAccount;
  busy: boolean;
  onSave: (weeklyCreditKrw: number | null) => Promise<void>;
}) {
  const [draft, setDraft] = useState(
    account.overrideKrw == null ? "" : String(account.overrideKrw),
  );
  const spent = formatKrw(account.status.spentKrw);
  return (
    <li className="flex flex-wrap items-center gap-2 text-[12.5px]">
      <span className="min-w-0 flex-1 truncate text-foreground/85" title={account.email}>
        {account.name}
        {account.isDeploymentOwner ? " · 소유자" : ""}
      </span>
      <span className="shrink-0 tabular-nums text-muted-foreground">
        {account.status.state === "unlimited"
          ? spent
          : `${spent} / ${formatKrw(account.status.limitKrw ?? 0)}`}
      </span>
      {account.isDeploymentOwner ? (
        <span className="shrink-0 text-muted-foreground/70">한도 없음</span>
      ) : (
        <>
          <Input
            value={draft}
            inputMode="numeric"
            // Empty means "follow the default", which is why the placeholder shows what
            // that default currently is rather than a generic hint.
            placeholder={String(account.status.limitKrw ?? "")}
            aria-label={`${account.name} 주당 한도`}
            className="h-7 w-24 shrink-0 tabular-nums"
            onChange={(event) => setDraft(event.target.value.replace(/[^0-9]/g, ""))}
          />
          <Button
            variant="ghost"
            className="h-7 shrink-0 px-2 font-normal"
            disabled={busy}
            onClick={() => void onSave(draft === "" ? null : Number(draft))}
          >
            저장
          </Button>
        </>
      )}
    </li>
  );
}
