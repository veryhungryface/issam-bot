import { describe, expect, it } from "vitest";
import {
  isLightColor,
  isShellUrl,
  parseShellMessage,
  shellHomeUrl,
  shellNotificationUrl,
} from "./shell-url";

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
describe("shell messages", () => {
  it("reads the page's theme colour", () => {
    expect(parseShellMessage(JSON.stringify({ type: "theme", color: "#fafaf8" }))).toEqual({
      themeColor: "#fafaf8",
    });
  });

  it("ignores anything that is not a colour we can paint with", () => {
    for (const raw of [
      "not json",
      JSON.stringify({ type: "theme" }),
      JSON.stringify({ type: "theme", color: "rebeccapurple" }),
      JSON.stringify({ type: "theme", color: "javascript:alert(1)" }),
      JSON.stringify({ type: "other", color: "#fff" }),
      JSON.stringify(null),
    ]) {
      expect(parseShellMessage(raw)).toBeNull();
    }
  });

  it("picks the status-bar style the page can be read against", () => {
    expect(isLightColor("#fafaf8")).toBe(true);
    expect(isLightColor("#fff")).toBe(true);
    expect(isLightColor("#0d0d0e")).toBe(false);
    expect(isLightColor("#2965EC")).toBe(false);
    expect(isLightColor("zzz")).toBe(false);
  });
});
