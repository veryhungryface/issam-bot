/**
 * Build every app icon from one piece of mascot artwork.
 *
 *   node scripts/build-icons.mjs <artwork.png> [outDir]
 *
 * Then copy the results into apps/mobile/assets and apps/web/public. The numbers here are
 * each platform's, not ours: iOS masks a full-bleed square, Android can crop the outer
 * third of an adaptive icon, and its status-bar icon is one flat colour a few millimetres
 * wide.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

// sharp belongs to the adapters package, and ESM resolves from this file, not the cwd.
const sharp = createRequire(new URL("../packages/adapters/package.json", import.meta.url))("sharp");

const SRC =
  process.argv[2] ?? new URL("../apps/mobile/assets/source/mascot.png", import.meta.url).pathname;
const OUT = process.argv[3] ?? "/tmp/rakazo-icons";
mkdirSync(OUT, { recursive: true });

// The supplied file is an icon mockup: a rounded white card with a drop shadow, on white.
// Platforms apply their own mask, so every asset is rebuilt from the character itself.
// The character's own bounds, with a hair of margin. A square crop reached into the card's
// rounded corner and carried its shadow into the icon as a faint arc.
const CHAR = { left: 218, top: 118, width: 836, height: 994 };

/**
 * The crop still catches the card's bottom-left corner: a neutral grey arc at about
 * [246,243,239]. The character's own light tones are warm (its palest highlight is
 * [253,247,232], saturation 21), so washing *neutral* near-white to pure white erases the
 * card and leaves the felt untouched.
 */
const character = await (async () => {
  const { data, info } = await sharp(SRC).extract(CHAR).raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += info.channels) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    const saturation = Math.max(r, g, b) - Math.min(r, g, b);
    if ((r + g + b) / 3 > 235 && saturation < 12) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
    }
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
    .png()
    .toBuffer();
})();

/** White square with the character inside, sized so no launcher mask can clip it. */
async function card(size, scale, { alpha = false } = {}) {
  const inner = Math.round(size * scale);
  const art = await sharp(character)
    .resize(inner, inner, { fit: "contain", background: "#ffffff" })
    .toBuffer();
  return sharp({
    create: { width: size, height: size, channels: alpha ? 4 : 3, background: "#ffffff" },
  })
    .composite([{ input: art, gravity: "centre" }])
    .png()
    .toBuffer();
}

/** Rounded white card with transparent corners, for the dark splash screen. */
async function roundedCard(size, scale) {
  const base = await card(size, scale, { alpha: true });
  const r = Math.round(size * 0.22);
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="#fff"/></svg>`,
  );
  return sharp(base)
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
}

/**
 * White silhouette on transparent: what Android tints for the status bar and the themed
 * icon. Drawn rather than traced - at 24dp the mascot's outline (mitts crossing the arms,
 * eyes and mouth as holes) turns to mush, while the shape it is built from, a plump
 * four-point star, stays legible when it is one flat colour a few millimetres wide.
 */
const STAR_PATH =
  "M50.00 3.00 C63.46 3.00 60.88 12.80 74.04 25.96 C87.20 39.12 97.00 36.54 97.00 50.00 C97.00 63.46 87.20 60.88 74.04 74.04 C60.88 87.20 63.46 97.00 50.00 97.00 C36.54 97.00 39.12 87.20 25.96 74.04 C12.80 60.88 3.00 63.46 3.00 50.00 C3.00 36.54 12.80 39.12 25.96 25.96 C39.12 12.80 36.54 3.00 50.00 3.00 Z";

async function silhouette(size, scale) {
  const inner = Math.round(size * scale);
  const star = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${inner}" height="${inner}" viewBox="0 0 100 100"><path fill="#ffffff" d="${STAR_PATH}"/></svg>`,
  );
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: await sharp(star).png().toBuffer(), gravity: "centre" }])
    .png()
    .toBuffer();
}

const assets = {
  // iOS and the base icon: full bleed, no alpha, the platform rounds it.
  "icon.png": await card(1024, 0.78),
  // Android adaptive: the outer third can be cropped, so the character stays well inside.
  "adaptive-icon.png": await card(1024, 0.6),
  "splash-icon.png": await roundedCard(1024, 0.72),
  "notification-icon.png": await silhouette(96, 0.8),
  "monochrome-icon.png": await silhouette(1024, 0.52),
  "icon-512.png": await card(512, 0.78),
  "icon-192.png": await card(192, 0.78),
  "apple-touch-icon.png": await card(180, 0.78),
  "favicon-32x32.png": await card(32, 0.84),
  "favicon-16x16.png": await card(16, 0.88),
  "favicon-64.png": await card(64, 0.84),
};
for (const [name, buffer] of Object.entries(assets)) writeFileSync(`${OUT}/${name}`, buffer);
console.log(Object.keys(assets).join(" "));
