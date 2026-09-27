import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

/**
 * On a phone the bubbles were capped at ~74% of an already narrow column, so a Korean
 * sentence wrapped every few words while a third of the screen stayed empty. A phone gives
 * up only the width the action rail needs; the reading measure is kept for wide screens.
 */
test("a phone uses nearly the full width for messages", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const stamp = Date.now();
  await signup(page, `mobile-width-${stamp}@rakazo.test`, "password12", "Mobile Width");
  await completeOnboarding(page);

  const composer = page.getByPlaceholder(/Message/);
  const sent = `mobile-width-${stamp} 만화카페 캣툰 가격정보 조사해서 방 배정과 음료까지 분석해줘`;
  await composer.fill(sent);
  await page.keyboard.press("Enter");

  const row = page
    .getByTestId("transcript")
    .locator("[data-message-id]")
    .filter({ hasText: `mobile-width-${stamp}` })
    .first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  const frame = row.getByTestId("message-bubble-frame");

  const ratio = await expect
    .poll(async () => {
      const frameBox = await frame.boundingBox();
      const transcriptBox = await page.getByTestId("transcript").boundingBox();
      if (!frameBox || !transcriptBox) return 0;
      return Math.round((frameBox.width / transcriptBox.width) * 100);
    })
    .toBeGreaterThanOrEqual(85);
  void ratio;

  // The action rail still sits outside the bubble, not on top of the words.
  const rail = row.getByTestId("message-hover-rail");
  await expect
    .poll(async () => {
      const railBox = await rail.boundingBox();
      const frameBox = await frame.boundingBox();
      if (!railBox || !frameBox) return null;
      return railBox.x + railBox.width <= frameBox.x + 2;
    })
    .toBe(true);

  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await captureScreenshot(page, testInfo, "mobile-message-width");
});
