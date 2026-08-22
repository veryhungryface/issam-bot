import type { VoiceCatalogEntry, VoiceCredential, VoiceInfo, VoiceStatus } from "@rakazo/contracts";
import { Button } from "@rakazo/ui-web";
import { useEffect, useMemo, useState } from "react";
import { rpc } from "../lib/rpc";

export function VoiceSettingsOverlay({ onClose }: { onClose: () => void }) {
  const [catalog, setCatalog] = useState<VoiceCatalogEntry[]>([]);
  const [credentials, setCredentials] = useState<VoiceCredential[]>([]);
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [provider, setProvider] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<"connect" | "voice" | "test" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh(nextProvider?: string) {
    const [nextCatalog, nextCredentials, nextStatus] = await Promise.all([
      rpc.voice.catalog(),
      rpc.voice.credentials(),
      rpc.voice.status(),
    ]);
    const selected = nextProvider || provider || nextStatus.provider || nextCatalog[0]?.id || "";
    setCatalog(nextCatalog);
    setCredentials(nextCredentials);
    setStatus(nextStatus);
    setProvider(selected);
    const cred = nextCredentials.find((entry) => entry.provider === selected);
    const activeVoice = cred?.voiceId ?? "";
    setVoiceId(activeVoice);
    if (cred) {
      const listed = await rpc.voice.voices({ provider: selected });
      setVoices(listed);
      if (!activeVoice && listed[0]) setVoiceId(listed[0].id);
    } else {
      setVoices([]);
    }
  }

  useEffect(() => {
    void refresh()
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "음성 설정을 불러오지 못했습니다."),
      )
      .finally(() => setLoading(false));
  }, []);

  const selected = catalog.find((entry) => entry.id === provider) ?? catalog[0];
  const credential = credentials.find((entry) => entry.provider === provider);
  const busy = pending !== null;
  const voiceOptions = useMemo(
    () => (voices.length ? voices : voiceId ? [{ id: voiceId, label: voiceId }] : []),
    [voices, voiceId],
  );

  async function connectKey() {
    if (!selected || !apiKey.trim()) return;
    setError(null);
    setNotice(null);
    setPending("connect");
    try {
      await rpc.voice.connect({
        provider: selected.id,
        apiKey: apiKey.trim(),
        voiceId: voiceId || undefined,
      });
      setApiKey("");
      await refresh(selected.id);
      setNotice(`${selected.name}에 연결했습니다.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "음성 공급자에 연결하지 못했습니다.");
    } finally {
      setPending(null);
    }
  }

  async function chooseVoice(nextVoiceId: string) {
    setVoiceId(nextVoiceId);
    if (!credential) return;
    setPending("voice");
    setError(null);
    try {
      await rpc.voice.setVoice({
        voiceId: nextVoiceId,
        provider: selected?.id,
      });
      await refresh(selected?.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "음성을 저장하지 못했습니다.");
    } finally {
      setPending(null);
    }
  }

  async function testVoice() {
    setError(null);
    setNotice(null);
    setPending("test");
    try {
      const { speaker } = await import("../lib/tts.js");
      await speaker.speak("안녕하세요. 답변을 읽을 때 이 목소리로 들려드립니다.");
      if (speaker.state.error) {
        setError(speaker.state.error);
        return;
      }
      setNotice("음성이 들렸다면 설정이 완료되었습니다.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "시험 음성을 재생하지 못했습니다.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-[rgba(4,4,5,.62)] p-4 sm:p-10">
      <div
        data-testid="voice-settings"
        className="flex h-[min(680px,100%)] w-[920px] max-w-full flex-col overflow-hidden rounded-[26px] border border-[#232326] bg-[#141416] shadow-[0_40px_90px_rgba(0,0,0,.55)]"
      >
        <div className="flex items-start justify-between px-6 pt-6 sm:px-8 sm:pt-7">
          <div>
            <div className="text-2xl font-medium text-[#F1F1F2]">음성</div>
            <p className="mt-1 text-[13.5px] text-[#7A7A80]">
              {loading
                ? "음성 공급자를 불러오는 중…"
                : "개인 API 키를 연결하세요. 공급자를 바꿔도 봇의 읽기와 통화 버튼은 그대로 유지됩니다."}
            </p>
          </div>
          <button
            type="button"
            aria-label="음성 설정 닫기"
            onClick={onClose}
            className="text-[#85858A]"
          >
            ✕
          </button>
        </div>

        <div className="mx-6 mt-5 rounded-[14px] border border-[#26262A] bg-[#101012] px-4 py-3 sm:mx-8">
          <div className="text-[12.5px] uppercase tracking-[0.08em] text-[#6C6C70]">현재 음성</div>
          <div className="mt-1 text-[16px] text-[#F1F1F2]">
            {status?.ready
              ? voiceOptions.find((voice) => voice.id === status.voiceId)?.label || status.voiceId
              : status?.configured
                ? "음성을 선택하세요"
                : "설정되지 않음"}
          </div>
          <div className="mt-1 text-[13px] text-[#85858A]">
            {selected?.name ?? status?.provider ?? "음성 공급자를 연결하세요"}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-hidden px-6 py-6 sm:px-8 md:flex-row">
          <div className="flex min-h-0 shrink-0 flex-col md:w-[280px]">
            <div className="mb-3 text-[13.5px] text-[#85858A]">음성 공급자</div>
            <div className="rk-scroll overflow-y-auto rounded-[13px] border border-[#26262A]">
              {catalog.map((entry) => {
                const connected = credentials.some((cred) => cred.provider === entry.id);
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => {
                      setProvider(entry.id);
                      setApiKey("");
                      setError(null);
                      setNotice(null);
                      void refresh(entry.id);
                    }}
                    className={`flex w-full items-center gap-3 border-b border-[#202023] px-3.5 py-3 text-left last:border-0 ${
                      entry.id === provider ? "bg-[#1A1A1D]" : "hover:bg-[#161618]"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] text-[#ECECEE]">
                        {entry.name}
                      </span>
                      <span className="mt-0.5 block text-[12px] text-[#6C6C70]">
                        {entry.transcribe ? "말하기 + 받아쓰기" : "말하기 전용"}
                      </span>
                    </span>
                    {connected ? <span className="text-[12px] text-[#4ECB71]">연결됨</span> : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rk-scroll min-h-0 min-w-0 flex-1 overflow-y-auto">
            {error ? <p className="mb-4 text-sm text-[#C94244]">{error}</p> : null}
            {notice ? <p className="mb-4 text-sm text-[#4ECB71]">{notice}</p> : null}
            {selected ? (
              <>
                <p className="text-[13.5px] leading-[1.5] text-[#85858A]">{selected.description}</p>
                <div className="mt-5 rounded-[13px] border border-[#26262A] px-4 py-3">
                  <div className="text-[12.5px] uppercase tracking-[0.08em] text-[#6C6C70]">
                    개인 연결 정보
                  </div>
                  <div className="mt-1 text-[15px] text-[#ECECEE]">
                    {credential ? `연결됨 · ${selected.name}` : "연결되지 않음"}
                  </div>
                  <div className="mt-1 text-[13px] text-[#85858A]">
                    API 키는 서버에만 보관되며 웹앱에는 연결 여부만 전달됩니다.
                  </div>
                </div>

                <label className="mt-5 block text-[13.5px] text-[#85858A]">
                  API 키
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder={credential ? "교체할 API 키 붙여넣기" : "API 키 붙여넣기"}
                    className="mt-2 w-full rounded-[11px] border border-[#26262A] bg-[#101012] px-3.5 py-2.5 text-[14px] text-[#ECECEE] outline-none"
                  />
                </label>
                <Button
                  type="button"
                  className="mt-3"
                  disabled={busy || apiKey.trim().length < 8}
                  onClick={() => void connectKey()}
                >
                  {pending === "connect" ? "연결 중…" : credential ? "키 교체" : "연결"}
                </Button>

                {credential ? (
                  <>
                    <label className="mt-6 block text-[13.5px] text-[#85858A]">
                      음성
                      <select
                        value={voiceId}
                        onChange={(event) => void chooseVoice(event.target.value)}
                        className="mt-2 w-full rounded-[11px] border border-[#26262A] bg-[#101012] px-3.5 py-2.5 text-[14px] text-[#ECECEE] outline-none"
                      >
                        {voiceOptions.map((voice) => (
                          <option key={voice.id} value={voice.id}>
                            {voice.label}
                            {voice.description ? ` · ${voice.description}` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      disabled={busy || !status?.ready}
                      onClick={() => void testVoice()}
                      className="mt-4 text-[14px] text-[#C9C9CE] disabled:opacity-40"
                    >
                      {pending === "test" ? "재생 중…" : "샘플 듣기"}
                    </button>
                  </>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
