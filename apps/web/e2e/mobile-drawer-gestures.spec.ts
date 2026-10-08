import { expect, type Page, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

/**
 * On a phone both side panes are drawers, and a drawer that only closes through a button
 * is the clearest sign an app is a web page in a frame. Each one follows the thumb, settles
 * where the thumb was heading, and the panel can also be dismissed by tapping the strip of
 * conversation it leaves showing.
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

  // A drag back across the drawer puts it away again.
  await drag(page, { x: 240, y: 420 }, 10);
  await expect.poll(async () => (await sidebarLeft(page)) < 0).toBe(true);

  // A drag that starts in the middle of the conversation is not a drawer gesture.
  await drag(page, { x: 200, y: 420 }, 360);
  await expect.poll(async () => (await sidebarLeft(page)) < 0).toBe(true);

  // The button still works, because a gesture is an addition, not a replacement.
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect.poll(async () => Math.round(await sidebarLeft(page))).toBe(0);
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
  // The same drag that would open a drawer is just a drag across a column here.
  await drag(page, { x: 3, y: 420 }, 320);
  const after = await sidebar.boundingBox();
  expect(after?.x).toBe(before?.x);
  expect(after?.width).toBe(before?.width);
  await expect(sidebar).not.toHaveAttribute("data-dragging", "true");
});
