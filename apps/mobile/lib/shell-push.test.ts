import { beforeEach, describe, expect, it, vi } from "vitest";

const notifications = vi.hoisted(() => ({
  dismissAllNotificationsAsync: vi.fn(async () => undefined),
  setBadgeCountAsync: vi.fn(async () => true),
  getPermissionsAsync: vi.fn(async () => ({ granted: false })),
  requestPermissionsAsync: vi.fn(async () => ({ granted: false })),
  getExpoPushTokenAsync: vi.fn(async () => ({ data: "ExponentPushToken[abc123def456]" })),
}));

vi.mock("expo-notifications", () => notifications);

const { clearDeliveredNotifications, obtainPushToken } = await import("./shell-push");

beforeEach(() => {
  for (const fn of Object.values(notifications)) fn.mockClear();
});

describe("clearDeliveredNotifications", () => {
  it("clears the tray and the badge together", async () => {
    await clearDeliveredNotifications();
    expect(notifications.dismissAllNotificationsAsync).toHaveBeenCalledTimes(1);
    expect(notifications.setBadgeCountAsync).toHaveBeenCalledWith(0);
  });

  it("still clears the badge when dismissing throws", async () => {
    // The launcher dot is the part the user complained about; it must not depend on the other.
    notifications.dismissAllNotificationsAsync.mockRejectedValueOnce(new Error("no"));
    await expect(clearDeliveredNotifications()).resolves.toBeUndefined();
    expect(notifications.setBadgeCountAsync).toHaveBeenCalledWith(0);
  });
});

describe("obtainPushToken", () => {
  it("returns nothing without a project id to mint against", async () => {
    expect(await obtainPushToken(undefined)).toBeNull();
    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it("asks for permission once and returns the token", async () => {
    notifications.requestPermissionsAsync.mockResolvedValueOnce({ granted: true });
    expect(await obtainPushToken("project-1")).toBe("ExponentPushToken[abc123def456]");
  });

  it("does not ask again when permission is already granted", async () => {
    notifications.getPermissionsAsync.mockResolvedValueOnce({ granted: true });
    expect(await obtainPushToken("project-1")).toBe("ExponentPushToken[abc123def456]");
    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it("returns nothing when the user refuses", async () => {
    expect(await obtainPushToken("project-1")).toBeNull();
    expect(notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
  });

  it("survives a build that cannot mint a token", async () => {
    notifications.getPermissionsAsync.mockResolvedValueOnce({ granted: true });
    notifications.getExpoPushTokenAsync.mockRejectedValueOnce(new Error("Expo Go"));
    expect(await obtainPushToken("project-1")).toBeNull();
  });
});
