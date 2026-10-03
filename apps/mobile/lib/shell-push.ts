import * as Notifications from "expo-notifications";

/**
 * What the shell does with notifications, separate from React so it can be tested.
 *
 * The complaint this exists for: a notification arrived, the user opened the app, read the
 * reply - and the launcher still showed a badge. Android keeps a notification (and its dot)
 * until something dismisses it, and opening the app is not that. So the shell clears them
 * whenever it comes to the front: if the app is open, the user is looking at it.
 */

export async function clearDeliveredNotifications(): Promise<void> {
  // Each call is independent: a failure to clear one must not leave the other stale.
  await Promise.allSettled([
    Notifications.dismissAllNotificationsAsync(),
    Notifications.setBadgeCountAsync(0),
  ]);
}

/**
 * The Expo push token for this install, or null when there is nothing to register - the
 * permission was refused, or this is a build with no project id to mint one against.
 */
export async function obtainPushToken(projectId: string | undefined): Promise<string | null> {
  if (!projectId) return null;
  const existing = await Notifications.getPermissionsAsync();
  const granted =
    existing.granted || (await Notifications.requestPermissionsAsync()).granted === true;
  if (!granted) return null;
  try {
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    return token?.trim() ? token : null;
  } catch {
    // Expo Go and the simulator cannot mint one; the app still works without push.
    return null;
  }
}
