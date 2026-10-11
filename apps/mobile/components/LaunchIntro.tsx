import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, View } from "react-native";
import Svg, {
  Circle,
  Defs,
  Ellipse,
  Line,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from "react-native-svg";
import { mobileTokens } from "../lib/appearance";
import { useI18n } from "../lib/i18n";
import {
  INTRO_COMET,
  INTRO_DEBRIS,
  INTRO_DEBRIS_MS,
  INTRO_DEBRIS_REST,
  INTRO_DRIFT,
  INTRO_DUST_LANE,
  INTRO_FAINT_STARS,
  INTRO_GAS_FLARE,
  INTRO_MID_STARS,
  INTRO_NEBULA,
  INTRO_SCORE,
  INTRO_SKY_BOX,
  INTRO_SPIKE_STARS,
  INTRO_TWINKLE,
  INTRO_TWINKLE_FLOOR,
} from "../lib/launch-intro";

/**
 * The opening sequence.
 *
 * Drawn rather than filmed: the sky is three gradients and a few dozen circles, the mark
 * is the same four-point star the app icon is built from, as a path. The whole thing is
 * a handful of shapes and costs nothing to ship — a video would be a megabyte of asset
 * that could not go out over the air. It plays once, then waits, because arriving
 * somewhere should be the viewer's decision and not a timer's.
 *
 * A comet crosses the sky and does not stop until it is the mark. Everything after that
 * moment is lit by it: the flash, the ring leaving, the gas taking the light and giving
 * it back, the pieces thrown clear and left where they come to rest.
 */

/** The mascot's own colours. The brand only ever appears here as these four. */
const ORANGE = "#F26A1B";
const SPARK = "#F5B823";
const CHEEK = "#F0A09A";
const INK = "#141416";

/** The sky's own: not brand colours, but the night the brand arrives through. */
const SPACE = "#04050A";
const STARLIGHT = "#DCE6FF";
const FAR_STARLIGHT = "#AFC4FF";

/**
 * The silhouette the icon pipeline draws (see `scripts/build-icons.mjs`): a plump
 * four-point star. Shared by eye rather than by import — that script runs in Node at
 * build time and bundling it here to read one constant would be the wrong trade.
 */
const STAR =
  "M50.00 3.00 C63.46 3.00 60.88 12.80 74.04 25.96 C87.20 39.12 97.00 36.54 97.00 50.00 C97.00 63.46 87.20 60.88 74.04 74.04 C60.88 87.20 63.46 97.00 50.00 97.00 C36.54 97.00 39.12 87.20 25.96 74.04 C12.80 60.88 3.00 63.46 3.00 50.00 C3.00 36.54 12.80 39.12 25.96 25.96 C39.12 12.80 36.54 3.00 50.00 3.00 Z";

const EXIT_MS = 420;

/** The sky is drawn wider than the screen, so its drift never pulls an edge into view. */
const SKY_BLEED = 16;

export function LaunchIntro({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useI18n();
  const tokens = mobileTokens();
  const leaving = useRef(false);
  // "Reduce motion" asks for less movement, not for none. The sequence still plays in
  // order — it just arrives by fading rather than by flying, turning and bobbing, which
  // is the part that makes people queasy. Freezing the finished picture, which is what
  // this did before, reads on the phone as an animation that is broken.
  const [calm, setCalm] = useState(false);

  // One value per element, each 0 before its beat and 1 after it. The score decides when.
  const sky = useRef(new Animated.Value(0)).current;
  const gas = useRef(new Animated.Value(0)).current;
  const comet = useRef(new Animated.Value(0)).current;
  const flash = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const mark = useRef(new Animated.Value(0)).current;
  const face = useRef(new Animated.Value(0)).current;
  const sparks = useRef(new Animated.Value(0)).current;
  const word = useRef(new Animated.Value(0)).current;
  const hint = useRef(new Animated.Value(0)).current;
  const exit = useRef(new Animated.Value(0)).current;
  const breath = useRef(new Animated.Value(0)).current;
  const drift = useRef(new Animated.Value(0)).current;
  const debris = useRef(new Animated.Value(0)).current;
  // Each clock with the stars that keep it, built once: three groups that never come
  // back into step, and nothing to pair up wrong at the point of use.
  const twinkles = useRef(
    INTRO_TWINKLE.map((group, index) => ({
      ms: group.ms,
      stars: group.stars,
      spikes: INTRO_SPIKE_STARS.filter((spike) => spike.clock === index),
      value: new Animated.Value(1),
    })),
  ).current;

  const values = useMemo(
    () => ({ sky, gas, comet, flash, ring, mark, face, sparks, word, hint }),
    [comet, face, flash, gas, hint, mark, ring, sky, sparks, word],
  );

  useEffect(() => {
    let cancelled = false;
    const loops: Animated.CompositeAnimation[] = [];

    const play = (reduced: boolean) => {
      if (cancelled) return;
      setCalm(reduced);
      Animated.parallel(
        (Object.keys(values) as (keyof typeof values)[]).map((element) =>
          Animated.sequence([
            Animated.delay(INTRO_SCORE[element].at),
            Animated.timing(values[element], {
              toValue: 1,
              duration: INTRO_SCORE[element].lasts,
              easing: entrance(element, reduced),
              useNativeDriver: true,
            }),
          ]),
        ),
      ).start();

      // The pieces are thrown by the landing, so they leave from it rather than on a
      // beat of their own.
      Animated.sequence([
        Animated.delay(INTRO_SCORE.flash.at),
        Animated.timing(debris, {
          toValue: 1,
          duration: INTRO_DEBRIS_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();

      // Movement that never resolves is what reduce-motion is actually asking about: the
      // bob, the drifting sky, the breathing stars. The sequence itself still plays.
      if (reduced) return;

      loops.push(
        Animated.loop(
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
        ),
      );

      loops.push(
        Animated.loop(
          Animated.sequence([
            Animated.timing(drift, {
              toValue: 1,
              duration: INTRO_DRIFT.ms / 2,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: true,
            }),
            Animated.timing(drift, {
              toValue: 0,
              duration: INTRO_DRIFT.ms / 2,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: true,
            }),
          ]),
        ),
      );

      for (const twinkle of twinkles) {
        loops.push(
          Animated.loop(
            Animated.sequence([
              Animated.timing(twinkle.value, {
                toValue: INTRO_TWINKLE_FLOOR,
                duration: twinkle.ms / 2,
                easing: Easing.inOut(Easing.sin),
                useNativeDriver: true,
              }),
              Animated.timing(twinkle.value, {
                toValue: 1,
                duration: twinkle.ms / 2,
                easing: Easing.inOut(Easing.sin),
                useNativeDriver: true,
              }),
            ]),
          ),
        );
      }

      for (const loop of loops) loop.start();
    };

    void AccessibilityInfo.isReduceMotionEnabled()
      .then(play)
      .catch(() => play(false));

    return () => {
      cancelled = true;
      for (const loop of loops) loop.stop();
    };
  }, [breath, debris, drift, twinkles, values]);

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
  const sheetScale = exit.interpolate({ inputRange: [0, 1], outputRange: [1, calm ? 1 : 1.14] });
  const driftX = drift.interpolate({ inputRange: [0, 1], outputRange: [0, -INTRO_DRIFT.px] });
  const driftY = drift.interpolate({
    inputRange: [0, 1],
    outputRange: [0, INTRO_DRIFT.px * 0.55],
  });
  // The gas takes the light of the landing and gives it back over the next second.
  const gasLit = Animated.multiply(
    gas,
    flash.interpolate({ inputRange: [0, 0.35, 1], outputRange: [1, INTRO_GAS_FLARE, 1] }),
  );
  const away = comet.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const viewBox = `0 0 ${INTRO_SKY_BOX.width} ${INTRO_SKY_BOX.height}`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("Start")}
      onPress={dismiss}
      style={[styles.fill, { backgroundColor: SPACE }]}
    >
      <Animated.View style={[styles.fill, { opacity: sheetOpacity }]}>
        <Animated.View
          style={[styles.sky, { transform: [{ translateX: driftX }, { translateY: driftY }] }]}
          pointerEvents="none"
        >
          <Animated.View style={[styles.fill, { opacity: gasLit }]}>
            <Svg width="100%" height="100%" viewBox={viewBox}>
              <Defs>
                {INTRO_NEBULA.map((cloud) => (
                  <RadialGradient
                    key={cloud.color}
                    id={`cloud${cloud.color.slice(1)}`}
                    cx={cloud.cx}
                    cy={cloud.cy}
                    r={cloud.r}
                  >
                    <Stop offset="0" stopColor={cloud.color} stopOpacity={cloud.core} />
                    <Stop offset={cloud.midAt} stopColor={cloud.color} stopOpacity={cloud.mid} />
                    <Stop offset="1" stopColor={cloud.color} stopOpacity={0} />
                  </RadialGradient>
                ))}
                <RadialGradient id="lane" cx="50%" cy="50%" r="50%">
                  <Stop offset="0" stopColor={SPACE} stopOpacity={0.72} />
                  <Stop offset="1" stopColor={SPACE} stopOpacity={0} />
                </RadialGradient>
              </Defs>
              {INTRO_NEBULA.map((cloud) => (
                <Rect
                  key={cloud.color}
                  width={INTRO_SKY_BOX.width}
                  height={INTRO_SKY_BOX.height}
                  fill={`url(#cloud${cloud.color.slice(1)})`}
                />
              ))}
              <Ellipse
                cx={INTRO_DUST_LANE.cx}
                cy={INTRO_DUST_LANE.cy}
                rx={INTRO_DUST_LANE.rx}
                ry={INTRO_DUST_LANE.ry}
                transform={`rotate(${INTRO_DUST_LANE.turn} ${INTRO_DUST_LANE.cx} ${INTRO_DUST_LANE.cy})`}
                fill="url(#lane)"
              />
            </Svg>
          </Animated.View>

          <Animated.View style={[styles.fill, { opacity: sky }]}>
            <Svg width="100%" height="100%" viewBox={viewBox}>
              {INTRO_FAINT_STARS.map((star) => (
                <Circle
                  key={`${star.x}-${star.y}`}
                  cx={star.x}
                  cy={star.y}
                  r={star.r}
                  fill={FAR_STARLIGHT}
                  opacity={0.5}
                />
              ))}
              {INTRO_MID_STARS.map((star) => (
                <Circle
                  key={`${star.x}-${star.y}`}
                  cx={star.x}
                  cy={star.y}
                  r={star.r}
                  fill={STARLIGHT}
                  opacity={0.8}
                />
              ))}
            </Svg>
          </Animated.View>

          {twinkles.map((twinkle) => (
            <Animated.View
              key={twinkle.ms}
              style={[styles.fill, { opacity: Animated.multiply(sky, twinkle.value) }]}
            >
              <Svg width="100%" height="100%" viewBox={viewBox}>
                {twinkle.stars.map((star) => (
                  <Circle
                    key={`${star.x}-${star.y}`}
                    cx={star.x}
                    cy={star.y}
                    r={star.r}
                    fill={STARLIGHT}
                    opacity={0.85}
                  />
                ))}
                {twinkle.spikes.map((spike) => (
                  <Fragment key={`${spike.x}-${spike.y}`}>
                    <Circle cx={spike.x} cy={spike.y} r={spike.r} fill={spike.color} />
                    <Line
                      x1={spike.x}
                      y1={spike.y - spike.arm}
                      x2={spike.x}
                      y2={spike.y + spike.arm}
                      stroke={spike.color}
                      strokeWidth={0.9}
                      strokeLinecap="round"
                      opacity={0.85}
                    />
                    <Line
                      x1={spike.x - spike.arm}
                      y1={spike.y}
                      x2={spike.x + spike.arm}
                      y2={spike.y}
                      stroke={spike.color}
                      strokeWidth={0.9}
                      strokeLinecap="round"
                      opacity={0.85}
                    />
                  </Fragment>
                ))}
              </Svg>
            </Animated.View>
          ))}
        </Animated.View>

        <View style={styles.stage} pointerEvents="none">
          <Animated.View
            style={[
              styles.landing,
              {
                opacity: comet.interpolate({
                  inputRange: [0, 0.1, 0.9, 1],
                  outputRange: [0, 1, 1, 0],
                }),
                transform: calm
                  ? []
                  : [
                      {
                        translateX: away.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, INTRO_COMET.fromX],
                        }),
                      },
                      {
                        translateY: away.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, INTRO_COMET.fromY],
                        }),
                      },
                    ],
              },
            ]}
          >
            <Svg width={280} height={280} viewBox="-140 -140 280 280">
              <Defs>
                <RadialGradient id="head" cx="50%" cy="50%" r="50%">
                  <Stop offset="0" stopColor="#FFF4D8" stopOpacity={1} />
                  <Stop offset="0.3" stopColor={SPARK} stopOpacity={0.65} />
                  <Stop offset="1" stopColor={SPARK} stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Rect
                x={0}
                y={-2}
                width={INTRO_COMET.tail}
                height={4}
                rx={2}
                fill={SPARK}
                opacity={0.85}
                transform={`rotate(${INTRO_COMET.turn})`}
              />
              <Circle cx={0} cy={0} r={20} fill="url(#head)" />
              <Circle cx={0} cy={0} r={5} fill="#FFF4D8" />
            </Svg>
          </Animated.View>

          <Animated.View
            style={[
              styles.landing,
              {
                opacity: flash.interpolate({
                  inputRange: [0, 0.18, 1],
                  outputRange: [0, 1, 0],
                }),
                transform: [
                  { scale: flash.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1.6] }) },
                ],
              },
            ]}
          >
            <Svg width={220} height={220} viewBox="-110 -110 220 220">
              <Defs>
                <RadialGradient id="burst" cx="50%" cy="50%" r="50%">
                  <Stop offset="0" stopColor="#FFF4D8" stopOpacity={0.95} />
                  <Stop offset="0.42" stopColor={SPARK} stopOpacity={0.35} />
                  <Stop offset="1" stopColor={SPARK} stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Circle cx={0} cy={0} r={100} fill="url(#burst)" />
            </Svg>
          </Animated.View>

          <Animated.View
            style={[
              styles.landing,
              styles.ring,
              {
                opacity: ring.interpolate({
                  inputRange: [0, 0.12, 1],
                  outputRange: [0, 0.85, 0],
                }),
                transform: [
                  { scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.2, 2.1] }) },
                ],
              },
            ]}
          />

          {INTRO_DEBRIS.map((piece) => (
            <Animated.View
              key={`${piece.dx}-${piece.dy}`}
              style={[
                styles.landing,
                {
                  opacity: debris.interpolate({
                    inputRange: [0, 0.2, 1],
                    outputRange: [0, 0.9, INTRO_DEBRIS_REST],
                  }),
                  transform: calm
                    ? []
                    : [
                        {
                          translateX: debris.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0, piece.dx],
                          }),
                        },
                        {
                          translateY: debris.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0, piece.dy],
                          }),
                        },
                      ],
                },
              ]}
            >
              <View
                style={{
                  width: piece.size,
                  height: piece.size,
                  borderRadius: piece.size / 2,
                  backgroundColor: SPARK,
                }}
              />
            </Animated.View>
          ))}
        </View>

        <Animated.View style={[styles.stage, { transform: [{ scale: sheetScale }] }]}>
          <Animated.View
            style={{
              opacity: mark,
              transform: calm
                ? []
                : [
                    { scale: mark.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }) },
                    {
                      rotate: mark.interpolate({
                        inputRange: [0, 1],
                        outputRange: ["24deg", "0deg"],
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
                    transform: calm
                      ? [{ rotate: `${(index - 1) * 14}deg` }]
                      : [
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
                transform: calm
                  ? []
                  : [
                      {
                        translateY: word.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }),
                      },
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

/**
 * How each element arrives. The comet gathers speed on the way in, the mark overshoots
 * and settles, everything else eases out of its entrance.
 */
function entrance(element: string, reduced: boolean) {
  if (reduced) return Easing.out(Easing.cubic);
  if (element === "comet") return Easing.in(Easing.quad);
  if (element === "mark") return Easing.out(Easing.back(2));
  return Easing.out(Easing.cubic);
}

const styles = StyleSheet.create({
  fill: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  sky: {
    position: "absolute",
    top: -SKY_BLEED,
    right: -SKY_BLEED,
    bottom: -SKY_BLEED,
    left: -SKY_BLEED,
  },
  stage: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  landing: { position: "absolute", alignItems: "center", justifyContent: "center" },
  ring: { height: 160, width: 160, borderRadius: 80, borderWidth: 2, borderColor: SPARK },
  faceLayer: { position: "absolute", top: 0, left: 0 },
  sparkRow: { flexDirection: "row", gap: 9, height: 26, marginTop: 14, alignItems: "flex-start" },
  spark: { height: 22, width: 7, borderRadius: 4 },
  word: { marginTop: 22, fontSize: 21, fontWeight: "700", letterSpacing: 1 },
  hintRow: { position: "absolute", bottom: 64, left: 0, right: 0, alignItems: "center" },
  hint: { fontSize: 13.5, letterSpacing: 0.4 },
});
