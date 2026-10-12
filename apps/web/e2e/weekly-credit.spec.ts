import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

/**
 * The weekly credit, from the outside.
 *
 * The promise is narrow and worth holding: the meter is beside the account name whenever
 * the sidebar is on screen, and one tap on it explains the number.
 *
 * Nothing here assumes who owns the deployment. The owner seat is claimed by whichever
 * account bootstraps first, and the suite shares a database with every other spec, so a
 * fresh signup is the owner on an empty database and an ordinary account on a used one.
 * The second test sidesteps that by making its own second account, which cannot hold the
 * seat whatever ran before it — the only way to assert the limited rendering and the
 * authorization boundary without depending on test order.
 */

test("the weekly credit sits beside the account name and opens its detail", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `credit-${stamp}@rakazo.test`, "password12", "Credit QA");
  await completeOnboarding(page, testInfo);

  const aside = page.locator("aside").first();
  const pill = aside.getByTestId("credit-pill");
  await expect(pill).toBeVisible();

  // Beside the name, not under it: the same row, to the right of the trigger.
  const nameBox = await aside.getByTestId("user-menu-trigger").boundingBox();
  const pillBox = await pill.boundingBox();
  expect(nameBox).toBeTruthy();
  expect(pillBox).toBeTruthy();
  if (nameBox && pillBox) {
    const nameMiddle = nameBox.y + nameBox.height / 2;
    const pillMiddle = pillBox.y + pillBox.height / 2;
    expect(Math.abs(nameMiddle - pillMiddle)).toBeLessThanOrEqual(nameBox.height / 2);
    expect(pillBox.x).toBeGreaterThan(nameBox.x);
  }

  await pill.click();
  const detail = page.getByTestId("credit-detail").first();
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("이번 주 사용량");
  // The rate card is on screen, so the figure can be checked rather than trusted.
  await expect(detail).toContainText("1,450");
  await captureScreenshot(page, testInfo, "weekly-credit-detail");
});

test("an account that does not own the deployment gets a limit it cannot change", async ({
  browser,
}, testInfo) => {
  const stamp = Date.now();

  // Whoever owns the deployment, it is not the second account to appear here.
  const firstContext = await browser.newContext();
  const first = await firstContext.newPage();
  await signup(first, `credit-first-${stamp}@rakazo.test`, "password12", "Credit First");
  await completeOnboarding(first);
  await firstContext.close();

  const context = await browser.newContext();
  const page = await context.newPage();
  await signup(page, `credit-second-${stamp}@rakazo.test`, "password12", "Credit Second");
  await completeOnboarding(page, testInfo);

  const pill = page.locator("aside").first().getByTestId("credit-pill");
  await expect(pill).toBeVisible();
  // A limited account is shown what is left, which on an untouched week is all of it.
  await expect(pill).toHaveText("100% 남음");
  await expect(pill).toHaveAttribute("data-state", "ok");

  await pill.click();
  const detail = page.getByTestId("credit-detail").first();
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("2,000원");
  await expect(detail).toContainText("초기화");
  // Setting anyone's limit belongs to the deployment owner alone.
  await expect(page.getByTestId("credit-limits-open")).toHaveCount(0);
  await context.close();
});

test("a phone shows the meter without opening the drawer", async ({ browser }, testInfo) => {
  // The sidebar the desktop pill lives in is a drawer at this width, so the sidebar copy
  // starts off screen. "Always visible" has to mean the header copy on a phone, and this
  // is the test that would have caught shipping the feature invisible on mobile — which is
  // the only way most of these testers will ever see it.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const stamp = Date.now();
  await signup(page, `credit-phone-${stamp}@rakazo.test`, "password12", "Credit Phone");
  await completeOnboarding(page, testInfo);

  const compact = page.getByTestId("credit-pill-compact");
  await expect(compact).toBeVisible();

  // The sidebar copy is in the document but parked off screen with the drawer.
  const drawerPill = page.locator("aside").first().getByTestId("credit-pill");
  await expect(drawerPill).toHaveCount(1);
  const pageWidth = page.viewportSize()?.width ?? 0;
  const drawerBox = await drawerPill.boundingBox();
  if (drawerBox) expect(drawerBox.x + drawerBox.width).toBeLessThanOrEqual(1);

  // On screen, and inside it: a pill pushed past the right edge is not visible either.
  const compactBox = await compact.boundingBox();
  expect(compactBox).toBeTruthy();
  if (compactBox) {
    expect(compactBox.x).toBeGreaterThanOrEqual(0);
    expect(compactBox.x + compactBox.width).toBeLessThanOrEqual(pageWidth);
    expect(compactBox.y).toBeGreaterThanOrEqual(0);
  }

  // The shut state is the one worth having a picture of: it is what a tester sees.
  await captureScreenshot(page, testInfo, "weekly-credit-phone-header");

  await compact.click();
  const detail = page.getByTestId("credit-detail").first();
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("이번 주 사용량");
  await captureScreenshot(page, testInfo, "weekly-credit-phone");
  await context.close();
});
