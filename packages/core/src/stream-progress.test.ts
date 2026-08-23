import { describe, expect, it } from "vitest";
import { createStreamProgressFlusher } from "./stream-progress.js";

function createClock() {
  let now = 0;
  const timers: { at: number; fn: () => void }[] = [];
  return {
    now: () => now,
    schedule: (fn: () => void, ms: number) => {
      const timer = { at: now + ms, fn };
      timers.push(timer);
      return {
        cancel() {
          const index = timers.indexOf(timer);
          if (index >= 0) timers.splice(index, 1);
        },
      };
    },
    async advance(ms: number) {
      now += ms;
      const due = timers.filter((timer) => timer.at <= now).sort((a, b) => a.at - b.at);
      for (const timer of due) {
        const index = timers.indexOf(timer);
        if (index >= 0) timers.splice(index, 1);
        timer.fn();
      }
      await Promise.resolve();
    },
  };
}

describe("createStreamProgressFlusher", () => {
  it("batches tokens while a slow publish is in flight instead of writing each chunk", async () => {
    const clock = createClock();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const publishes: string[] = [];
    const started: string[] = [];
    const flusher = createStreamProgressFlusher({
      intervalMs: 250,
      now: clock.now,
      schedule: clock.schedule,
      publish: async (delta) => {
        started.push(delta);
        await gate;
        publishes.push(delta);
      },
    });

    flusher.push("H");
    await clock.advance(250);
    expect(started).toEqual(["H"]);
    expect(publishes).toEqual([]);

    flusher.push("e");
    await clock.advance(300);
    flusher.push("l");
    flusher.push("l");
    flusher.push("o");
    expect(started).toEqual(["H"]);

    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(publishes).toEqual(["H"]);
    expect(started).toEqual(["H", "ello"]);

    await flusher.flush();
    expect(publishes).toEqual(["H", "ello"]);
  });

  it("does not start a second publish until the interval elapses when writes are fast", async () => {
    const clock = createClock();
    const publishes: string[] = [];
    const flusher = createStreamProgressFlusher({
      intervalMs: 50,
      now: clock.now,
      schedule: clock.schedule,
      publish: async (delta) => {
        publishes.push(delta);
      },
    });

    flusher.push("ab");
    await clock.advance(50);
    await Promise.resolve();
    expect(publishes).toEqual(["ab"]);

    flusher.push("c");
    await clock.advance(20);
    await Promise.resolve();
    expect(publishes).toEqual(["ab"]);

    await clock.advance(30);
    await Promise.resolve();
    expect(publishes).toEqual(["ab", "c"]);
  });

  it("flush publishes the remainder and waits for the in-flight write", async () => {
    const clock = createClock();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const publishes: string[] = [];
    const flusher = createStreamProgressFlusher({
      intervalMs: 50,
      now: clock.now,
      schedule: clock.schedule,
      publish: async (delta) => {
        await gate;
        publishes.push(delta);
      },
    });

    flusher.push("hi");
    const flushed = flusher.flush();
    await Promise.resolve();
    expect(publishes).toEqual([]);
    release();
    await flushed;
    expect(publishes).toEqual(["hi"]);
  });

  it("surfaces a background publish failure on flush", async () => {
    const clock = createClock();
    const flusher = createStreamProgressFlusher({
      intervalMs: 10,
      now: clock.now,
      schedule: clock.schedule,
      publish: async () => {
        throw new Error("notify failed");
      },
    });

    flusher.push("x");
    await clock.advance(10);
    await Promise.resolve();
    await expect(flusher.flush()).rejects.toThrow("notify failed");
  });
});
