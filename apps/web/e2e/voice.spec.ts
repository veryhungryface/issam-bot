import { expect, test } from "@playwright/test";
import { completeOnboarding, rpc, signup } from "./helpers";

/**
 * Speaking replies and calling are hidden in this deployment, so the suite turns the whole
 * feature back on exactly the way a person would — which keeps this covering the real
 * feature rather than a build nobody runs.
 */
test("voice settings connect a key, speak a reply, and open a call", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("rakazo.voice-output", "1"));
  const stamp = Date.now();
  const userName = `Voice ${stamp}`;
  await signup(page, `voice-${stamp}@rakazo.test`, "password12", userName);
  await completeOnboarding(page);

  // Calling lives in the menu now; the conversation header is the bot, not a toolbar.
  const openMenu = () => page.getByRole("button", { name: new RegExp(userName) }).click();

  await openMenu();
  await page.getByRole("button", { name: "Call", exact: true }).click();
  await expect(page.getByTestId("voice-settings")).toBeVisible();
  await expect(page.getByText("Not configured")).toBeVisible();
  await page.getByRole("button", { name: "Close voice settings" }).click();
  await expect(page.getByTestId("voice-settings")).toHaveCount(0);

  const preparedOff = await rpc<{ ready: boolean }>(page, "voice/prepare", {
    text: "Hello there.",
  });
  expect(preparedOff.ready).toBe(false);

  await openMenu();
  await page.getByRole("button", { name: "Voice", exact: true }).click();
  await expect(page.getByTestId("voice-settings")).toBeVisible();
  await page.getByRole("button", { name: /Scripted/ }).click();
  const apiKeyInput = page.getByPlaceholder(/Paste your API key/);
  await expect(apiKeyInput).toHaveAttribute("autocomplete", "new-password");
  await apiKeyInput.fill("fake-scripted-voice-key");
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByText("Connected", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Connected · Scripted/)).toBeVisible();

  const spoken = page.waitForResponse(
    (response) => response.url().includes("/api/voice/speak") && response.ok(),
  );
  await page.getByRole("button", { name: "Hear a sample" }).click();
  const clip = await spoken;
  expect(clip.headers()["content-type"]).toContain("audio/mpeg");

  const credentials = await rpc<Array<{ hasKey: boolean; provider: string }>>(
    page,
    "voice/credentials",
    {},
  );
  expect(credentials).toEqual([expect.objectContaining({ hasKey: true, provider: "scripted" })]);
  expect(JSON.stringify(credentials)).not.toContain("fake-scripted-voice-key");

  await page.getByRole("button", { name: "Close voice settings" }).click();

  const composer = page.getByPlaceholder(/Message/);
  await composer.fill("say hello");
  await page.keyboard.press("Enter");
  // A reply can render more than one text bubble; speak the latest one.
  const speakReply = page.getByRole("button", { name: "Speak this reply" }).last();
  await expect(speakReply).toBeVisible({
    timeout: 30_000,
  });

  const replySpoken = page.waitForResponse(
    (response) => response.url().includes("/api/voice/speak") && response.ok(),
  );
  await speakReply.click();
  await replySpoken;

  await openMenu();
  await page.getByRole("button", { name: "Call", exact: true }).click();
  await expect(page.getByTestId("call-view")).toBeVisible();
  await expect(page.getByRole("button", { name: "Hang up" })).toBeVisible();
  await page.getByRole("button", { name: "Hang up" }).click();
  await expect(page.getByTestId("call-view")).toHaveCount(0);
});

test("nothing offers to speak or call unless the deployment turns it on", async ({ page }) => {
  const stamp = Date.now();
  const userName = `Quiet ${stamp}`;
  await signup(page, `quiet-${stamp}@rakazo.test`, "password12", userName);
  await completeOnboarding(page);

  await page.getByRole("button", { name: new RegExp(userName) }).click();
  await expect(page.getByRole("button", { name: "Memory", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Call", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Voice", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Nor does a bot's own settings offer to read its replies out.
  await page.locator("main").getByRole("button", { name: "Chief", exact: true }).click();
  await expect(page.getByTestId("bot-settings")).toBeVisible();
  await expect(page.getByText("Read replies aloud")).toHaveCount(0);

  // Talking to a bot is a different feature and is still here.
  await expect(page.getByRole("button", { name: "Dictate" })).toBeVisible();
});
