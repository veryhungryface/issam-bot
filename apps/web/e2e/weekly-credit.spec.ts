import type { Browser, Page, TestInfo } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

/**
 * The weekly credit, from the outside.
 *
 * The promise is narrow and worth holding: whenever the sidebar is on screen, an account
 * with a limit can read what share of it is left beside its own name, and Settings — one
 * place, not four — says what the week went to.
 *
 * Nothing here assumes who owns the deployment, and most of it cannot afford to. The owner
 * seat is claimed by whichever account bootstraps first, the suite shares a database with
 * every other spec, and an owner has no limit and so no pill at all. Every test that wants
 * to see a pill therefore spends an account on claiming the seat first, so the account it
 * actually drives is limited whatever ran before it.
 */

/** Burn an account on the owner seat, so the next one to sign up is an ordinary user. */
async function claimOwnerSeat(browser: Browser, stamp: number): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signup(page, `credit-seat-${stamp}@rakazo.test`, "password12", "Credit Seat");
  await completeOnboarding(page);
  await context.close();
}

/** Open the one door onto the usage section, and hand back the detail inside it. */
async function openUsage(page: Page) {
  await page.getByTestId("user-menu-trigger").click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const section = page.getByTestId("usage-settings");
  await expect(section).toBeVisible();
  return section;
}

async function limitedAccount(browser: Browser, stamp: number, label: string, testInfo?: TestInfo) {
  await claimOwnerSeat(browser, stamp);
  const context = await browser.newContext();
  const page = await context.newPage();
  await signup(page, `credit-${label}-${stamp}@rakazo.test`, "password12", `Credit ${label}`);
  await completeOnboarding(page, testInfo);
  return { context, page };
}

test("the weekly credit sits beside the account name, and says only the share", async ({
  browser,
}, testInfo) => {
  const { context, page } = await limitedAccount(browser, Date.now(), "beside", testInfo);

  const aside = page.locator("aside").first();
  const pill = aside.getByTestId("credit-pill");
  await expect(pill).toBeVisible();
  await expect(pill).toHaveText("100% 남음");

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

  // No money on a surface every screen carries, and nothing to press: the pill is a
  // readout. It used to be the third door onto the usage panel.
  await expect(pill).not.toContainText("원");
  await expect(pill).toHaveJSProperty("tagName", "SPAN");
  await captureScreenshot(page, testInfo, "weekly-credit-pill");
  await context.close();
});

test("an account that does not own the deployment gets a limit it cannot change", async ({
  browser,
}, testInfo) => {
  const { context, page } = await limitedAccount(browser, Date.now(), "second", testInfo);

  const pill = page.locator("aside").first().getByTestId("credit-pill");
  await expect(pill).toBeVisible();
  // A limited account is shown what is left, which on an untouched week is all of it.
  await expect(pill).toHaveText("100% 남음");
  await expect(pill).toHaveAttribute("data-state", "ok");

  const section = await openUsage(page);
  const detail = section.getByTestId("credit-detail");
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("100% 남음");
  await expect(detail).toContainText("초기화");
  // What the week costs the school is not the teacher's business, in either direction: no
  // won on the way in and none in the detail.
  await expect(detail).not.toContainText("원");
  // Setting anyone's limit belongs to the deployment owner alone.
  await expect(page.getByTestId("credit-limits-open")).toHaveCount(0);
  await context.close();
});

test("a phone shows the meter without opening the drawer", async ({ browser }, testInfo) => {
  // The sidebar the desktop pill lives in is a drawer at this width, so the sidebar copy
  // starts off screen. "Always visible" has to mean the header copy on a phone, and this
  // is the test that would have caught shipping the feature invisible on mobile — which is
  // the only way most of these testers will ever see it.
  const stamp = Date.now();
  await claimOwnerSeat(browser, stamp);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await signup(page, `credit-phone-${stamp}@rakazo.test`, "password12", "Credit Phone");
  await completeOnboarding(page, testInfo);

  const compact = page.getByTestId("credit-pill-compact");
  await expect(compact).toBeVisible();
  await expect(compact).toHaveText("100% 남음");

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
  await context.close();
});

test("the settings panel fills its usage section in", async ({ page }, testInfo) => {
  // The report that prompted this: opening Settings from the gear showed a 사용량 heading
  // with nothing under it. The numbers only arrived if the reader had pressed the menu's
  // Usage entry at some earlier point in the session, which nobody does. The panel fetches
  // on open now, and this is the door that was broken. It runs for owner and teacher alike,
  // since both have a usage section even though only one of them has a pill.
  const stamp = Date.now();
  await signup(page, `credit-settings-${stamp}@rakazo.test`, "password12", "Credit Settings");
  await completeOnboarding(page, testInfo);

  const section = await openUsage(page);
  const detail = section.getByTestId("credit-detail");
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("이번 주 사용량");
  // The all-time line comes from the other call the panel makes on open.
  await expect(section).toContainText("전체 기간");
  await captureScreenshot(page, testInfo, "weekly-credit-settings");
});

test("there is one way into the usage section, not four", async ({ page }, testInfo) => {
  // Settings, the menu's Usage entry, the pill, and the composer's `/Settings: Usage` all
  // landed on this same panel. Four doors onto one room read as four rooms until you have
  // opened all of them, which is what the complaint was.
  const stamp = Date.now();
  await signup(page, `credit-doors-${stamp}@rakazo.test`, "password12", "Credit Doors");
  await completeOnboarding(page, testInfo);

  await page.getByTestId("user-menu-trigger").click();
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Usage", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // The composer's slash menu names the account panel once.
  await page.getByRole("combobox", { name: /^Message/ }).fill("/Settings");
  const picker = page.getByTestId("slash-picker");
  await expect(picker.getByRole("button", { name: "Settings: General" })).toBeVisible();
  await expect(picker.getByRole("button", { name: "Settings: Usage" })).toHaveCount(0);
});
