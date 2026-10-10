/**
 * The characters a bot can wear.
 *
 * Every one is the mascot seen differently: one plush body, one face, one accessory, one
 * colour. They are described here as marks — a shape and the numbers that place it —
 * rather than as SVG text, because the phone app draws them with `react-native-svg` and
 * the web app with DOM elements, and neither can be handed a string of markup.
 *
 * All of it is generated from a handful of numbers, so adding a body or a face is a line
 * rather than a drawing. The coordinate space is the 100×100 box every caller scales.
 */

export interface AvatarPath {
  kind: "path";
  d: string;
  /** Filled when set, otherwise stroked at `width`. */
  fill?: string;
  stroke?: string;
  width?: number;
}

export interface AvatarCircle {
  kind: "circle";
  cx: number;
  cy: number;
  r: number;
  fill: string;
}

export interface AvatarEllipse {
  kind: "ellipse";
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  fill: string;
}

export type AvatarMark = AvatarPath | AvatarCircle | AvatarEllipse;

/** The mascot's own colours. Nothing here invents a new one. */
export const AVATAR_INK = "#1A1A1E";
export const AVATAR_HAIR = "#2B2B31";
export const AVATAR_CHEEK = "#F0A09A";
export const AVATAR_GOLD = "#F5B823";
export const AVATAR_PINK = "#EC4899";
export const AVATAR_TONGUE = "#E8657A";
export const AVATAR_WHITE = "#FFFFFF";

const round = (value: number) => Math.round(value * 100) / 100;

interface Point {
  x: number;
  y: number;
}

/**
 * A ring of points. One radius gives a polygon, two alternating give a star, and the
 * corner cutting below turns either into something plush.
 */
function ring(input: {
  points: number;
  inner?: number;
  tilt?: number;
  squash?: number;
  radius?: number;
  jitter?: number;
}): Point[] {
  const { points, inner = 1, tilt = 0, squash = 1, radius = 47, jitter = 0 } = input;
  const count = inner === 1 ? points : points * 2;
  const step = (Math.PI * 2) / count;
  const start = (tilt * Math.PI) / 180 - Math.PI / 2;
  const out: Point[] = [];
  for (let index = 0; index < count; index++) {
    const scale = inner === 1 ? 1 : index % 2 === 0 ? 1 : inner;
    const wobble = jitter ? 1 + Math.sin(index * 2.3) * jitter : 1;
    const distance = radius * scale * wobble;
    const angle = start + index * step;
    out.push({ x: Math.cos(angle) * distance, y: Math.sin(angle) * distance * squash });
  }
  return out;
}

/** Chaikin corner cutting: what makes a square and a star read as the same material. */
function soften(points: Point[], passes: number): Point[] {
  let current = points;
  for (let pass = 0; pass < passes; pass++) {
    current = current.flatMap((point, index) => {
      const next = current[(index + 1) % current.length] as Point;
      return [
        { x: point.x * 0.75 + next.x * 0.25, y: point.y * 0.75 + next.y * 0.25 },
        { x: point.x * 0.25 + next.x * 0.75, y: point.y * 0.25 + next.y * 0.75 },
      ];
    });
  }
  return current;
}

/** Catmull-Rom through the points, as one closed cubic path centred in the 100×100 box. */
function closedPath(points: Point[]): string {
  const count = points.length;
  const first = points[0] as Point;
  let path = `M${round(first.x + 50)} ${round(first.y + 50)}`;
  for (let index = 0; index < count; index++) {
    const before = points[(index - 1 + count) % count] as Point;
    const current = points[index] as Point;
    const next = points[(index + 1) % count] as Point;
    const after = points[(index + 2) % count] as Point;
    path +=
      `C${round(current.x + (next.x - before.x) / 6 + 50)} ${round(current.y + (next.y - before.y) / 6 + 50)}` +
      ` ${round(next.x - (after.x - current.x) / 6 + 50)} ${round(next.y - (after.y - current.y) / 6 + 50)}` +
      ` ${round(next.x + 50)} ${round(next.y + 50)}`;
  }
  return `${path}Z`;
}

export interface AvatarBody {
  name: string;
  d: string;
  /** A triangle carries its mass low, so its face sits lower than a star's. */
  faceY: number;
}

const BODY_RECIPES = [
  { name: "star", faceY: 0, passes: 2, ring: { points: 4, inner: 0.72 } },
  { name: "square", faceY: 0, passes: 2, ring: { points: 4, tilt: 45, radius: 50 } },
  { name: "triangle", faceY: 6, passes: 2, ring: { points: 3, radius: 52 } },
  { name: "round", faceY: 0, passes: 1, ring: { points: 22, radius: 46 } },
  { name: "pebble", faceY: 1, passes: 3, ring: { points: 7, radius: 46, jitter: 0.1, tilt: 12 } },
  { name: "fivestar", faceY: 2, passes: 2, ring: { points: 5, inner: 0.7 } },
  { name: "tall", faceY: 0, passes: 2, ring: { points: 4, tilt: 45, radius: 52, squash: 0.8 } },
  { name: "cloud", faceY: 0, passes: 3, ring: { points: 9, inner: 0.86, radius: 47 } },
] as const;

export const AVATAR_BODIES: readonly AvatarBody[] = BODY_RECIPES.map((recipe) => ({
  name: recipe.name,
  faceY: recipe.faceY,
  d: closedPath(soften(ring(recipe.ring), recipe.passes)),
}));

const arc = (cx: number, y: number, lift = 8, width = 6.5, thickness = 4.2): AvatarMark => ({
  kind: "path",
  d: `M${cx - width} ${y}Q${cx} ${y - lift} ${cx + width} ${y}`,
  stroke: AVATAR_INK,
  width: thickness,
});

const vee = (cx: number, y: number): AvatarMark => ({
  kind: "path",
  d: `M${cx - 6} ${y - 7}L${cx} ${y}L${cx + 6} ${y - 7}`,
  stroke: AVATAR_INK,
  width: 4,
});

const lid = (cx: number, y: number, width = 6, thickness = 3.6): AvatarMark => ({
  kind: "path",
  d: `M${cx - width} ${y}h${width * 2}`,
  stroke: AVATAR_INK,
  width: thickness,
});

const dot = (cx: number, cy: number, r = 4.2, fill = AVATAR_INK): AvatarMark => ({
  kind: "circle",
  cx,
  cy,
  r,
  fill,
});

const oval = (cx: number, cy: number): AvatarMark => ({
  kind: "ellipse",
  cx,
  cy,
  rx: 4.6,
  ry: 6,
  fill: AVATAR_INK,
});

const heart = (cx: number, cy: number, s = 5.2): AvatarMark => ({
  kind: "path",
  d:
    `M${cx} ${cy + s * 0.9}C${cx - s * 1.5} ${cy - s * 0.2} ${cx - s * 0.8} ${cy - s * 1.4} ${cx} ${cy - s * 0.4}` +
    `C${cx + s * 0.8} ${cy - s * 1.4} ${cx + s * 1.5} ${cy - s * 0.2} ${cx} ${cy + s * 0.9}Z`,
  fill: AVATAR_PINK,
});

const sparkle = (cx: number, cy: number, r = 6.2): AvatarMark => ({
  kind: "path",
  d:
    `M${cx} ${cy - r}Q${cx + r * 0.22} ${cy - r * 0.22} ${cx + r} ${cy}` +
    `Q${cx + r * 0.22} ${cy + r * 0.22} ${cx} ${cy + r}` +
    `Q${cx - r * 0.22} ${cy + r * 0.22} ${cx - r} ${cy}` +
    `Q${cx - r * 0.22} ${cy - r * 0.22} ${cx} ${cy - r}Z`,
  fill: AVATAR_GOLD,
});

const cheeks = (y: number, r = 5.2): AvatarMark[] => [
  dot(29, y, r, AVATAR_CHEEK),
  dot(71, y, r, AVATAR_CHEEK),
];

const grin = (y: number, width = 8, depth = 13): AvatarMark => ({
  kind: "path",
  d: `M${50 - width} ${y}Q50 ${y + depth} ${50 + width} ${y}Z`,
  fill: AVATAR_INK,
});

const bigGrin = (y: number): AvatarMark[] => [
  { kind: "path", d: `M38 ${y}Q50 ${y + 18} 62 ${y}Z`, fill: AVATAR_INK },
  { kind: "path", d: `M44.5 ${y + 10}Q50 ${y + 15} 55.5 ${y + 10}Z`, fill: AVATAR_TONGUE },
];

const smile = (y: number, width = 7, depth = 5): AvatarMark => ({
  kind: "path",
  d: `M${50 - width} ${y}Q50 ${y + depth} ${50 + width} ${y}`,
  stroke: AVATAR_INK,
  width: 3.6,
});

const flatMouth = (y: number, width = 5.5): AvatarMark => ({
  kind: "path",
  d: `M${50 - width} ${y}h${width * 2}`,
  stroke: AVATAR_INK,
  width: 3.4,
});

const squiggle = (y: number): AvatarMark => ({
  kind: "path",
  d: `M42 ${y}q4 -4 8 0t8 0`,
  stroke: AVATAR_INK,
  width: 3.2,
});

const tongueOut = (y: number): AvatarMark[] => [
  { kind: "path", d: `M43 ${y}Q50 ${y + 10} 57 ${y}Z`, fill: AVATAR_INK },
  { kind: "path", d: `M46 ${y + 6}q4 9 8 0Z`, fill: AVATAR_TONGUE },
];

const smirk = (y: number): AvatarMark => ({
  kind: "path",
  d: `M43 ${y}q7 6 13 -2`,
  stroke: AVATAR_INK,
  width: 3.4,
});

export interface AvatarFace {
  name: string;
  /** Lids, brows and closed eyes: the framing that blinks but does not wander. */
  eyes: AvatarMark[];
  /** What rolls around inside the framing. A face without these has nothing to roll. */
  pupils: AvatarMark[];
  mouth: AvatarMark[];
  extra: AvatarMark[];
}

const EYE_Y = 46;
const MOUTH_Y = 55;
const CHEEK_Y = 54;

export const AVATAR_FACES: readonly AvatarFace[] = [
  {
    name: "bright",
    eyes: [arc(36, EYE_Y), arc(64, EYE_Y)],
    pupils: [],
    mouth: [grin(MOUTH_Y)],
    extra: cheeks(CHEEK_Y),
  },
  {
    name: "cheeky",
    eyes: [arc(36, EYE_Y)],
    pupils: [dot(64, EYE_Y - 1)],
    mouth: tongueOut(MOUTH_Y),
    extra: cheeks(CHEEK_Y),
  },
  {
    name: "squint",
    eyes: [vee(36, EYE_Y + 2), vee(64, EYE_Y + 2)],
    pupils: [],
    mouth: [smile(MOUTH_Y + 1, 5, 3)],
    extra: [],
  },
  {
    name: "smitten",
    eyes: [],
    pupils: [heart(36, EYE_Y), heart(64, EYE_Y)],
    mouth: bigGrin(MOUTH_Y - 2),
    extra: cheeks(CHEEK_Y, 5.8),
  },
  {
    name: "sleepy",
    eyes: [lid(36, EYE_Y), lid(64, EYE_Y)],
    pupils: [],
    mouth: [dot(50, MOUTH_Y + 2, 3.4)],
    extra: [],
  },
  {
    name: "startled",
    eyes: [],
    pupils: [
      oval(36, EYE_Y),
      dot(37.6, EYE_Y - 2.4, 1.5, AVATAR_WHITE),
      oval(64, EYE_Y),
      dot(65.6, EYE_Y - 2.4, 1.5, AVATAR_WHITE),
    ],
    mouth: [dot(50, MOUTH_Y + 1, 4.2)],
    extra: [],
  },
  {
    name: "deadpan",
    eyes: [],
    pupils: [dot(36, EYE_Y, 3.6), dot(64, EYE_Y, 3.6)],
    mouth: [flatMouth(MOUTH_Y + 2)],
    extra: [],
  },
  {
    name: "stifled",
    eyes: [arc(36, EYE_Y, 6), arc(64, EYE_Y, 6)],
    pupils: [],
    mouth: [squiggle(MOUTH_Y + 2)],
    extra: [],
  },
  {
    name: "sly",
    eyes: [lid(36, EYE_Y - 3, 5, 3)],
    pupils: [dot(36, EYE_Y + 1, 3.4), dot(64, EYE_Y, 3.8)],
    mouth: [smirk(MOUTH_Y)],
    extra: [],
  },
  {
    name: "teary",
    eyes: [arc(36, EYE_Y, 5), arc(64, EYE_Y, 5)],
    pupils: [],
    mouth: [squiggle(MOUTH_Y + 2)],
    extra: [{ kind: "path", d: `M70 ${EYE_Y + 4}q4 6 0 9t-4 -9Z`, fill: "#5AB8F0" }],
  },
  {
    name: "starry",
    eyes: [],
    pupils: [sparkle(36, EYE_Y), sparkle(64, EYE_Y)],
    mouth: bigGrin(MOUTH_Y - 2),
    extra: [],
  },
  {
    name: "sideeye",
    eyes: [lid(36, EYE_Y - 5, 5, 2.6), lid(64, EYE_Y - 5, 5, 2.6)],
    pupils: [dot(39, EYE_Y, 3.8), dot(67, EYE_Y, 3.8)],
    mouth: [flatMouth(MOUTH_Y + 2, 4)],
    extra: [],
  },
];

export interface AvatarAccessory {
  name: string;
  /** Hair sits behind the body; glasses and masks sit in front of the face. */
  back: AvatarMark[];
  front: AvatarMark[];
}

const hairPuffs = (puffs: readonly (readonly [number, number, number])[]): AvatarMark[] =>
  puffs.map(([cx, cy, r]) => dot(cx, cy, r, AVATAR_HAIR));

const AFRO = hairPuffs([
  [28, 22, 13],
  [50, 14, 15],
  [72, 22, 13],
  [20, 36, 11],
  [80, 36, 11],
  [38, 13, 11],
  [62, 13, 11],
]);

export const AVATAR_ACCESSORIES: readonly AvatarAccessory[] = [
  { name: "none", back: [], front: [] },
  {
    name: "shades",
    back: [],
    front: [
      {
        kind: "path",
        d: "M18 40h26a3 3 0 0 1 3 3v3a10 10 0 0 1-10 10h-9a10 10 0 0 1-10-10v-3a3 3 0 0 1 0-3Z",
        fill: AVATAR_INK,
      },
      {
        kind: "path",
        d: "M56 40h26a3 3 0 0 1 0 3v3a10 10 0 0 1-10 10h-9a10 10 0 0 1-10-10v-3a3 3 0 0 1 3-3Z",
        fill: AVATAR_INK,
      },
      { kind: "path", d: "M47 44h6", stroke: AVATAR_INK, width: 3.4 },
    ],
  },
  {
    name: "headband",
    back: [],
    front: [
      { kind: "path", d: "M16 28Q50 6 84 28", stroke: AVATAR_PINK, width: 7 },
      dot(78, 18, 5.5, AVATAR_PINK),
      dot(86, 23, 4.5, AVATAR_PINK),
    ],
  },
  {
    name: "earrings",
    back: [],
    front: [
      dot(10, 56, 4.6, AVATAR_GOLD),
      dot(90, 56, 4.6, AVATAR_GOLD),
      { kind: "path", d: "M10 51v-4M90 51v-4", stroke: AVATAR_GOLD, width: 2.4 },
    ],
  },
  {
    name: "mask",
    back: [],
    front: [
      { kind: "path", d: "M30 50h40v9a20 20 0 0 1-40 0Z", fill: "#E8EDF3" },
      { kind: "path", d: "M30 54h40", stroke: "#C7D2DD", width: 2 },
      { kind: "path", d: "M30 51L16 45M70 51l14-6", stroke: "#C7D2DD", width: 2.6 },
    ],
  },
  {
    name: "moustache",
    back: [],
    front: [
      { kind: "path", d: "M50 58q-5 -7 -13 -4t-4 9q6 3 10 -2 3 -3 7 -3Z", fill: AVATAR_HAIR },
      { kind: "path", d: "M50 58q5 -7 13 -4t4 9q-6 3 -10 -2-3 -3 -7 -3Z", fill: AVATAR_HAIR },
    ],
  },
  {
    name: "perm",
    back: hairPuffs([
      [26, 24, 9],
      [38, 17, 9.5],
      [50, 14, 10],
      [62, 17, 9.5],
      [74, 24, 9],
      [20, 33, 7.5],
      [80, 33, 7.5],
    ]),
    front: [],
  },
  { name: "afro", back: AFRO, front: [] },
  {
    name: "comb",
    back: AFRO,
    front: [
      { kind: "path", d: "M66 13h17a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H66Z", fill: AVATAR_GOLD },
      { kind: "path", d: "M68 19v7M72 19v7M76 19v7M80 19v7", stroke: AVATAR_GOLD, width: 2.2 },
    ],
  },
  {
    name: "cap",
    back: [],
    front: [
      { kind: "path", d: "M24 30a26 26 0 0 1 52 0Z", fill: "#3B82F6" },
      { kind: "path", d: "M22 30h56a4 4 0 0 1 0 7H22a4 4 0 0 1 0-7Z", fill: "#2563EB" },
      dot(50, 8, 4, AVATAR_GOLD),
    ],
  },
  {
    name: "bow",
    back: [],
    front: [
      { kind: "path", d: "M70 18l-12 7 12 7Z", fill: AVATAR_PINK },
      { kind: "path", d: "M86 18l12 7-12 7Z", fill: AVATAR_PINK },
      dot(78, 25, 5, "#F472B6"),
    ],
  },
  {
    name: "glasses",
    back: [],
    front: [
      { kind: "path", d: "M26 46a10 10 0 1 0 20 0 10 10 0 1 0-20 0", stroke: AVATAR_INK, width: 3 },
      { kind: "path", d: "M54 46a10 10 0 1 0 20 0 10 10 0 1 0-20 0", stroke: AVATAR_INK, width: 3 },
      { kind: "path", d: "M46 46h8", stroke: AVATAR_INK, width: 3 },
    ],
  },
];

export interface AvatarCharacter {
  body: number;
  face: number;
  accessory: number;
}

/** What a bot that has never been dressed looks like. */
export interface AvatarChoice {
  body?: number | null;
  face?: number | null;
  accessory?: number | null;
}

function within(value: number | null | undefined, count: number, fallback: number): number {
  if (value === null || value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 0 || value >= count) return fallback;
  return value;
}

/**
 * The character to draw.
 *
 * A bot that has chosen nothing still gets one of its own, from its id, so a fresh space
 * is a crowd rather than a row of identical marks. An accessory is the exception: most
 * bots wear none, and a space where everyone turned up in a hat is a costume party, not a
 * team. Anything chosen wins, and anything out of range falls back rather than throwing —
 * these numbers come from a database that outlives any one version of this list.
 */
export function avatarCharacter(seed: number, choice: AvatarChoice = {}): AvatarCharacter {
  const safe = Math.abs(Math.trunc(seed)) || 0;
  return {
    body: within(choice.body, AVATAR_BODIES.length, safe % AVATAR_BODIES.length),
    face: within(choice.face, AVATAR_FACES.length, Math.floor(safe / 7) % AVATAR_FACES.length),
    accessory: within(choice.accessory, AVATAR_ACCESSORIES.length, 0),
  };
}

/** The three columns a bot carries in the database. */
export interface AvatarColumns {
  avatarBody?: number | null;
  avatarFace?: number | null;
  avatarAccessory?: number | null;
}

/**
 * What a stored bot is wearing, in the shape the renderer takes.
 *
 * The columns and the choice are deliberately named apart — a row is a record, a choice is
 * an argument — so this is the one place the two meet. Every screen that draws a bot goes
 * through here; the alternative is what happened before, where the settings panel read the
 * columns and nothing else did, so a bot you had dressed still turned up undressed in the
 * list beside it.
 */
export function avatarChoiceOf(bot: AvatarColumns): AvatarChoice {
  return { body: bot.avatarBody, face: bot.avatarFace, accessory: bot.avatarAccessory };
}
