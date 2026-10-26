import { describe, expect, it } from "vitest";
import {
  BROWSER_DEVICE_ONLINE_WINDOW_MS,
  BROWSER_JOB_CLAIM_TIMEOUT_MS,
  BROWSER_JOB_PROMPT_MAX,
  BROWSER_JOB_QUEUE_TIMEOUT_MS,
  browserJobHasExpired,
  formatBrowserJobHandoff,
  formatBrowserJobReport,
  isBrowserDeviceOnline,
  isBrowserJobReportableStatus,
  normalizeBrowserDeviceName,
  normalizeBrowserJobPrompt,
  normalizeBrowserJobResult,
} from "./browser-device.js";

const now = new Date("2026-10-26T09:00:00.000Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

describe("browser device reachability", () => {
  it("counts a device that polled inside the window, and no other", () => {
    expect(isBrowserDeviceOnline(ago(1_000), now)).toBe(true);
    expect(isBrowserDeviceOnline(ago(BROWSER_DEVICE_ONLINE_WINDOW_MS), now)).toBe(true);
    expect(isBrowserDeviceOnline(ago(BROWSER_DEVICE_ONLINE_WINDOW_MS + 1), now)).toBe(false);
  });

  it("treats a device that has never called home as offline, not as new", () => {
    // A freshly paired device has no lastSeenAt. Handing it work would queue into the dark.
    expect(isBrowserDeviceOnline(null, now)).toBe(false);
    expect(isBrowserDeviceOnline(undefined, now)).toBe(false);
  });

  it("does not trust a timestamp from the future", () => {
    // A machine with a skewed clock must not be able to call itself permanently awake.
    expect(isBrowserDeviceOnline(new Date(now.getTime() + 5_000), now)).toBe(false);
  });
});

describe("browser job expiry", () => {
  it("writes off a claimed task whose machine went quiet", () => {
    const base = { status: "claimed", createdAt: ago(60 * 60_000) };
    expect(
      browserJobHasExpired({ ...base, claimedAt: ago(BROWSER_JOB_CLAIM_TIMEOUT_MS - 1) }, now),
    ).toBe(false);
    expect(
      browserJobHasExpired({ ...base, claimedAt: ago(BROWSER_JOB_CLAIM_TIMEOUT_MS + 1) }, now),
    ).toBe(true);
  });

  it("falls back to the created time when a claim somehow has no timestamp", () => {
    expect(
      browserJobHasExpired(
        { status: "claimed", createdAt: ago(BROWSER_JOB_CLAIM_TIMEOUT_MS + 1), claimedAt: null },
        now,
      ),
    ).toBe(true);
  });

  it("drops a queued task nobody ever picked up", () => {
    const queued = (age: number) => ({ status: "queued", createdAt: ago(age), claimedAt: null });
    expect(browserJobHasExpired(queued(BROWSER_JOB_QUEUE_TIMEOUT_MS - 1), now)).toBe(false);
    expect(browserJobHasExpired(queued(BROWSER_JOB_QUEUE_TIMEOUT_MS + 1), now)).toBe(true);
  });

  it("leaves finished work alone however old it is", () => {
    for (const status of ["done", "error", "expired"]) {
      expect(
        browserJobHasExpired({ status, createdAt: ago(400 * 60_000), claimedAt: null }, now),
      ).toBe(false);
    }
  });
});

describe("what crosses to the device and back", () => {
  it("caps the instruction so a model cannot post a whole thread to someone's PC", () => {
    const long = "가".repeat(BROWSER_JOB_PROMPT_MAX + 500);
    expect(normalizeBrowserJobPrompt(long)).toHaveLength(BROWSER_JOB_PROMPT_MAX);
    expect(normalizeBrowserJobPrompt("  성적표 받아줘  ")).toBe("성적표 받아줘");
  });

  it("refuses an empty or non-string instruction rather than sending a blank task", () => {
    expect(normalizeBrowserJobPrompt("")).toBeNull();
    expect(normalizeBrowserJobPrompt("   ")).toBeNull();
    expect(normalizeBrowserJobPrompt(undefined)).toBeNull();
    expect(normalizeBrowserJobPrompt(42)).toBeNull();
  });

  it("turns a silent result into a sentence, because the teacher reads this", () => {
    expect(normalizeBrowserJobResult("")).toBe("결과 설명 없이 끝났습니다.");
    expect(normalizeBrowserJobResult(null)).toBe("결과 설명 없이 끝났습니다.");
    expect(normalizeBrowserJobResult("  저장함  ")).toBe("저장함");
  });

  it("only lets the extension report an outcome it could have reached", () => {
    expect(isBrowserJobReportableStatus("done")).toBe(true);
    expect(isBrowserJobReportableStatus("error")).toBe(true);
    // The queue's own states are the server's to set, not the device's.
    expect(isBrowserJobReportableStatus("queued")).toBe(false);
    expect(isBrowserJobReportableStatus("claimed")).toBe(false);
    expect(isBrowserJobReportableStatus("expired")).toBe(false);
    expect(isBrowserJobReportableStatus(undefined)).toBe(false);
  });

  it("tidies a device name without letting it run to a paragraph", () => {
    expect(normalizeBrowserDeviceName("  교무실   노트북 ")).toBe("교무실 노트북");
    expect(normalizeBrowserDeviceName("")).toBeNull();
    expect(normalizeBrowserDeviceName("나".repeat(200))).toHaveLength(60);
  });
});

describe("what the teacher is told", () => {
  it("names the machine, because a teacher can have more than one", () => {
    const done = formatBrowserJobReport({
      deviceName: "교무실 노트북",
      status: "done",
      result: "성적표 3개를 저장했어요.",
    });
    expect(done).toContain("교무실 노트북");
    expect(done).toContain("성적표 3개를 저장했어요.");
    expect(formatBrowserJobHandoff("교무실 노트북")).toContain("교무실 노트북");
  });

  it("says plainly that it failed instead of dressing it up", () => {
    const failed = formatBrowserJobReport({
      deviceName: "집 PC",
      status: "error",
      result: "로그인 화면에서 막혔어요.",
    });
    expect(failed).toContain("실패");
    expect(failed).toContain("로그인 화면에서 막혔어요.");
  });
});
