import { useEffect, useMemo, useRef } from "react";
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { mobileTokens } from "../lib/appearance";
import { useI18n } from "../lib/i18n";
import { INTRO_SCORE } from "../lib/launch-intro";

/**
 * The opening sequence.
 *
 * Drawn rather than filmed: the mark is the same four-point star the app icon is built
 * from, as a path, so the whole thing is a few shapes and costs nothing to ship — a video
 * would be a megabyte of asset that could not go out over the air. It plays once, then
 * waits, because arriving somewhere should be the viewer's decision and not a timer's.
 */

/** The mascot's own colours. The brand only ever appears here as these four. */
const ORANGE = "#F26A1B";
const SPARK = "#F5B823";
const CHEEK = "#F0A09A";
const INK = "#141416";

/**
 * The silhouette the icon pipeline draws (see `scripts/build-icons.mjs`): a plump
 * four-point star. Shared by eye rather than by import — that script runs in Node at
 * build time and bundling it here to read one constant would be the wrong trade.
 */
const STAR =
  "M50.00 3.00 C63.46 3.00 60.88 12.80 74.04 25.96 C87.20 39.12 97.00 36.54 97.00 50.00 C97.00 63.46 87.20 60.88 74.04 74.04 C60.88 87.20 63.46 97.00 50.00 97.00 C36.54 97.00 39.12 87.20 25.96 74.04 C12.80 60.88 3.00 63.46 3.00 50.00 C3.00 36.54 12.80 39.12 25.96 25.96 C39.12 12.80 36.54 3.00 50.00 3.00 Z";

const EXIT_MS = 420;

export function LaunchIntro({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useI18n();
  const tokens = mobileTokens();
  const leaving = useRef(false);

  // One value per element, each 0 before its beat and 1 after it. The score decides when.
  const ring = useRef(new Animated.Value(0)).current;
  const mark = useRef(new Animated.Value(0)).current;
  const face = useRef(new Animated.Value(0)).current;
  const sparks = useRef(new Animated.Value(0)).current;
  const word = useRef(new Animated.Value(0)).current;
  const hint = useRef(new Animated.Value(0)).current;
  const exit = useRef(new Animated.Value(0)).current;
  const breath = useRef(new Animated.Value(0)).current;

  const values = useMemo(
    () => ({ ring, mark, face, sparks, word, hint }),
    [face, hint, mark, ring, sparks, word],
  );

  useEffect(() => {
    let cancelled = false;
    let idle: Animated.CompositeAnimation | undefined;

    const play = (reduced: boolean) => {
      if (cancelled) return;
      if (reduced) {
        // The sequence is the decoration; the screen and its way out are not. Someone who
        // has asked for less motion gets the finished picture instead of no picture.
        for (const value of Object.values(values)) value.setValue(1);
        return;
      }
      Animated.parallel(
        (Object.keys(values) as (keyof typeof values)[]).map((element) =>
          Animated.sequence([
            Animated.delay(INTRO_SCORE[element].at),
            Animated.timing(values[element], {
              toValue: 1,
              duration: INTRO_SCORE[element].lasts,
              easing: element === "mark" ? Easing.out(Easing.back(2)) : Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
          ]),
        ),
      ).start();

      idle = Animated.loop(
        Animated.sequence([
          Animated.delay(INTRO_SCORE.hint.at),
          Animated.timing(breath, {
            toValue: 1,
            duration: 900,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(breath, {
            toValue: 0,
            duration: 900,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      );
      idle.start();
    };

    void AccessibilityInfo.isReduceMotionEnabled()
      .then(play)
      .catch(() => play(false));

    return () => {
      cancelled = true;
      idle?.stop();
    };
  }, [breath, values]);

  function dismiss() {
    if (leaving.current) return;
    leaving.current = true;
    Animated.timing(exit, {
      toValue: 1,
      duration: EXIT_MS,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(onDismiss);
  }

  const sheetOpacity = exit.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const sheetScale = exit.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("Start")}
      onPress={dismiss}
      style={[styles.fill, { backgroundColor: tokens.background }]}
    >
      <Animated.View style={[styles.stage, { opacity: sheetOpacity }]}>
        <Animated.View style={[styles.stage, { transform: [{ scale: sheetScale }] }]}>
          <Animated.View
            style={[
              styles.ring,
              {
                borderColor: ORANGE,
                opacity: ring.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.5, 0] }),
                transform: [
                  { scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.15, 1.9] }) },
                ],
              },
            ]}
          />

          <Animated.View
            style={{
              opacity: mark,
              transform: [
                { scale: mark.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) },
                {
                  rotate: mark.interpolate({
                    inputRange: [0, 1],
                    outputRange: ["-32deg", "0deg"],
                  }),
                },
                {
                  translateY: breath.interpolate({ inputRange: [0, 1], outputRange: [0, -7] }),
                },
              ],
            }}
          >
            <Svg width={168} height={168} viewBox="0 0 100 100">
              <Path d={STAR} fill={ORANGE} />
            </Svg>
            <Animated.View style={[styles.faceLayer, { opacity: face }]}>
              <Svg width={168} height={168} viewBox="0 0 100 100">
                <Circle cx={31} cy={53} r={5.4} fill={CHEEK} />
                <Circle cx={69} cy={53} r={5.4} fill={CHEEK} />
                <Path
                  d="M32 47 Q38.5 39 45 47"
                  stroke={INK}
                  strokeWidth={4.2}
                  strokeLinecap="round"
                  fill="none"
                />
                <Path
                  d="M55 47 Q61.5 39 68 47"
                  stroke={INK}
                  strokeWidth={4.2}
                  strokeLinecap="round"
                  fill="none"
                />
                <Path d="M42 54 Q50 68 58 54 Z" fill={INK} />
              </Svg>
            </Animated.View>
          </Animated.View>

          <View style={styles.sparkRow}>
            {[0, 1, 2].map((index) => (
              <Animated.View
                key={index}
                style={[
                  styles.spark,
                  {
                    backgroundColor: SPARK,
                    opacity: sparks.interpolate({
                      inputRange: [0, 0.35 + index * 0.1, 1],
                      outputRange: [0, 0, 1],
                    }),
                    transform: [
                      {
                        translateY: sparks.interpolate({
                          inputRange: [0, 1],
                          outputRange: [34 + index * 6, 0],
                        }),
                      },
                      { rotate: `${(index - 1) * 14}deg` },
                    ],
                  },
                ]}
              />
            ))}
          </View>

          <Animated.Text
            style={[
              styles.word,
              {
                color: tokens.foreground,
                opacity: word,
                transform: [
                  { translateY: word.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
                ],
              },
            ]}
          >
            아이쌤봇
          </Animated.Text>
        </Animated.View>
      </Animated.View>

      <Animated.View style={[styles.hintRow, { opacity: Animated.multiply(hint, sheetOpacity) }]}>
        <Animated.Text
          style={[
            styles.hint,
            {
              color: tokens.mutedForeground,
              opacity: breath.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }),
            },
          ]}
        >
          {t("Tap to start")}
        </Animated.Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  stage: { flex: 1, alignItems: "center", justifyContent: "center" },
  ring: { position: "absolute", height: 180, width: 180, borderRadius: 90, borderWidth: 2 },
  faceLayer: { position: "absolute", top: 0, left: 0 },
  sparkRow: { flexDirection: "row", gap: 9, height: 26, marginTop: 14, alignItems: "flex-start" },
  spark: { height: 22, width: 7, borderRadius: 4 },
  word: { marginTop: 22, fontSize: 21, fontWeight: "700", letterSpacing: 1 },
  hintRow: { position: "absolute", bottom: 64, left: 0, right: 0, alignItems: "center" },
  hint: { fontSize: 13.5, letterSpacing: 0.4 },
});
