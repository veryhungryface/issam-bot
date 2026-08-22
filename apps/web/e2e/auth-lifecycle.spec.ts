import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("logout protects bot deep links and sign-in restores the session", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  const email = `auth-lifecycle-${stamp}@rakazo.test`;
  const password = "password12";
  const userName = "Auth Lifecycle";

  await signup(page, email, password, userName);
  await completeOnboarding(page, ["A bit of everything", "Clear and tight"]);

  await page.waitForURL(/\/app\/[^/]+$/);
  const protectedBotPath = new URL(page.url()).pathname;
  await expect(page.getByPlaceholder("Chief에게 작업 지시")).toBeVisible();

  await page.getByRole("button", { name: new RegExp(userName, "i") }).click();
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
  await captureScreenshot(page, testInfo, "36-account-menu");

  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page.getByRole("heading", { name: "Issam Bot 로그인" })).toBeVisible();
  await page.goto("/");
  await expect(page.getByText(/Your team of always-on agents/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Sign in/ })).toBeVisible();
  await captureScreenshot(page, testInfo, "37-logged-out-welcome");

  await page.goto(protectedBotPath);
  await page.waitForURL((url) => url.pathname === "/sign-in");
  await expect(page.getByRole("heading", { name: "Issam Bot 로그인" })).toBeVisible();
  await expect(page.getByText("Chief", { exact: true })).toHaveCount(0);
  await expect(page.getByText(userName, { exact: true })).toHaveCount(0);
  await captureScreenshot(page, testInfo, "38-protected-deep-link-sign-in");

  await page.getByPlaceholder("이메일 주소").fill(email);
  await page.getByPlaceholder("비밀번호 (8자 이상)").fill("wrong-password12");
  await page.getByRole("button", { name: "이메일로 로그인" }).click();
  await expect(
    page
      .locator("form")
      .getByText(/invalid email or password|invalid credentials|incorrect password/i),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in$/);
  await captureScreenshot(page, testInfo, "39-invalid-credentials");

  await page.getByPlaceholder("비밀번호 (8자 이상)").fill(password);
  await page.getByRole("button", { name: "이메일로 로그인" }).click();
  await page.waitForURL((url) => url.pathname === protectedBotPath, {
    timeout: 20_000,
  });
  await expect(page.getByPlaceholder("Chief에게 작업 지시")).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(userName, "i") })).toBeVisible();
  await captureScreenshot(page, testInfo, "40-restored-auth-session");
});
