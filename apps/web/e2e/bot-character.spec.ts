import { expect, type Page, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

function sidebarFace(page: Page) {
  return page
    .locator("aside")
    .first()
    .getByRole("button", { name: /^Chief/ })
    .locator("svg.rakazo-avatar")
    .first();
}

async function openSettings(page: Page) {
  await page.locator("main").getByRole("button", { name: "Chief", exact: true }).click();
  await expect(page.getByTestId("bot-settings")).toBeVisible();
}

/**
 * Choosing a character used to look like it worked and then not stick: the panel you chose
 * it in kept it, and every other place a bot is drawn — the list, the header — went on
 * deriving a character from the bot's id, because those call sites only ever had the id.
 */
test("a chosen character follows the bot out of the panel", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `bot-character-${stamp}@rakazo.test`, "password12", "Bot Character");
  await completeOnboarding(page);

  const seen: string[] = [];
  for (const body of ["0", "3"]) {
    await openSettings(page);
    const swatch = page.locator(`label:has([data-testid="character-body-${body}"])`);
    const wanted = await swatch.locator("svg.rakazo-avatar").getAttribute("data-body");
    expect(wanted).toBeTruthy();
    await swatch.click();
    await page
      .getByTestId("bot-settings")
      .getByRole("button", { name: "Save", exact: true })
      .click();

    // The list beside the panel, and the bot floating over the conversation — not the
    // preview inside the panel, which worked all along.
    await expect(sidebarFace(page)).toHaveAttribute("data-body", String(wanted));
    await expect(page.locator("main").locator("svg.rakazo-avatar").first()).toHaveAttribute(
      "data-body",
      String(wanted),
    );
    seen.push(String(wanted));
  }
  // Two different shapes, so neither pass can have passed by drawing the same thing twice.
  expect(seen[0]).not.toBe(seen[1]);
  await captureScreenshot(page, testInfo, "character-in-the-list");

  // And it is still there on the next visit, rather than living in the panel's state.
  await page.reload();
  await expect(sidebarFace(page)).toHaveAttribute("data-body", String(seen[1]));
});

/**
 * On a phone the settings panel floats over the conversation, and the composer floated
 * over the panel — covering the bottom of it, which is where Save is.
 */
test("the phone's message box does not cover the panel", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const stamp = Date.now();
  await signup(page, `panel-over-composer-${stamp}@rakazo.test`, "password12", "Panel Over");
  await completeOnboarding(page);
  await openSettings(page);
  await captureScreenshot(page, testInfo, "phone-settings-over-composer");

  // Whatever is on top at the foot of the panel has to belong to the panel.
  const foot = await page.getByTestId("side-panel").evaluate((panel) => {
    const box = panel.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.bottom - 8);
    return {
      inPanel: Boolean(hit?.closest('[data-testid="side-panel"]')),
      inConversation: Boolean(hit?.closest('[data-testid="conversation"]')),
    };
  });
  expect(foot).toEqual({ inPanel: true, inConversation: false });

  // Which also means a tap on Save reaches Save.
  const save = page.getByTestId("bot-settings").getByRole("button", { name: "Save", exact: true });
  await page.locator('label:has-text("Name") input').fill("Dressed");
  await save.click();
  await expect(
    page
      .locator("aside")
      .first()
      .getByRole("button", { name: /^Dressed/ }),
  ).toBeVisible();
});
