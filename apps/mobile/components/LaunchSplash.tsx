import { useEffect, useRef } from "react";
import { AccessibilityInfo, Animated, Easing, Image, StyleSheet, View } from "react-native";
import { mobileTokens } from "../lib/appearance";

/**
 * The app's own greeting, held over the web view until the page behind it has something
 * to show.
 *
 * The system splash goes as soon as React mounts, and what showed through in the gap was
 * the loading screen of the project this app is forked from — someone else's character,
 * on our launch. This is the same picture the system splash uses, so the handover is the
 * moment it starts breathing rather than a cut to a different image.
 *
 * `onGone` fires after the exit, not when `visible` turns false, so the caller can keep
 * the web view covered until the fade has actually finished.
 */

/** The mascot's own orange. The halo is the one place the brand colour appears here. */
const HALO = "#F26A1B";

const ENTER_MS = 260;
const EXIT_MS = 280;
const BREATH_MS = 1_500;
const HALO_MS = 2_400;

export function LaunchSplash({ visible, onGone }: { visible: boolean; onGone: () => void }) {
  const tokens = mobileTokens();
  const enter = useRef(new Animated.Value(0)).current;
  const breath = useRef(new Animated.Value(0)).current;
  const halo = useRef(new Animated.Value(0)).current;
  const onGoneRef = useRef(onGone);
  onGoneRef.current = onGone;

  // Arrive, then keep breathing. Both are decorative: someone who has asked for less
  // motion gets the mascot standing still rather than no mascot at all.
  useEffect(() => {
    let cancelled = false;
    const loops: Animated.CompositeAnimation[] = [];
    Animated.timing(enter, {
      toValue: 1,
      duration: ENTER_MS,
      easing: Easing.out(Easing.back(1.6)),
      useNativeDriver: true,
    }).start();

    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled || reduced) return;
      const cycle = (value: Animated.Value, duration: number) =>
        Animated.loop(
          Animated.sequence([
            Animated.timing(value, {
              toValue: 1,
              duration: duration / 2,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(value, {
              toValue: 0,
              duration: duration / 2,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
          ]),
        );
      loops.push(cycle(breath, BREATH_MS), cycle(halo, HALO_MS));
      for (const loop of loops) loop.start();
    });

    return () => {
      cancelled = true;
      for (const loop of loops) loop.stop();
    };
  }, [breath, enter, halo]);

  useEffect(() => {
    if (visible) return;
    Animated.timing(enter, {
      toValue: 2,
      duration: EXIT_MS,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(() => onGoneRef.current());
  }, [enter, visible]);

  // 0 arriving, 1 settled, 2 leaving — one value drives the whole life of the screen.
  const opacity = enter.interpolate({ inputRange: [0, 1, 2], outputRange: [0, 1, 0] });
  const scale = enter.interpolate({ inputRange: [0, 1, 2], outputRange: [0.86, 1, 1.08] });
  const lift = breath.interpolate({ inputRange: [0, 1], outputRange: [0, -10] });

  return (
    <View
      // The greeting is decoration over a page that is still loading; a screen reader
      // should be told about the page, not about this.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      // Touches stop here. A tap during the greeting would otherwise land on a page the
      // viewer cannot see yet.
      style={[styles.fill, { backgroundColor: tokens.background }]}
    >
      <Animated.View style={[styles.centre, { opacity, transform: [{ scale }] }]}>
        <Animated.View
          style={[
            styles.halo,
            {
              borderColor: HALO,
              opacity: halo.interpolate({ inputRange: [0, 1], outputRange: [0.32, 0] }),
              transform: [
                { scale: halo.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1.3] }) },
              ],
            },
          ]}
        />
        <Animated.View style={{ transform: [{ translateY: lift }] }}>
          <Image source={require("../assets/splash-icon.png")} style={styles.mascot} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },
  halo: { position: "absolute", height: 210, width: 210, borderRadius: 105, borderWidth: 2 },
  mascot: { height: 148, width: 148 },
});
