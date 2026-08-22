import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("bot creation, editing, and deletion persist", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `bot-crud-${stamp}@rakazo.test`, "password12", "Bot CRUD");
  await completeOnboarding(page, ["A bit of everything", "Clear and tight"]);
  await page.goto("/app");
  await page.waitForURL(/\/app\/[^/]+$/);

  const botList = page.locator("aside").first();
  await expect(botList.getByRole("button", { name: /^Chief/ })).toBeVisible();

  await page.getByTitle("새 봇").click();
  await expect(page.getByText("새 봇", { exact: true })).toBeVisible();
  await page.locator("label:has-text('이름') input").fill("Researcher");
  await page.locator("label:has-text('역할') input").fill("Market researcher");
  await page
    .locator("label:has-text('상세 지시') textarea")
    .fill("Finds reliable sources and turns them into concise briefs.");
  await captureScreenshot(page, testInfo, "26-new-bot-form");
  await page.getByRole("button", { name: "만들기", exact: true }).click();

  await expect(botList.getByRole("button", { name: /^Researcher/ })).toBeVisible();
  await expect(page.getByPlaceholder("Researcher에게 작업 지시")).toBeVisible();
  await page.waitForURL(/\/app\/[^/]+$/);
  const deletedBotPath = new URL(page.url()).pathname;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(500);
  expect(new URL(page.url()).pathname).toBe(deletedBotPath);
  await captureScreenshot(page, testInfo, "27-created-bot");

  await page.locator("main").getByRole("button", { name: "Researcher", exact: true }).click();
  const nameInput = page.locator("label:has-text('이름') input");
  const titleInput = page.locator("label:has-text('역할') input");
  const descriptionInput = page.locator("label:has-text('상세 지시') textarea");
  await expect(nameInput).toHaveValue("Researcher");
  await expect(titleInput).toHaveValue("Market researcher");
  await expect(descriptionInput).toHaveValue(
    "Finds reliable sources and turns them into concise briefs.",
  );

  await nameInput.fill("Atlas");
  await titleInput.fill("Research lead");
  await descriptionInput.fill("Builds durable, source-backed research briefs.");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(botList.getByRole("button", { name: /^Atlas/ })).toBeVisible();
  await expect(page.getByPlaceholder("Atlas에게 작업 지시")).toBeVisible();
  await captureScreenshot(page, testInfo, "28-edited-bot-profile");

  await page.reload();
  await expect(botList.getByRole("button", { name: /^Atlas/ })).toBeVisible();
  await expect(page.getByPlaceholder("Atlas에게 작업 지시")).toBeVisible();
  await page.locator("main").getByRole("button", { name: "Atlas", exact: true }).click();
  await expect(nameInput).toHaveValue("Atlas");
  await expect(titleInput).toHaveValue("Research lead");
  await expect(descriptionInput).toHaveValue("Builds durable, source-backed research briefs.");
  await captureScreenshot(page, testInfo, "29-reloaded-bot-profile");

  const atlas = botList.getByRole("button", { name: /^Atlas/ });
  await atlas.click({ button: "right" });
  await page.getByRole("menuitem", { name: "삭제" }).click();
  await expect(page.getByRole("alertdialog", { name: "Atlas 봇을 삭제할까요?" })).toBeVisible();
  await captureScreenshot(page, testInfo, "30-delete-bot-confirmation");
  await page.getByRole("button", { name: "삭제", exact: true }).click();

  await expect(botList.getByText("Atlas", { exact: true })).toHaveCount(0);
  await expect(botList.getByRole("button", { name: /^Chief/ })).toBeVisible();
  await page.waitForURL((url) => url.pathname !== deletedBotPath);

  await page.goto(deletedBotPath);
  await page.waitForURL((url) => url.pathname !== deletedBotPath);
  await expect(botList.getByText("Atlas", { exact: true })).toHaveCount(0);
  await expect(botList.getByRole("button", { name: /^Chief/ })).toBeVisible();
  await expect(page.getByPlaceholder("Chief에게 작업 지시")).toBeVisible();
  await captureScreenshot(page, testInfo, "31-deleted-bot-fallback");
});
