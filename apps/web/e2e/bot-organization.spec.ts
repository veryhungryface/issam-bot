import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("pinned bots and sidebar sections persist", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `bot-organize-${stamp}@rakazo.test`, "password12", "Test User");
  await completeOnboarding(page, ["A bit of everything", "Clear and tight"]);
  await page.goto("/app");
  await page.waitForURL(/\/app\/[^/]+$/);

  const sidebar = page.locator("aside").first();
  const bot = sidebar.getByRole("button", { name: /^Chief/ });

  await bot.click({ button: "right" });
  await page.getByRole("menuitem", { name: "고정", exact: true }).click();
  await expect(sidebar.locator('[data-sidebar-group="pinned"]')).toContainText("Chief");
  await captureScreenshot(page, testInfo, "pinned-bots");

  await bot.click({ button: "right" });
  await page.getByRole("menuitem", { name: "고정 해제", exact: true }).click();
  await expect(sidebar.locator('[data-sidebar-group="pinned"]')).toHaveCount(0);

  await bot.click({ button: "right" });
  await page.getByRole("menuitem", { name: "구역으로 이동", exact: true }).click();
  await captureScreenshot(page, testInfo, "move-to-section-menu");
  await page
    .getByRole("menu", { name: /Chief 구역 이동/ })
    .getByText("새 구역")
    .click();
  const dialog = page.getByRole("dialog", { name: "새 구역" });
  await dialog.getByLabel("이름").fill("Projects");
  await dialog.getByRole("button", { name: "만들기" }).click();

  const projects = sidebar.locator('[data-sidebar-group^="section:"]');
  await expect(projects).toContainText("Projects");
  await expect(projects).toContainText("Chief");
  await captureScreenshot(page, testInfo, "bot-sections");

  await page.reload();
  await expect(projects).toContainText("Projects");
  await expect(projects).toContainText("Chief");

  await bot.click({ button: "right" });
  await page.getByRole("menuitem", { name: "구역으로 이동", exact: true }).click();
  await page
    .getByRole("menu", { name: /Chief 구역 이동/ })
    .getByRole("menuitem", { name: "미지정", exact: true })
    .click();
  await expect(sidebar.locator('[data-sidebar-group="unassigned"]')).toContainText("Chief");
});
