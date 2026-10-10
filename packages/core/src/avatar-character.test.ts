import { describe, expect, it } from "vitest";
import {
  AVATAR_ACCESSORIES,
  AVATAR_BODIES,
  AVATAR_FACES,
  type AvatarMark,
  avatarCharacter,
  avatarChoiceOf,
} from "./avatar-character.js";
import { avatarIdentitySeed } from "./avatar-shape.js";

function everyMark(): AvatarMark[] {
  return [
    ...AVATAR_FACES.flatMap((face) => [...face.eyes, ...face.pupils, ...face.mouth, ...face.extra]),
    ...AVATAR_ACCESSORIES.flatMap((accessory) => [...accessory.back, ...accessory.front]),
  ];
}

describe("the bodies", () => {
  it("draws a closed path for every one", () => {
    for (const body of AVATAR_BODIES) {
      expect(body.d.startsWith("M")).toBe(true);
      expect(body.d.endsWith("Z")).toBe(true);
      expect(body.d).not.toContain("NaN");
    }
  });

  it("keeps every body inside the box its callers scale", () => {
    // A shape that escapes the 100×100 viewBox is clipped at small sizes, which is where
    // these are mostly seen.
    for (const body of AVATAR_BODIES) {
      const numbers = body.d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
      expect(numbers.length).toBeGreaterThan(0);
      expect(Math.min(...numbers)).toBeGreaterThanOrEqual(-1);
      expect(Math.max(...numbers)).toBeLessThanOrEqual(101);
    }
  });

  it("gives each body its own silhouette", () => {
    expect(new Set(AVATAR_BODIES.map((body) => body.d)).size).toBe(AVATAR_BODIES.length);
  });

  it("names every body once", () => {
    expect(new Set(AVATAR_BODIES.map((body) => body.name)).size).toBe(AVATAR_BODIES.length);
  });
});

describe("the faces", () => {
  it("gives every face a mouth and something to look with", () => {
    for (const face of AVATAR_FACES) {
      expect(face.mouth.length).toBeGreaterThan(0);
      expect(face.eyes.length + face.pupils.length).toBeGreaterThan(0);
    }
  });

  it("keeps the eyes above the mouth", () => {
    // Both are drawn from numbers, so a transposed pair would otherwise ship as a face
    // with its mouth on its forehead.
    for (const face of AVATAR_FACES) {
      const eyeDepth = Math.max(...[...face.eyes, ...face.pupils].map(markDepth));
      const mouthTop = Math.min(...face.mouth.map(markDepth));
      expect(eyeDepth).toBeLessThan(mouthTop + 8);
    }
  });

  it("names every face once", () => {
    expect(new Set(AVATAR_FACES.map((face) => face.name)).size).toBe(AVATAR_FACES.length);
  });
});

describe("the accessories", () => {
  it("starts with the one most bots wear", () => {
    expect(AVATAR_ACCESSORIES[0]?.name).toBe("none");
    expect(AVATAR_ACCESSORIES[0]?.back).toHaveLength(0);
    expect(AVATAR_ACCESSORIES[0]?.front).toHaveLength(0);
  });

  it("gives every other accessory something to draw", () => {
    for (const accessory of AVATAR_ACCESSORIES.slice(1)) {
      expect(accessory.back.length + accessory.front.length).toBeGreaterThan(0);
    }
  });

  it("puts hair behind the body and anything worn on the face in front", () => {
    const hair = AVATAR_ACCESSORIES.filter((accessory) => accessory.back.length > 0);
    expect(hair.map((accessory) => accessory.name)).toEqual(["perm", "afro", "comb"]);
    for (const name of ["shades", "mask", "glasses"]) {
      const accessory = AVATAR_ACCESSORIES.find((item) => item.name === name);
      expect(accessory?.back).toHaveLength(0);
      expect(accessory?.front.length).toBeGreaterThan(0);
    }
  });
});

describe("every mark", () => {
  it("is drawable: filled, or stroked with a width", () => {
    for (const mark of everyMark()) {
      if (mark.kind === "path") {
        expect(Boolean(mark.fill) || Boolean(mark.stroke && mark.width)).toBe(true);
        expect(mark.d).not.toContain("NaN");
      } else {
        expect(mark.fill).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    }
  });
});

describe("avatarCharacter", () => {
  it("dresses a bot that has chosen nothing, from its own id", () => {
    const maya = avatarCharacter(avatarIdentitySeed("maya"));
    expect(maya.body).toBeGreaterThanOrEqual(0);
    expect(maya.body).toBeLessThan(AVATAR_BODIES.length);
    expect(maya.face).toBeLessThan(AVATAR_FACES.length);
  });

  it("gives the same bot the same character every time", () => {
    const seed = avatarIdentitySeed("github");
    expect(avatarCharacter(seed)).toEqual(avatarCharacter(seed));
  });

  it("spreads a fresh space across bodies and faces rather than repeating one", () => {
    const seeds = Array.from({ length: 40 }, (_, index) => avatarIdentitySeed(`bot-${index}`));
    const characters = seeds.map((seed) => avatarCharacter(seed));
    expect(new Set(characters.map((character) => character.body)).size).toBeGreaterThan(3);
    expect(new Set(characters.map((character) => character.face)).size).toBeGreaterThan(3);
  });

  it("leaves everyone bare-headed until they ask for a hat", () => {
    // A space where everyone turned up in an accessory is a costume party, not a team.
    const seeds = Array.from({ length: 40 }, (_, index) => avatarIdentitySeed(`bot-${index}`));
    expect(seeds.every((seed) => avatarCharacter(seed).accessory === 0)).toBe(true);
  });

  it("takes what was chosen over what was derived", () => {
    const seed = avatarIdentitySeed("maya");
    expect(avatarCharacter(seed, { body: 2, face: 5, accessory: 7 })).toEqual({
      body: 2,
      face: 5,
      accessory: 7,
    });
  });

  it("falls back rather than throwing on a number this version does not have", () => {
    // These come out of a database that outlives any one version of the lists.
    const seed = avatarIdentitySeed("maya");
    const derived = avatarCharacter(seed);
    expect(avatarCharacter(seed, { body: 999, face: -1, accessory: 1.5 })).toEqual(derived);
  });

  it("survives a seed that is not a usable number", () => {
    for (const seed of [0, -12, Number.NaN, 2 ** 40]) {
      const character = avatarCharacter(seed);
      expect(Number.isInteger(character.body)).toBe(true);
      expect(character.body).toBeGreaterThanOrEqual(0);
      expect(character.face).toBeGreaterThanOrEqual(0);
    }
  });
});

/**
 * How far down the 100-box a mark starts, for the eyes-above-mouth check.
 *
 * Only the move-to is read. Every other command in these paths may be relative, and
 * averaging a `q`'s offsets in with absolute points puts a mouth near the top of the box.
 */
function markDepth(mark: AvatarMark): number {
  if (mark.kind !== "path") return mark.cy;
  const start = mark.d.match(/^M\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/);
  if (!start) throw new Error(`mark does not start with an absolute move: ${mark.d}`);
  return Number(start[2]);
}

describe("avatarChoiceOf", () => {
  it("carries a dressed bot's columns through to the renderer", () => {
    const choice = avatarChoiceOf({ avatarBody: 2, avatarFace: 5, avatarAccessory: 3 });
    expect(choice).toEqual({ body: 2, face: 5, accessory: 3 });
    const character = avatarCharacter(1, choice);
    expect(character).toEqual({ body: 2, face: 5, accessory: 3 });
  });

  it("leaves an undressed bot to its id", () => {
    const choice = avatarChoiceOf({ avatarBody: null, avatarFace: null, avatarAccessory: null });
    expect(avatarCharacter(9, choice)).toEqual(avatarCharacter(9));
  });

  it("dresses the pieces that were chosen and derives the rest", () => {
    const choice = avatarChoiceOf({ avatarBody: null, avatarFace: 4, avatarAccessory: null });
    const character = avatarCharacter(9, choice);
    expect(character.face).toBe(4);
    expect(character.body).toBe(avatarCharacter(9).body);
  });
});
