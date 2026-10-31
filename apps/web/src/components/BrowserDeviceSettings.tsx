import type { BrowserDevice } from "@rakazo/contracts";
import { encodeBrowserDevicePairing } from "@rakazo/core";
import { Button, Input } from "@rakazo/ui-web";
import { useEffect, useRef, useState } from "react";
import { rpc } from "../lib/rpc";

/**
 * Pairing a teacher's own Chrome.
 *
 * Every other computer the bots drive is a rented Browserbase session, signed in to nothing.
 * This one is the teacher's own browser, already signed in to the school systems — which is
 * the whole point of it and also the reason this screen is blunt about what it hands over.
 *
 * The token exists in readable form exactly once, in the box below, and only in this tab.
 * It is never fetched again, so "다시 보기" is not a feature that can be added later: losing
 * it means unpairing and pairing again, and the copy here says so.
 */

/** Long enough that a device that is merely between polls never reads as asleep. */
const REFRESH_MS = 15_000;

function describeLastSeen(lastSeenAt: string | null): string {
  if (!lastSeenAt) return "아직 연결되지 않았습니다";
  const seconds = Math.round((Date.now() - new Date(lastSeenAt).getTime()) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0) return "마지막 응답 방금";
  if (seconds < 60) return "마지막 응답 방금";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `마지막 응답 ${minutes}분 전`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `마지막 응답 ${hours}시간 전`;
  return `마지막 응답 ${Math.round(hours / 24)}일 전`;
}

export function BrowserDeviceSettings() {
  const [devices, setDevices] = useState<BrowserDevice[] | null>(null);
  const [name, setName] = useState("");
  const [pairing, setPairing] = useState<{ deviceName: string; code: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    try {
      setDevices(await rpc.browserDevices.list({}));
    } catch (err) {
      setError(err instanceof Error ? err.message : "연결된 크롬을 불러오지 못했습니다.");
    }
  }

  useEffect(() => {
    void refresh();
    // The extension polls; "켜져 있음" is only ever as fresh as the last answer it gave, so
    // re-ask while this panel is open rather than leaving a stale badge on screen.
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  async function pair() {
    const label = name.trim();
    if (busy || !label) return;
    setBusy(true);
    setError(null);
    try {
      const result = await rpc.browserDevices.pair({ name: label });
      setPairing({
        deviceName: result.device.name,
        code: encodeBrowserDevicePairing({
          apiBase: window.location.origin,
          deviceId: result.device.id,
          token: result.token,
        }),
      });
      setCopied(false);
      setName("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "연결하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(device: BrowserDevice) {
    if (busy) return;
    if (
      !window.confirm(
        `‘${device.name}’ 연결을 해제할까요? 토큰을 지우기 때문에 그 크롬은 더 이상 작업을 받지 못합니다.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await rpc.browserDevices.revoke({ deviceId: device.id });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "연결을 해제하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function copyCode() {
    if (!pairing) return;
    codeRef.current?.select();
    // Clipboard access can be refused outright; selecting the text first leaves the teacher
    // a working Ctrl+C either way.
    navigator.clipboard
      ?.writeText(pairing.code)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  }

  return (
    <section
      data-testid="browser-device-settings"
      className="mt-5 rounded-xl border border-border px-4 py-4"
    >
      <h3 className="text-[15px] font-medium text-foreground">내 크롬에 일 맡기기</h3>
      <p className="mt-2 text-[13.5px] leading-[1.55] text-muted-foreground">
        선생님이 쓰는 크롬에 확장 프로그램을 설치하고 연결하면, 봇이 그 크롬에 작업을 맡길 수
        있습니다. 학교 업무 사이트에 이미 로그인된 창을 그대로 쓰기 때문에, 연결한 본인에게만 보이고
        본인만 쓸 수 있습니다.
      </p>

      {pairing ? (
        <div
          data-testid="browser-device-code"
          className="mt-4 rounded-lg border border-border bg-muted/40 px-3.5 py-3"
        >
          <p className="text-[13.5px] font-medium text-foreground">
            ‘{pairing.deviceName}’ 연결 코드
          </p>
          <div className="mt-2 flex gap-2">
            <Input
              ref={codeRef}
              readOnly
              value={pairing.code}
              aria-label="연결 코드"
              className="font-mono text-[12px]"
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button variant="secondary" className="shrink-0" onClick={copyCode}>
              {copied ? "복사했습니다" : "복사"}
            </Button>
          </div>
          <p className="mt-2 text-[12.5px] leading-[1.5] text-muted-foreground">
            확장 프로그램의 ‘아이쌤봇 연결’ 화면에 붙여넣으세요. 이 코드는 지금 한 번만 보입니다 —
            잃어버리면 연결을 해제하고 새로 만들어야 합니다. 코드 안에 토큰이 들어 있으니 다른
            사람에게 보내지 마세요.
          </p>
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setPairing(null)}>
            닫기
          </Button>
        </div>
      ) : null}

      {devices === null ? (
        <p className="mt-3 text-[13px] text-muted-foreground">불러오는 중…</p>
      ) : devices.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted-foreground">연결된 크롬이 없습니다.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {devices.map((device) => (
            <li
              key={device.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border px-3.5 py-2"
            >
              <span className="min-w-0">
                <span className="block truncate text-[13.5px] text-foreground/80">
                  {device.name}
                </span>
                <span className="mt-0.5 block text-[12px] text-muted-foreground">
                  {device.online ? "켜져 있음" : "꺼져 있음"} ·{" "}
                  {describeLastSeen(device.lastSeenAt)}
                </span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 text-muted-foreground"
                disabled={busy}
                onClick={() => void revoke(device)}
              >
                연결 해제
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex gap-2">
        <Input
          value={name}
          aria-label="연결할 크롬 이름"
          placeholder="예: 교무실 노트북"
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void pair();
          }}
        />
        <Button className="shrink-0" disabled={busy || !name.trim()} onClick={() => void pair()}>
          크롬 연결
        </Button>
      </div>
      <p className="mt-2 text-[12.5px] leading-[1.5] text-muted-foreground/80">
        여러 대를 연결할 수 있습니다. 봇은 켜져 있는 크롬에만 작업을 보냅니다. 확장 프로그램에서
        QR을 띄워 휴대폰으로 찍는 쪽이 더 간단합니다 — 위의 코드는 QR을 쓸 수 없을 때를 위한
        방법입니다.
      </p>
      {error ? (
        <p role="alert" className="mt-3 text-[12.5px] text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
