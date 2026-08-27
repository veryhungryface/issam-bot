import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("routine run-now completes and survives reload", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `routine-${stamp}@rakazo.test`, "password12", "Routine");
  await completeOnboarding(page);

  await page.getByTitle("에이전트 브라우저").click();
  await expect(page.getByRole("button", { name: "지금 실행" })).toHaveCount(0);
  await page.getByText("+ 새 자동 작업").click();
  await page.locator("label:has-text('이름') input").fill("Daily verification");
  await page
    .locator("label:has-text('작업 지시') textarea")
    .fill("write routine-run-now-ok into the durable task result");
  await page.getByLabel("실행 주기").selectOption("Weekdays");
  await expect(page.getByText("평일", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("오전 9:00에", { exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "32-routine-configured");

  await page.getByRole("button", { name: "저장" }).click();
  const routine = page.getByRole("button", { name: /Daily verification/ });
  await expect(routine).toContainText("평일 오전 9:00에");
  await captureScreenshot(page, testInfo, "33-routine-scheduled");

  await routine.click();
  await page.getByRole("button", { name: "지금 실행" }).click();
  await expect(page.getByText(/routine-run-now-ok/i).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "전송" })).toBeVisible({ timeout: 30_000 });
  await captureScreenshot(page, testInfo, "34-routine-run-completed");

  await page.reload();
  await expect(page.getByText(/routine-run-now-ok/i).first()).toBeVisible();
  await page.getByTitle("에이전트 브라우저").click();
  await expect(page.getByRole("button", { name: /Daily verification/ })).toContainText(
    "평일 오전 9:00에",
  );
  await captureScreenshot(page, testInfo, "35-routine-run-persisted");
});
