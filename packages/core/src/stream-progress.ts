export const STREAM_PROGRESS_FLUSH_MS = 50;

export interface StreamProgressFlusher {
  push(chunk: string): void;
  flush(): Promise<void>;
}

export interface StreamProgressFlusherOptions {
  publish: (delta: string) => Promise<void>;
  intervalMs?: number;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => { cancel: () => void };
}

export function createStreamProgressFlusher(
  options: StreamProgressFlusherOptions,
): StreamProgressFlusher {
  const intervalMs = options.intervalMs ?? STREAM_PROGRESS_FLUSH_MS;
  const now = options.now ?? Date.now;
  const schedule =
    options.schedule ??
    ((callback, delayMs) => {
      const timer = setTimeout(callback, delayMs);
      return { cancel: () => clearTimeout(timer) };
    });

  let pending = "";
  let inFlight: Promise<void> | undefined;
  let lastStartedAt = 0;
  let timer: { cancel: () => void } | undefined;
  let failed: unknown;

  const startFlush = () => {
    if (inFlight || !pending || failed) return;
    const delta = pending;
    pending = "";
    lastStartedAt = now();
    inFlight = options.publish(delta).then(
      () => {
        inFlight = undefined;
        armTimer();
      },
      (error) => {
        inFlight = undefined;
        failed = error;
      },
    );
  };

  const armTimer = () => {
    if (inFlight || !pending || failed || timer) return;
    const wait =
      lastStartedAt === 0 ? intervalMs : Math.max(0, intervalMs - (now() - lastStartedAt));
    if (wait === 0) {
      startFlush();
      return;
    }
    timer = schedule(() => {
      timer = undefined;
      startFlush();
    }, wait);
  };

  return {
    push(chunk: string) {
      if (!chunk || failed) return;
      pending += chunk;
      armTimer();
    },
    async flush() {
      timer?.cancel();
      timer = undefined;
      if (inFlight) await inFlight;
      if (failed) throw failed;
      while (pending) {
        startFlush();
        if (inFlight) await inFlight;
        if (failed) throw failed;
      }
    },
  };
}
