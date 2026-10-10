import { expect, test } from "@playwright/test";

test("a character holds still when the viewer asks for less motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/e2e/fixtures/avatar-motion.html");

  const avatar = page.locator(".rakazo-avatar").first();
  await expect(avatar).toBeVisible();

  // Each part that can move, and the ring that spins while a run is on.
  const parts = ["rakazo-avatar-eyes", "rakazo-avatar-pupils", "rakazo-avatar-ring"];
  for (const part of parts) {
    const node = avatar.locator(`.${part}`).first();
    await expect(node).toHaveCount(1);
    const name = await node.evaluate((element) => getComputedStyle(element).animationName);
    expect(name, part).toBe("none");
  }

  // And it stays where it was: a transform that is still running would move it.
  const box = () => avatar.locator(".rakazo-avatar-pupils").first().boundingBox();
  const first = await box();
  await page.waitForTimeout(300);
  expect(await box()).toEqual(first);
});
