import { expect, test } from "@playwright/test";
import { completeOnboarding, rpc, signup } from "./helpers";

test("voice settings connect a key, speak a reply, and open a call", async ({ page }) => {
  const stamp = Date.now();
  const userName = `Voice ${stamp}`;
  await signup(page, `voice-${stamp}@rakazo.test`, "password12", userName);
  await completeOnboarding(page, ["A bit of everything", "Clear and tight"]);

  await page.getByRole("button", { name: "통화" }).click();
  await expect(page.getByTestId("voice-settings")).toBeVisible();
  await expect(page.getByText("설정되지 않음")).toBeVisible();
  await page.getByRole("button", { name: "음성 설정 닫기" }).click();
  await expect(page.getByTestId("voice-settings")).toHaveCount(0);

  const preparedOff = await rpc<{ ready: boolean }>(page, "voice/prepare", {
    text: "Hello there.",
  });
  expect(preparedOff.ready).toBe(false);

  await page.getByRole("button", { name: new RegExp(userName) }).click();
  await page.getByRole("button", { name: "음성", exact: true }).click();
  await expect(page.getByTestId("voice-settings")).toBeVisible();
  await page.getByRole("button", { name: /Scripted/ }).click();
  await page.getByPlaceholder(/API 키 붙여넣기/).fill("fake-scripted-voice-key");
  await page.getByRole("button", { name: "연결" }).click();
  await expect(page.getByText("연결됨", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/연결됨 · Scripted/)).toBeVisible();

  const spoken = page.waitForResponse(
    (response) => response.url().includes("/api/voice/speak") && response.ok(),
  );
  await page.getByRole("button", { name: "샘플 듣기" }).click();
  const clip = await spoken;
  expect(clip.headers()["content-type"]).toContain("audio/mpeg");

  const credentials = await rpc<Array<{ hasKey: boolean; provider: string }>>(
    page,
    "voice/credentials",
    {},
  );
  expect(credentials).toEqual([expect.objectContaining({ hasKey: true, provider: "scripted" })]);
  expect(JSON.stringify(credentials)).not.toContain("fake-scripted-voice-key");

  await page.getByRole("button", { name: "음성 설정 닫기" }).click();

  const composer = page.getByPlaceholder(/작업 지시/);
  await composer.fill("say hello");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "답변 읽기" })).toBeVisible({
    timeout: 30_000,
  });

  const replySpoken = page.waitForResponse(
    (response) => response.url().includes("/api/voice/speak") && response.ok(),
  );
  await page.getByRole("button", { name: "답변 읽기" }).click();
  await replySpoken;

  await page.getByRole("button", { name: "통화" }).click();
  await expect(page.getByTestId("call-view")).toBeVisible();
  await expect(page.getByRole("button", { name: "통화 종료" })).toBeVisible();
  await page.getByRole("button", { name: "통화 종료" }).click();
  await expect(page.getByTestId("call-view")).toHaveCount(0);
});
