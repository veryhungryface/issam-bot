import { Button, Input } from "@rakazo/ui-web";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { rpc } from "../lib/rpc";

/**
 * The page a phone lands on after scanning the QR on a computer.
 *
 * One screen, one decision, no navigation: the teacher is standing at a desk holding a phone,
 * and whatever is here has to be readable and finishable in that posture. So the computer's
 * own name for itself comes down with the session and fills the box — on a phone, in Korean,
 * typing "교무실 노트북" is the step people abandon.
 *
 * Pressing 연결 does not finish the pairing. It mints the device and leaves the token where
 * only the computer that drew the QR can fetch it; that computer then asks the person sitting
 * at it. Which is the point: anyone who can see a screen can photograph the QR on it, so a
 * scan is a request, and the keyboard is where it is granted.
 */

type Status = "loading" | "pending" | "taken" | "expired" | "claimed" | "error";

export function BrowserPairPage() {
  const { sessionId = "" } = useParams();
  const [status, setStatus] = useState<Status>("loading");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void rpc.browserDevices
      .describePairSession({ sessionId })
      .then((session) => {
        if (cancelled) return;
        setName(session.label ?? "");
        setStatus(
          session.status === "pending"
            ? "pending"
            : session.status === "expired"
              ? "expired"
              : "taken",
        );
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  async function claim() {
    const label = name.trim();
    if (busy || !label) return;
    setBusy(true);
    setError(null);
    try {
      await rpc.browserDevices.claimPairSession({ sessionId, name: label });
      setStatus("claimed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "연결하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      data-testid="browser-pair"
      className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center px-5 py-10"
    >
      <h1 className="text-[19px] font-semibold text-foreground">이 컴퓨터를 연결할까요?</h1>

      {status === "loading" ? (
        <p className="mt-3 text-[14px] text-muted-foreground">확인 중…</p>
      ) : null}

      {status === "expired" ? (
        <p className="mt-3 text-[14px] leading-[1.6] text-muted-foreground">
          QR이 만료됐습니다. 컴퓨터의 확장 프로그램에서 새 QR을 띄우고 다시 찍어 주세요. QR은 띄운
          뒤 5분 동안만 쓸 수 있습니다.
        </p>
      ) : null}

      {status === "taken" ? (
        <p className="mt-3 text-[14px] leading-[1.6] text-muted-foreground">
          이 QR은 이미 처리됐습니다. 컴퓨터 화면을 확인해 보시고, 연결되지 않았으면 새 QR을 띄워
          주세요.
        </p>
      ) : null}

      {status === "error" ? (
        <p role="alert" className="mt-3 text-[14px] text-destructive">
          연결 정보를 불러오지 못했습니다. 잠시 뒤 다시 찍어 주세요.
        </p>
      ) : null}

      {status === "claimed" ? (
        <div className="mt-3">
          <p className="text-[14px] leading-[1.6] text-foreground">
            ‘{name.trim()}’ 에 보냈습니다. <strong>컴퓨터 화면에서 ‘연결’을 눌러</strong> 마무리해
            주세요.
          </p>
          <p className="mt-3 text-[13px] leading-[1.55] text-muted-foreground">
            컴퓨터에서 누르기 전까지는 연결되지 않습니다. 화면에 다른 사람의 이름이 보이면 거절하면
            됩니다.
          </p>
        </div>
      ) : null}

      {status === "pending" ? (
        <>
          <p className="mt-3 text-[14px] leading-[1.6] text-muted-foreground">
            연결하면 아이쌤봇이 이 컴퓨터의 크롬에 일을 맡길 수 있습니다. 학교 업무 사이트에 이미
            로그인된 창을 그대로 쓰기 때문에, 연결한 본인에게만 보이고 본인만 쓸 수 있습니다.
          </p>
          <label
            className="mt-5 block text-[13.5px] font-medium text-foreground"
            htmlFor="pair-name"
          >
            이 컴퓨터 이름
          </label>
          <Input
            id="pair-name"
            value={name}
            className="mt-1.5"
            placeholder="예: 교무실 노트북"
            maxLength={60}
            autoComplete="off"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void claim();
            }}
          />
          <Button
            className="mt-4 w-full"
            disabled={busy || !name.trim()}
            onClick={() => void claim()}
          >
            {busy ? "연결 중…" : "연결"}
          </Button>
          <p className="mt-3 text-[13px] leading-[1.55] text-muted-foreground">
            누른 뒤 컴퓨터 화면에서 한 번 더 확인합니다. 내가 띄운 QR이 아니면 연결하지 마세요.
          </p>
          {error ? (
            <p role="alert" className="mt-3 text-[13px] text-destructive">
              {error}
            </p>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
