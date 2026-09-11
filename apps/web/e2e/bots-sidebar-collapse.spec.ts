import { expect, test } from "@playwright/test";
import { completeOnboarding, signup } from "./helpers";

test("minimizing the bot list leaves a visible control to bring it back", async ({ page }) => {
  const stamp = Date.now();
  await signup(page, `sidebar-collapse-${stamp}@rakazo.test`, "password12", "Sidebar");
  await completeOnboarding(page);

  const sidebar = page.getByTestId("bots-sidebar");
  await expect(sidebar).toHaveAttribute("data-collapsed", "false");

  await page.getByTestId("minimize-bots-sidebar").click();
  await expect(sidebar).toHaveAttribute("data-collapsed", "true");

  // The sidebar's own toggle goes away with it, so the header must offer the way back.
  const restore = page.getByTestId("restore-bots-sidebar");
  await expect(restore).toBeVisible();
  await restore.click();
  await expect(sidebar).toHaveAttribute("data-collapsed", "false");
  await expect(restore).toHaveCount(0);

  // The preference is per user and survives a reload with the control still reachable.
  await page.getByTestId("minimize-bots-sidebar").click();
  await expect(sidebar).toHaveAttribute("data-collapsed", "true");
  await page.reload();
  await expect(page.getByTestId("bots-sidebar")).toHaveAttribute("data-collapsed", "true");
  await expect(page.getByTestId("restore-bots-sidebar")).toBeVisible();
});
