import { expect, test } from "@playwright/test";
import { activeBotId, captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

/**
 * The sign-in sheet shipped disabled: it rendered, said "Action needed", and accepted
 * nothing, because the shell only marked `ask` blocks as answerable. Typing into it is the
 * whole feature, so the fields, the checkbox and the buttons are asserted live.
 */
test("the browser sign-in sheet accepts typing and submits", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `browser-login-card-${stamp}@rakazo.test`, "password12", "Login Card");
  await completeOnboarding(page);

  const botId = activeBotId(page);
  const composer = page.getByPlaceholder(/Message/);
  await composer.fill("sign in to the portal");
  await page.keyboard.press("Enter");

  await expect
    .poll(
      async () => {
        const snapshot = await rpc<{ run?: { status: string } | null }>(page, "threads/get", {
          botId,
        });
        return snapshot.run?.status ?? null;
      },
      { timeout: 60_000 },
    )
    .toBe("waiting_input");

  // threads/get can observe waiting_input before the realtime feed paints the card.
  const card = page.getByTestId("browser-login-card");
  if ((await card.count()) === 0) {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByPlaceholder(/Message/)).toBeVisible({ timeout: 15_000 });
  }
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card.getByText("Action needed")).toBeVisible();

  const id = card.locator('input[autocomplete="username"]');
  const password = card.locator('input[type="password"]');
  await expect(id).toBeEditable();
  await expect(password).toBeEditable();

  const submit = page.getByTestId("browser-login-submit");
  // Nothing typed yet: there is nothing to send.
  await expect(submit).toBeDisabled();

  await id.fill("teacher");
  await password.fill("unlikely-plaintext-2f9a41");
  await expect(id).toHaveValue("teacher");

  const save = card.getByRole("checkbox");
  await expect(save).toBeEnabled();
  await save.click();
  await expect(save).not.toBeChecked();
  await save.click();
  await expect(save).toBeChecked();

  await captureScreenshot(page, testInfo, "browser-login-card");
  await expect(submit).toBeEnabled();
  await submit.click();

  // The sheet resolves, and the password never appears in the transcript.
  await expect(card.getByText("Action needed")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId("transcript")).not.toContainText("unlikely-plaintext-2f9a41");
});
