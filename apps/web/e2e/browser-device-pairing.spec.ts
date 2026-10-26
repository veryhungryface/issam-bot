import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

/**
 * Pairing a teacher's own Chrome, against the real API.
 *
 * Nothing is stubbed here: the device row, its encrypted token and the pairing code all come
 * from the deployment. That matters more than it usually would, because the token is readable
 * exactly once — if `pair` ever stopped returning it, or the code stopped carrying it, no
 * extension could ever be connected and no test short of this one would notice.
 */
test("a teacher pairs a browser, reads the code once, and unpairs it", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  const userName = `Pairing ${stamp}`;
  await signup(page, `pairing-${stamp}@rakazo.test`, "password12", userName);
  await completeOnboarding(page);

  await page.getByRole("button", { name: new RegExp(userName) }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByTestId("user-settings");
  const panel = settings.getByTestId("browser-device-settings");
  await expect(panel).toBeVisible();
  await expect(panel.getByText("연결된 크롬이 없습니다")).toBeVisible();

  await panel.getByLabel("연결할 크롬 이름").fill("교무실 노트북");
  await panel.getByRole("button", { name: "크롬 연결" }).click();

  const code = panel.getByTestId("browser-device-code");
  await expect(code).toBeVisible();
  // The code is the token's only carrier, so its shape is part of the contract.
  await expect(code.getByLabel("연결 코드")).toHaveValue(/^issam1\.[A-Za-z0-9_-]{40,}$/);
  await expect(code.getByText("이 코드는 지금 한 번만 보입니다", { exact: false })).toBeVisible();

  // A device that has never polled must read as asleep, not as ready for work.
  await expect(panel.getByText("교무실 노트북", { exact: true })).toBeVisible();
  await expect(panel.getByText("꺼져 있음 · 아직 연결되지 않았습니다")).toBeVisible();
  await captureScreenshot(page, testInfo, "browser-device-pairing");

  await code.getByRole("button", { name: "닫기" }).click();
  await expect(code).toHaveCount(0);

  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain("더 이상 작업을 받지 못합니다");
    void dialog.accept();
  });
  await panel.getByRole("button", { name: "연결 해제" }).click();
  await expect(panel.getByText("연결된 크롬이 없습니다")).toBeVisible();
});
