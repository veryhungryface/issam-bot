import Constants from "expo-constants";
import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, BackHandler, Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView, type WebViewNavigation } from "react-native-webview";
import { LaunchIntro } from "../components/LaunchIntro";
import { loadApiBase } from "../lib/api";
import { mobileTokens } from "../lib/appearance";
import { coverHoldMs } from "../lib/launch-intro";
import { clearDeliveredNotifications, obtainPushToken } from "../lib/shell-push";
import {
  isLightColor,
  opensOutsideShell,
  parseShellMessage,
  shellHomeUrl,
  shellNotificationUrl,
} from "../lib/shell-url";

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

/**
 * Tells the shell what colour the page is, so the strips behind the status bar and the
 * navigation bar belong to the page rather than framing it in another theme's colour. The
 * web app keeps `theme-color` in step with the light or dark choice, so watching it is
 * enough; the observer catches a change made while the app is open.
 */
const WATCH_THEME_COLOR = `(function () {
  var send = function () {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta || !window.ReactNativeWebView) return;
    window.ReactNativeWebView.postMessage(
      JSON.stringify({ type: "theme", color: meta.getAttribute("content") })
    );
  };
  send();
  new MutationObserver(send).observe(document.head, {
    subtree: true,
    attributes: true,
    attributeFilter: ["content"],
  });
})(); true;`;

export default function Shell() {
  const tokens = mobileTokens();
  // Android draws the web view under the status and navigation bars, so without this the
  // header sits beneath the clock and the composer beneath the gesture bar. iOS insets a
  // web view itself, which is why this only looked broken on one of them.
  const insets = useSafeAreaInsets();
  const [pageColor, setPageColor] = useState<string | null>(null);
  const webView = useRef<WebView>(null);
  const canGoBack = useRef(false);
  const [origin, setOrigin] = useState<string | null>(null);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  // The intro plays once and then waits to be tapped. The cover under it outlives the
  // tap: `painted` is the page saying it has something to show, and until it does, what
  // would come through is the loading screen of the project this app is forked from.
  const [pagePainted, setPagePainted] = useState(false);
  const [introUp, setIntroUp] = useState(true);
  const [coverUp, setCoverUp] = useState(true);
  const coverSince = useRef(Date.now());

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
      // Someone who tapped a notification is on their way to a message. An opening
      // sequence between them and it is in the way, however good it is.
      setIntroUp(false);
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

  const onMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    const message = parseShellMessage(event.nativeEvent.data);
    if (!message) return;
    if (message.type === "painted") setPagePainted(true);
    else setPageColor(message.themeColor);
  }, []);

  // Once the intro is gone the cover goes as soon as the page has something to show, and
  // at the ceiling regardless, so a silent page cannot strand anyone behind a blank screen.
  useEffect(() => {
    if (!coverUp || introUp) return;
    const timer = setTimeout(
      () => setCoverUp(false),
      coverHoldMs({ heldForMs: Date.now() - coverSince.current, pagePainted }),
    );
    return () => clearTimeout(timer);
  }, [coverUp, introUp, pagePainted]);

  // A bot works on other people's websites. Their links belong in the phone's browser —
  // but only when the user actually went there, never when the page embeds them.
  const onRequest = useCallback(
    (request: { url: string; isTopFrame: boolean }) => {
      if (!opensOutsideShell({ origin, url: request.url, isTopFrame: request.isTopFrame })) {
        return true;
      }
      void Linking.openURL(request.url).catch(() => undefined);
      return false;
    },
    [origin],
  );

  const background = pageColor ?? tokens.background;

  return (
    <View style={[styles.fill, { backgroundColor: background }]}>
      <StatusBar style={isLightColor(background) ? "dark" : "light"} />
      <View
        style={[
          styles.fill,
          {
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
            paddingLeft: insets.left,
            paddingRight: insets.right,
          },
        ]}
      >
        {uri ? (
          <WebView
            onMessage={onMessage}
            injectedJavaScript={WATCH_THEME_COLOR}
            ref={webView}
            source={{ uri }}
            style={[styles.fill, { backgroundColor: background }]}
            injectedJavaScriptBeforeContentLoaded={injected}
            onNavigationStateChange={onNavigation}
            onShouldStartLoadWithRequest={onRequest}
            // The session is a cookie this view owns; without these it is dropped on relaunch.
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            domStorageEnabled
            javaScriptEnabled
            // The left edge belongs to the bot list, which swipes out from there. iOS
            // would otherwise read that as its own back gesture and leave the
            // conversation instead.
            allowsBackForwardNavigationGestures={false}
            // The page never scrolls as a page, so a rubber-band pull only showed the
            // frame the app is sitting in, and let go of a reload nobody asked for.
            bounces={false}
            mediaPlaybackRequiresUserAction={false}
            allowsInlineMediaPlayback
          />
        ) : null}
      </View>
      {coverUp ? (
        <View style={[styles.cover, { backgroundColor: tokens.background }]}>
          {introUp ? <LaunchIntro onDismiss={() => setIntroUp(false)} /> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  cover: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
});
