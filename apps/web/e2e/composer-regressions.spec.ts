import { expect, test } from "@playwright/test";
import { completeOnboarding, signup } from "./helpers";

test("Korean IME confirmation does not submit early or leave the final syllable", async ({
  page,
}) => {
  const stamp = Date.now();
  await signup(page, `ime-${stamp}@rakazo.test`, "password12", "IME");
  await completeOnboarding(page);

  // The placeholder disappears once the draft has content, so resolve the
  // composer structurally instead of by placeholder for the later actions.
  await page.getByPlaceholder(/Message /).waitFor();
  const composer = page.locator("textarea").first();
  await composer.fill("한글 입력 확인");

  let sendRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/rpc/threads/send") && request.method() === "POST") {
      sendRequests += 1;
    }
  });

  // An IME confirms a composition with Enter; that keydown carries isComposing
  // and must not submit the message.
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
