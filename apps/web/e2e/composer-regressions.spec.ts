import { expect, test } from "@playwright/test";
import type { Bot } from "@rakazo/contracts";
import { completeOnboarding, rpc, signup } from "./helpers";

test("Korean IME confirmation does not submit early or leave the final syllable", async ({
  page,
}) => {
  const stamp = Date.now();
  await signup(page, `ime-${stamp}@rakazo.test`, "password12", "IME");
  await completeOnboarding(page, ["A bit of everything", "Clear and tight"]);

  const composer = page.getByPlaceholder("Chief에게 작업 지시");
  await composer.fill("한글 입력 확인");

  let sendRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/rpc/threads/send") && request.method() === "POST") {
      sendRequests += 1;
    }
  });

  await composer.dispatchEvent("compositionstart", { data: "인" });
  await composer.evaluate((element) => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        code: "Enter",
        isComposing: true,
        key: "Enter",
      }),
    );
  });

  await expect(composer).toHaveValue("한글 입력 확인");
  expect(sendRequests).toBe(0);

  await composer.dispatchEvent("compositionend", { data: "인" });
  const sent = page.waitForResponse(
    (response) => response.url().includes("/rpc/threads/send") && response.ok(),
  );
  await composer.press("Enter");
  await sent;
  await expect(composer).toHaveValue("");
  expect(sendRequests).toBe(1);
});

test("switching agents immediately replaces the transcript and composer draft", async ({
  page,
}) => {
  const stamp = Date.now();
  await signup(page, `switch-${stamp}@rakazo.test`, "password12", "Switch");
  await completeOnboarding(page, ["A bit of everything", "Clear and tight"]);

  await rpc<Bot>(page, "bots/create", {
    name: "Second",
    title: "",
    description: "",
    instructions: "",
    notifyOnFinish: false,
  });
  await page.reload();

  const composer = page.getByPlaceholder("Chief에게 작업 지시");
  const marker = `이전 에이전트 전용 ${stamp}`;
  await composer.fill(marker);
  const sent = page.waitForResponse(
    (response) => response.url().includes("/rpc/threads/send") && response.ok(),
  );
  await composer.press("Enter");
  await sent;
  await expect(page.getByText(marker, { exact: true })).toBeVisible();

  await composer.fill("전환하면 사라져야 하는 초안");
  await page.route("**/rpc/threads/open", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.continue();
  });

  await page
    .getByRole("complementary")
    .getByRole("button", { name: /^Second/ })
    .click();

  const secondComposer = page.getByPlaceholder("Second에게 작업 지시");
  await expect(secondComposer).toHaveValue("");
  await expect(page.getByText(marker, { exact: true })).toHaveCount(0, { timeout: 500 });
  await expect(page.getByText("대화를 불러오는 중…", { exact: true })).toBeVisible({
    timeout: 500,
  });
});
