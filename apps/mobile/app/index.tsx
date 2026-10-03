import Constants from "expo-constants";
import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, BackHandler, Platform, StyleSheet, View } from "react-native";
import { WebView, type WebViewNavigation } from "react-native-webview";
import { loadApiBase } from "../lib/api";
import { mobileTokens } from "../lib/appearance";
import { clearDeliveredNotifications, obtainPushToken } from "../lib/shell-push";
import { isShellUrl, shellHomeUrl, shellNotificationUrl } from "../lib/shell-url";

/**
 * The phone app is the web app, in a shell.
 *
 * Two screens drawn by two codebases drift: the phone was missing the sign-in sheet, the
 * status lines, progress, choices and charts the browser draws, and every future change
 * would have had to be made twice. Showing the same pages means the phone is never behind,
 * and a change to the web reaches it without a new build.
 *
 * What stays native is what a browser cannot do: holding the push token the operating
 * system issued, landing a tapped notification on the right conversation, clearing the tray
 * when the app comes forward, and keeping the hardware back button meaningful.
 */

/** Long enough for a cold permission prompt, short enough not to feel like a hang. */
const TOKEN_WAIT_MS = 8_000;

export default function Shell() {
  const tokens = mobileTokens();
  const webView = useRef<WebView>(null);
  const canGoBack = useRef(false);
  const [origin, setOrigin] = useState<string | null>(null);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [uri, setUri] = useState<string | null>(null);

  // Resolve the server and the push token before the first page load, so the page can
  // register the token in the same breath as it finds the session.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const base = await loadApiBase().catch(() => null);
      const projectId =
        Constants.easConfig?.projectId ??
        (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId;
      const token = await Promise.race([
        obtainPushToken(projectId).catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), TOKEN_WAIT_MS)),
      ]);
      if (cancelled) return;
      const resolved = base ?? null;
      setPushToken(token);
      setOrigin(resolved);
      setUri(resolved ? shellHomeUrl(resolved) : null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // A notification that is still in the tray keeps a dot on the launcher icon, and opening
  // the app does not take it away. If the app is in front, the user has seen it.
  useEffect(() => {
    void clearDeliveredNotifications();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void clearDeliveredNotifications();
    });
    return () => subscription.remove();
  }, []);

  // Tapping a notification opens the conversation it came from, cold start included.
  useEffect(() => {
    if (!origin) return;
    let cancelled = false;
    const open = (data: Record<string, unknown> | null | undefined) => {
      if (cancelled) return;
      setUri(shellNotificationUrl(origin, data));
      void clearDeliveredNotifications();
    };
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) open(response.notification.request.content.data);
    });
    const subscription = Notifications.addNotificationResponseReceivedListener((response) =>
      open(response.notification.request.content.data),
    );
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [origin]);

  // Android's back button means "back" inside the app before it means "leave the app".
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!canGoBack.current) return false;
      webView.current?.goBack();
      return true;
    });
    return () => subscription.remove();
  }, []);

  const injected = useMemo(
    () =>
      `window.__ISSAM_NATIVE__ = ${JSON.stringify({
        pushToken,
        platform: Platform.OS,
      })}; true;`,
    [pushToken],
  );

  const onNavigation = useCallback((event: WebViewNavigation) => {
    canGoBack.current = event.canGoBack;
  }, []);

  // A bot works on other people's websites. Their links belong in the phone's browser.
  const onRequest = useCallback(
    (request: { url: string }) => {
      if (!origin || isShellUrl(origin, request.url)) return true;
      void Linking.openURL(request.url).catch(() => undefined);
      return false;
    },
    [origin],
  );

  if (!uri) {
    return (
      <View style={[styles.center, { backgroundColor: tokens.background }]}>
        <ActivityIndicator color={tokens.foreground} />
      </View>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: tokens.background }]}>
      <WebView
        ref={webView}
        source={{ uri }}
        style={[styles.fill, { backgroundColor: tokens.background }]}
        injectedJavaScriptBeforeContentLoaded={injected}
        onNavigationStateChange={onNavigation}
        onShouldStartLoadWithRequest={onRequest}
        // The session is a cookie this view owns; without these it is dropped on relaunch.
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        domStorageEnabled
        javaScriptEnabled
        allowsBackForwardNavigationGestures
        pullToRefreshEnabled
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback
        startInLoadingState
        renderLoading={() => (
          <View style={[styles.center, { backgroundColor: tokens.background }]}>
            <ActivityIndicator color={tokens.foreground} />
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
  },
});
