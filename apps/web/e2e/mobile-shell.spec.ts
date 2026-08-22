import { expect, test } from "@playwright/test";
import { completeOnboarding, signup } from "./helpers";

test("mobile shell uses a bot drawer and full-width work panels", async ({ page }) => {
  const stamp = Date.now();
  await signup(page, `mobile-${stamp}@rakazo.test`, "password12", "Mobile");
  await completeOnboarding(page, ["A bit of everything", "Clear and tight"]);
  await page.setViewportSize({ width: 390, height: 844 });

  const sidebar = page.getByTestId("bot-sidebar");
  const main = page.locator("main");
  await expect(sidebar).toBeHidden();
  await expect(page.getByRole("button", { name: "Open bot navigation" })).toBeVisible();
  await expect.poll(async () => Math.round((await main.boundingBox())?.width ?? 0)).toBe(390);

  await page.getByRole("button", { name: "Open bot navigation" }).click();
  await expect(sidebar).toBeVisible();
  expect((await sidebar.boundingBox())?.width).toBeLessThan(390);
  await sidebar.getByRole("button", { name: "Close bot navigation" }).click();
  await expect(sidebar).toBeHidden();

  await page.getByTestId("bot-settings-trigger").click();
  const panel = page.getByTestId("side-panel");
  await expect(panel).toHaveAttribute("data-panel", "settings");
  await expect.poll(async () => Math.round((await panel.boundingBox())?.width ?? 0)).toBe(390);
  await panel.getByRole("button", { name: "패널 닫기" }).click();
  await expect(panel).toHaveAttribute("data-panel", "closed");
});
