import { readBoundedResponseBytes } from "@rakazo/core";
import { selectedSpaceId, withSpaceHeaders } from "./rpc.js";

export type DictationMode = "hold" | "endpoint";

export type DictationSnapshot = {
  status: "idle" | "listening" | "transcribing";
  transcript: string;
  error?: string;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { resultIndex: number; results: SpeechRecognitionResultList }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

const IDLE: DictationSnapshot = { status: "idle", transcript: "" };
const ENDPOINT_TICK_MS = 80;
const SILENCE_RMS = 0.035;
export const TRANSCRIPTION_RESPONSE_TIMEOUT_MS = 70_000;
export const MAX_TRANSCRIPTION_RESPONSE_BYTES = 64 * 1024;
const ENDPOINT_UNSUPPORTED =
  "이 브라우저에서는 말하기 종료 시점을 자동으로 감지할 수 없습니다. Chrome이나 데스크톱 앱을 사용하거나 메시지 입력창에서 말하는 동안 버튼을 누르고 계세요.";

export function webSpeechAvailable(): boolean {
  return Boolean(speechRecognitionCtor());
}

export function recognitionLanguage(): string {
  const docLang = typeof document !== "undefined" ? document.documentElement.lang.trim() : "";
  const nav = typeof navigator !== "undefined" ? navigator.language : "";
  const raw = docLang || nav || "ko-KR";
  return /^ko(?:-|$)/i.test(raw) ? "ko-KR" : raw;
}

function insecureOrigin(): boolean {
  return typeof window !== "undefined" && window.isSecureContext === false;
}

function speechRecognitionError(code?: string): string {
  if (code === "not-allowed") {
    return "마이크 권한이 거부되었습니다. 브라우저 주소창에서 마이크를 허용하세요.";
  }
  if (code === "audio-capture") return "마이크를 찾을 수 없습니다.";
  if (code === "language-not-supported") {
    return "이 브라우저는 한국어 음성 인식을 지원하지 않습니다. OpenAI 또는 ElevenLabs 받아쓰기를 연결하세요.";
  }
  if (code === "network" || code === "service-not-allowed") {
    return insecureOrigin()
      ? "브라우저 음성 인식이 실패했습니다. HTTP에서는 Google 음성 인식이 막힙니다. OpenAI 또는 ElevenLabs 받아쓰기를 연결하거나 HTTPS로 접속하세요."
      : "브라우저 음성 인식이 네트워크에서 실패했습니다. OpenAI 또는 ElevenLabs 받아쓰기를 연결하면 설정한 API로 변환합니다.";
  }
  return "음성 입력에 실패했습니다.";
}

function speechRecognitionCtor(): SpeechRecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const host = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return host.SpeechRecognition ?? host.webkitSpeechRecognition;
}

function audioContextCtor(): (new () => AudioContext) | undefined {
  if (typeof AudioContext === "function") return AudioContext;
  if (typeof window === "undefined") return undefined;
  const host = window as Window & { webkitAudioContext?: typeof AudioContext };
  return host.webkitAudioContext;
}

export class Dictation {
  private snapshot: DictationSnapshot = IDLE;
  private watchers = new Set<(s: DictationSnapshot) => void>();
  private recognition: SpeechRecognitionLike | null = null;
  private media: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private token = 0;
  private silenceTimer: ReturnType<typeof setTimeout> | undefined;
  private transcribeAbort: AbortController | null = null;
  private audioContext: AudioContext | null = null;
  private vadTimer: ReturnType<typeof setInterval> | undefined;
  private onFinal: ((text: string) => void) | null = null;

  subscribe(fn: (s: DictationSnapshot) => void): () => void {
    this.watchers.add(fn);
    fn(this.snapshot);
    return () => {
      this.watchers.delete(fn);
    };
  }

  get state(): DictationSnapshot {
    return this.snapshot;
  }

  private set(next: DictationSnapshot) {
    this.snapshot = next;
    for (const watcher of [...this.watchers]) watcher(next);
  }

  stop(reason: "submit" | "cancel" | "replace" = "cancel") {
    this.token += 1;
    this.transcribeAbort?.abort();
    this.transcribeAbort = null;
    this.stopVad();
    clearTimeout(this.silenceTimer);
    this.silenceTimer = undefined;
    const rec = this.recognition;
    this.recognition = null;
    if (rec) {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        if (reason === "submit") rec.stop();
        else rec.abort();
      } catch {
        // already stopped
      }
    }
    const media = this.media;
    this.media = null;
    if (media && media.state !== "inactive") {
      try {
        media.stop();
      } catch {
        // already stopped
      }
    }
    this.chunks = [];
    this.onFinal = null;
    if (this.snapshot.status !== "idle" || this.snapshot.error) this.set(IDLE);
  }

  async listen(opts: {
    mode: DictationMode;
    transcribe?: boolean;
    endpointMs?: number;
    onFinal: (text: string) => void;
  }): Promise<void> {
    this.stop("replace");
    const mine = this.token;
    const spaceId = selectedSpaceId();
    this.onFinal = opts.onFinal;
    this.set({ status: "listening", transcript: "" });
    // Prefer the configured voice provider. Chrome Web Speech talks to Google and
    // fails on HTTP origins even when OpenAI/ElevenLabs STT is connected.
    if (opts.transcribe) {
      await this.listenRecorder(mine, opts.mode, opts.endpointMs ?? 850, spaceId);
      return;
    }
    if (webSpeechAvailable()) {
      this.listenWebSpeech(opts.mode, opts.endpointMs ?? 850, mine);
      return;
    }
    this.set({
      ...IDLE,
      error: insecureOrigin()
        ? "음성 입력은 HTTPS에서만 동작합니다. OpenAI 또는 ElevenLabs 받아쓰기를 연결하거나 HTTPS로 접속하세요."
        : "이 브라우저는 기기 내 음성 인식을 지원하지 않습니다. 음성 변환을 지원하는 공급자를 연결하거나 Chrome 또는 데스크톱 앱을 사용하세요.",
    });
  }

  private listenWebSpeech(mode: DictationMode, endpointMs: number, mine: number) {
    const Ctor = speechRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = recognitionLanguage();
    rec.onresult = (event) => {
      if (this.token !== mine) return;
      let transcript = "";
      for (let i = 0; i < event.results.length; i += 1) {
        transcript += event.results[i]?.[0]?.transcript ?? "";
      }
      this.set({ status: "listening", transcript: transcript.trim() });
      if (mode !== "endpoint") return;
      clearTimeout(this.silenceTimer);
      this.silenceTimer = setTimeout(() => {
        if (this.token !== mine) return;
        const text = this.snapshot.transcript.trim();
        this.finish(text, mine);
      }, endpointMs);
    };
    rec.onerror = (event) => {
      if (this.token !== mine) return;
      if (event.error === "aborted" || event.error === "no-speech") return;
      this.set({
        ...IDLE,
        error: speechRecognitionError(event.error),
      });
    };
    rec.onend = () => {
      if (this.token !== mine) return;
      if (this.snapshot.status !== "listening") return;
      if (mode === "hold") {
        this.finish(this.snapshot.transcript, mine);
        return;
      }
      const text = this.snapshot.transcript.trim();
      if (text) {
        this.finish(text, mine);
        return;
      }
      try {
        rec.start();
      } catch {
        this.set({ ...IDLE, error: "음성 입력이 예기치 않게 종료되었습니다." });
      }
    };
    this.recognition = rec;
    rec.start();
  }

  private async listenRecorder(
    mine: number,
    mode: DictationMode,
    endpointMs: number,
    spaceId: string | null,
  ) {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      if (this.token !== mine) return;
      this.set({
        ...IDLE,
        error: insecureOrigin()
          ? "마이크를 사용할 수 없습니다. HTTP 주소에서는 브라우저가 마이크를 차단합니다. HTTPS로 접속하세요."
          : "마이크를 사용할 수 없습니다.",
      });
      return;
    }
    if (this.token !== mine) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    if (mode === "endpoint" && !this.armSilence(stream, mine, endpointMs)) {
      for (const track of stream.getTracks()) track.stop();
      this.set({ ...IDLE, error: ENDPOINT_UNSUPPORTED });
      return;
    }
    const media = new MediaRecorder(stream);
    this.media = media;
    this.chunks = [];
    media.ondataavailable = (event) => {
      if (this.token !== mine) return;
      if (event.data.size) this.chunks.push(event.data);
    };
    media.onstop = () => {
      for (const track of stream.getTracks()) track.stop();
      if (this.token !== mine) return;
      this.stopVad();
      void this.transcribeChunks(mine, spaceId);
    };
    media.start(mode === "endpoint" ? 250 : undefined);
  }

  private armSilence(stream: MediaStream, mine: number, endpointMs: number): boolean {
    const Ctor = audioContextCtor();
    if (!Ctor) return false;
    try {
      const ctx = new Ctor();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      this.audioContext = ctx;
      if (ctx.state === "suspended") void ctx.resume();
      const data = new Uint8Array(analyser.fftSize);
      let heardSpeech = false;
      let silentFor = 0;
      this.vadTimer = setInterval(() => {
        const media = this.media;
        if (this.token !== mine || !media || media.state === "inactive") return;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const sample of data) {
          const n = (sample - 128) / 128;
          sum += n * n;
        }
        const rms = Math.sqrt(sum / data.length);
        if (rms > SILENCE_RMS) {
          heardSpeech = true;
          silentFor = 0;
          return;
        }
        if (!heardSpeech) return;
        silentFor += ENDPOINT_TICK_MS;
        if (silentFor < endpointMs) return;
        this.stopVad();
        try {
          media.stop();
        } catch {
          // already stopped
        }
      }, ENDPOINT_TICK_MS);
      return true;
    } catch {
      this.stopVad();
      return false;
    }
  }

  private stopVad() {
    clearInterval(this.vadTimer);
    this.vadTimer = undefined;
    const ctx = this.audioContext;
    this.audioContext = null;
    if (ctx) void ctx.close().catch(() => undefined);
  }

  private async transcribeChunks(mine: number, spaceId: string | null) {
    if (this.token !== mine) return;
    const blob = new Blob(this.chunks, { type: this.chunks[0]?.type || "audio/webm" });
    this.chunks = [];
    if (!blob.size) {
      this.set(IDLE);
      return;
    }
    this.set({ status: "transcribing", transcript: this.snapshot.transcript });
    const abort = new AbortController();
    this.transcribeAbort = abort;
    const timer = setTimeout(
      () => abort.abort(new Error("Transcription request timed out.")),
      TRANSCRIPTION_RESPONSE_TIMEOUT_MS,
    );
    try {
      const audioBase64 = await blobToBase64(blob);
      if (this.token !== mine) return;
      const res = await withAbort(
        fetch("/api/voice/transcribe", {
          method: "POST",
          headers: withSpaceHeaders({ "content-type": "application/json" }, spaceId),
          credentials: "include",
          body: JSON.stringify({ audioBase64, mimeType: blob.type }),
          signal: abort.signal,
        }),
        abort.signal,
      );
      if (this.token !== mine) {
        cancelResponse(res);
        return;
      }
      const body = await readTranscriptionBody(res, abort.signal);
      if (this.token !== mine) return;
      if (!res.ok) {
        this.set({ ...IDLE, error: "녹음 내용을 텍스트로 변환하지 못했습니다." });
        return;
      }
      this.finish(body.text ?? "", mine);
    } catch (error) {
      // User cancel bumps token in stop() before aborting, so a matching token
      // means the deadline timer fired. Browsers may reject fetch as AbortError
      // instead of signal.reason; surface the timeout either way.
      if (this.token !== mine) return;
      const timedOut =
        (abort.signal.reason instanceof Error &&
          abort.signal.reason.message === "Transcription request timed out.") ||
        (error instanceof Error && error.message === "Transcription request timed out.");
      if (timedOut || (error instanceof Error && error.name === "AbortError")) {
        this.set({ ...IDLE, error: "Transcription request timed out." });
        return;
      }
      this.set({
        ...IDLE,
        // Surface the specific oversized-response error; everything else gets
        // the generic Korean transcription failure message.
        error:
          error instanceof Error && error.message === "Transcription response is too large."
            ? error.message
            : "녹음 내용을 텍스트로 변환하지 못했습니다.",
      });
    } finally {
      clearTimeout(timer);
      if (this.transcribeAbort === abort) this.transcribeAbort = null;
    }
  }

  submitHold() {
    if (this.media && this.media.state !== "inactive") {
      this.media.stop();
      return;
    }
    this.finish(this.snapshot.transcript, this.token);
  }

  private finish(text: string, mine: number) {
    if (this.token !== mine) return;
    const trimmed = text.trim();
    const onFinal = this.onFinal;
    this.stop("submit");
    if (trimmed) onFinal?.(trimmed);
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function readTranscriptionBody(
  response: Response,
  signal: AbortSignal,
): Promise<{ text?: string; error?: string }> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_TRANSCRIPTION_RESPONSE_BYTES) {
    cancelResponse(response);
    throw new Error("Transcription response is too large.");
  }
  const bytes = await readBoundedResponseBytes(response, {
    maxBytes: MAX_TRANSCRIPTION_RESPONSE_BYTES,
    tooLargeMessage: "Transcription response is too large.",
    read: (operation) => withAbort(operation(), signal),
  });
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as { text?: string; error?: string })
      : {};
  } catch {
    return {};
  }
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("Request aborted."));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error("Request aborted."));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        // Prefer abort reason over a bare AbortError from fetch/read.
        reject(signal.aborted ? (signal.reason ?? error) : error);
      },
    );
  });
}

function cancelResponse(response: Response): void {
  try {
    void Promise.resolve(response.body?.cancel()).catch(() => undefined);
  } catch {
    // Response cleanup is best-effort.
  }
}

export const dictation = new Dictation();
