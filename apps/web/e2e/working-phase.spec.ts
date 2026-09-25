import { expect, test } from "@playwright/test";
import { activeBotId, completeOnboarding, rpc, signup } from "./helpers";

/**
 * A run boots a browser and makes its first model call before it can say anything. That was
 * half a minute of a silent avatar, which reads as a stuck bot: the phase says which of the
 * two it is, from state the shell already has.
 */
test("a running turn says what it is doing before the bot speaks", async ({ page }) => {
  const stamp = Date.now();
  await signup(page, `working-phase-${stamp}@rakazo.test`, "password12", "Working Phase");
  await completeOnboarding(page);

  const botId = activeBotId(page);
  const composer = page.getByPlaceholder(/Message/);
  await composer.fill("keep working until I stop you");
  await page.keyboard.press("Enter");

  const phase = page.getByTestId("working-phase");
  await expect(phase).toBeVisible({ timeout: 30_000 });
  await expect(phase).toHaveText(/Thinking…|Opening the browser…/);

  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect
    .poll(
      async () => {
        const snapshot = await rpc<{ run?: { status: string } | null }>(page, "threads/get", {
          botId,
        });
        return snapshot.run?.status ?? "none";
      },
      { timeout: 30_000 },
    )
    .not.toMatch(/queued|leased|running/);
  // Nothing is running, so nothing claims to be.
  await expect(phase).toHaveCount(0);
});
