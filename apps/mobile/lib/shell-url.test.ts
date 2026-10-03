import { describe, expect, it } from "vitest";
import { isShellUrl, shellHomeUrl, shellNotificationUrl } from "./shell-url";

const ORIGIN = "https://issam-bot.vercel.app";

describe("shell urls", () => {
  it("opens the signed-in home", () => {
    expect(shellHomeUrl(ORIGIN)).toBe("https://issam-bot.vercel.app/app");
    expect(shellHomeUrl("https://issam-bot.vercel.app/")).toBe("https://issam-bot.vercel.app/app");
  });

  it("lands a notification on the conversation it came from", () => {
    expect(shellNotificationUrl(ORIGIN, { botId: "bot-1" })).toBe(`${ORIGIN}/app/bot-1`);
    expect(shellNotificationUrl(ORIGIN, { groupId: "group-1" })).toBe(`${ORIGIN}/app/g/group-1`);
    // A group notification also names a bot; the group is the thread that was read.
    expect(shellNotificationUrl(ORIGIN, { botId: "bot-1", groupId: "group-1" })).toBe(
      `${ORIGIN}/app/g/group-1`,
    );
  });

  it("accepts the prefixed keys older payloads use", () => {
    expect(shellNotificationUrl(ORIGIN, { "rakazo.botId": "bot-9" })).toBe(`${ORIGIN}/app/bot-9`);
  });

  it("falls back to the home when a notification names nothing", () => {
    for (const data of [null, undefined, {}, { botId: "" }, { botId: 42 }]) {
      expect(shellNotificationUrl(ORIGIN, data as Record<string, unknown>)).toBe(`${ORIGIN}/app`);
    }
  });

  it("keeps foreign links out of the app", () => {
    // A bot works on other people's sites; their login pages must not open in here.
    expect(isShellUrl(ORIGIN, `${ORIGIN}/app/bot-1`)).toBe(true);
    expect(isShellUrl(ORIGIN, "https://portal.example/login")).toBe(false);
    expect(isShellUrl(ORIGIN, "not a url")).toBe(false);
  });
});
