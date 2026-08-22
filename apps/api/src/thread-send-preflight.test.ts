import { describe, expect, it, vi } from "vitest";
import { checkThreadSendPreflight } from "./thread-send-preflight.js";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("checkThreadSendPreflight", () => {
  it("starts the teaching guard and nonce lookup without waiting for either one", async () => {
    const teaching = deferred<void>();
    const duplicate = deferred<{ id: string } | null>();
    const assertTeachingAllowed = vi.fn(() => teaching.promise);
    const findDuplicateRun = vi.fn(() => duplicate.promise);

    const checked = checkThreadSendPreflight({ assertTeachingAllowed, findDuplicateRun });

    expect(assertTeachingAllowed).toHaveBeenCalledOnce();
    expect(findDuplicateRun).toHaveBeenCalledOnce();
    duplicate.resolve({ id: "run-1" });
    let settled = false;
    void checked.finally(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    teaching.resolve();
    await expect(checked).resolves.toEqual({ id: "run-1" });
  });

  it("does not return a duplicate run when teaching is active", async () => {
    const teachingError = new Error("Stop teaching first");

    await expect(
      checkThreadSendPreflight({
        assertTeachingAllowed: () => Promise.reject(teachingError),
        findDuplicateRun: () => Promise.resolve({ id: "run-1" }),
      }),
    ).rejects.toBe(teachingError);
  });

  it("does not perform a nonce lookup when no nonce was supplied", async () => {
    const assertTeachingAllowed = vi.fn(() => Promise.resolve());

    await expect(checkThreadSendPreflight({ assertTeachingAllowed })).resolves.toBeNull();
    expect(assertTeachingAllowed).toHaveBeenCalledOnce();
  });
});
