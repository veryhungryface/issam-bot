import { expect, type Page, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

/**
 * On a phone both side panes are drawers, and a drawer that only opens and closes through
 * a button is the clearest sign an app is a web page in a frame. Each edge owns one: the
 * left the bot list, the right the bot's computer. They follow the thumb and settle where
 * the thumb was heading, the conversation stays where it is underneath, and the panel can
 * also be dismissed by tapping the strip of conversation it leaves showing.
 */

const PHONE = { width: 390, height: 844 };

/** A deliberate sideways drag: enough steps that the axis is decided before it travels. */
async function drag(page: Page, from: { x: number; y: number }, toX: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = 12;
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(from.x + ((toX - from.x) * step) / steps, from.y);
  }
  await page.mouse.up();
}

async function sidebarLeft(page: Page) {
  const box = await page.getByTestId("bots-sidebar").boundingBox();
  return box?.x ?? Number.NaN;
}

async function conversationLeft(page: Page) {
  const box = await page.getByTestId("conversation").boundingBox();
  return box?.x ?? Number.NaN;
}

test("the navigation drawer opens and closes under the thumb", async ({ page }, testInfo) => {
  await page.setViewportSize(PHONE);
  const stamp = Date.now();
  await signup(page, `drawer-swipe-${stamp}@rakazo.test`, "password12", "Drawer Swipe");
  await completeOnboarding(page);

  // Closed, the drawer sits its own width off the left of the screen.
  await expect.poll(async () => (await sidebarLeft(page)) < 0).toBe(true);

  // A drag from the very edge pulls it out — nothing to aim at, which is the point.
  await drag(page, { x: 3, y: 420 }, 320);
  await expect.poll(async () => Math.round(await sidebarLeft(page))).toBe(0);
  await captureScreenshot(page, testInfo, "70-drawer-opened-by-swipe");

  // The conversation stays where it is. The drawer passes over it.
  expect(Math.round(await conversationLeft(page))).toBe(0);

  // A drag back across the drawer puts it away again.
  await drag(page, { x: 240, y: 420 }, 10);
  await expect.poll(async () => (await sidebarLeft(page)) < 0).toBe(true);
  expect(Math.round(await conversationLeft(page))).toBe(0);

  // A drag that starts in the middle of the conversation is not a drawer gesture.
  await drag(page, { x: 200, y: 420 }, 360);
  await expect.poll(async () => (await sidebarLeft(page)) < 0).toBe(true);

  // The button still works, because a gesture is an addition, not a replacement.
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect.poll(async () => Math.round(await sidebarLeft(page))).toBe(0);
});

/**
 * Two things a swipe has to do that watching only the end of it never checked.
 *
 * The drawer used to appear fully open the moment the drag finished rather than coming out
 * from under the thumb, because its resting position is a `translate` and the drag was a
 * `transform`: the two add up, so a drawer dragged halfway sat a full width off screen the
 * whole way. And a swipe only had to leave the edge on the slant a thumb naturally makes
 * for the drawer to decide it was a scroll and let go of it for good.
 */
test("the drawer comes out from under the thumb, not after it", async ({ page }, testInfo) => {
  await page.setViewportSize(PHONE);
  const stamp = Date.now();
  await signup(page, `drawer-tracks-${stamp}@rakazo.test`, "password12", "Drawer Tracks");
  await completeOnboarding(page);

  const sidebar = page.getByTestId("bots-sidebar");
  await page.mouse.move(3, 420);
  await page.mouse.down();
  for (const x of [20, 60, 100, 140, 180, 200]) await page.mouse.move(x, 420);

  // Still mid-drag: the drawer is partly on screen, with its leading edge at the thumb.
  await expect(sidebar).toHaveAttribute("data-dragging", "true");
  const box = await sidebar.boundingBox();
  const left = box?.x ?? Number.NaN;
  const width = box?.width ?? 0;
  expect(left).toBeGreaterThan(-width);
  expect(left).toBeLessThan(0);
  expect(Math.abs(left + width - 200)).toBeLessThanOrEqual(12);
  await captureScreenshot(page, testInfo, "73-drawer-halfway-out");

  await page.mouse.move(330, 420);
  await page.mouse.up();
  await expect.poll(async () => Math.round(await sidebarLeft(page))).toBe(0);
});

test("a swipe that drifts up or down still opens the drawer", async ({ page }) => {
  await page.setViewportSize(PHONE);
  const stamp = Date.now();
  await signup(page, `drawer-slant-${stamp}@rakazo.test`, "password12", "Drawer Slant");
  await completeOnboarding(page);

  // The thumb leaves the edge on an arc: its first movement is further down than across,
  // and the swipe straightens out from there.
  await page.mouse.move(4, 400);
  await page.mouse.down();
  for (const [x, y] of [
    [16, 416],
    [44, 430],
    [120, 438],
    [220, 442],
    [330, 444],
  ] as const) {
    await page.mouse.move(x, y);
  }
  await page.mouse.up();
  await expect.poll(async () => Math.round(await sidebarLeft(page))).toBe(0);

  // A drag straight down the same edge is still a scroll, not a drawer.
  await page.getByRole("button", { name: "Close navigation" }).click();
  await expect.poll(async () => (await sidebarLeft(page)) < 0).toBe(true);
  await page.mouse.move(4, 200);
  await page.mouse.down();
  for (const [x, y] of [
    [10, 240],
    [14, 320],
    [18, 420],
  ] as const) {
    await page.mouse.move(x, y);
  }
  await page.mouse.up();
  await expect.poll(async () => (await sidebarLeft(page)) < 0).toBe(true);
});

test("the right edge opens and closes the bot's computer", async ({ page }, testInfo) => {
  await page.setViewportSize(PHONE);
  const stamp = Date.now();
  await signup(page, `panel-swipe-${stamp}@rakazo.test`, "password12", "Panel Swipe");
  await completeOnboarding(page);

  const panel = page.getByTestId("side-panel");
  await expect(panel).toHaveAttribute("data-panel", "closed");

  // Pulled out from the right edge, it is the computer — not an empty sheet that fills in
  // once it lands.
  await drag(page, { x: PHONE.width - 3, y: 420 }, 60);
  await expect(panel).toHaveAttribute("data-panel", "computer");
  await expect.poll(async () => Math.round((await panel.boundingBox())?.x ?? -1)).toBe(48);
  await captureScreenshot(page, testInfo, "72-computer-opened-by-swipe");

  // Pushed back off its own edge, it goes away.
  await drag(page, { x: 200, y: 420 }, PHONE.width - 2);
  await expect(panel).toHaveAttribute("data-panel", "closed");

  // A drag that starts in the middle of the conversation is not a panel gesture.
  await drag(page, { x: 200, y: 420 }, 30);
  await expect(panel).toHaveAttribute("data-panel", "closed");
});

test("the side panel closes by tapping the conversation or swiping it away", async ({
  page,
}, testInfo) => {
  await page.setViewportSize(PHONE);
  const stamp = Date.now();
  await signup(page, `panel-dismiss-${stamp}@rakazo.test`, "password12", "Panel Dismiss");
  await completeOnboarding(page);

  const panel = page.getByTestId("side-panel");
  const openPanel = async () => {
    await page.getByTitle("Agent computer").click();
    await expect(panel).not.toHaveAttribute("data-panel", "closed");
    const box = await panel.boundingBox();
    // The panel leaves a strip of the conversation uncovered to tap.
    expect(box?.x ?? 0).toBeGreaterThan(0);
  };

  await openPanel();
  await captureScreenshot(page, testInfo, "71-panel-leaves-a-strip-to-tap");

  // Tapping that strip dismisses the panel.
  await page.mouse.click(16, 420);
  await expect(panel).toHaveAttribute("data-panel", "closed");

  // So does pushing the panel back off its own edge.
  await openPanel();
  await drag(page, { x: 200, y: 420 }, 388);
  await expect(panel).toHaveAttribute("data-panel", "closed");
});

test("a desktop layout keeps its panes still", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const stamp = Date.now();
  await signup(page, `drawer-desktop-${stamp}@rakazo.test`, "password12", "Drawer Desktop");
  await completeOnboarding(page);

  const sidebar = page.getByTestId("bots-sidebar");
  const before = await sidebar.boundingBox();
  const conversationBefore = await conversationLeft(page);
  // The same drag that would open a drawer is just a drag across a column here.
  await drag(page, { x: 3, y: 420 }, 320);
  const after = await sidebar.boundingBox();
  expect(after?.x).toBe(before?.x);
  expect(after?.width).toBe(before?.width);
  expect(await conversationLeft(page)).toBe(conversationBefore);
  await expect(sidebar).not.toHaveAttribute("data-dragging", "true");
});
