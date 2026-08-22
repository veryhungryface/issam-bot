import { expect, type Page, test } from "@playwright/test";
import {
  activeBotId,
  captureScreenshot,
  completeOnboarding,
  realSandboxTimeout,
  rpc,
  signup,
} from "./helpers";

test.describe.configure({ mode: "serial" });

test("two users are isolated and a bot completes durable work", async ({ browser }, testInfo) => {
  const a = await browser.newContext();
  const b = await browser.newContext();
  const pageA = await a.newPage();
  const pageB = await b.newPage();

  const stamp = Date.now();
  await signup(pageA, `ada-${stamp}@rakazo.test`, "password12", "Ada", testInfo);
  await completeOnboarding(pageA, ["A bit of everything", "Clear and tight"], testInfo);
  await expect(pageA.getByText("Chief").first()).toBeVisible();

  await signup(pageB, `bob-${stamp}@rakazo.test`, "password12", "Bob");
  await completeOnboarding(pageB, ["Coding & repos", "Clear and tight"]);
  await expect(pageB.getByText("Chief").first()).toBeVisible();
  await expect(pageB.getByText("Ada")).toHaveCount(0);

  const composer = pageA.getByPlaceholder(/작업 지시/);
  await composer.fill("write a file in your home called notes/result.txt that says isolation-ok");
  const sendResponse = pageA.waitForResponse(
    (response) =>
      response.url().includes("/rpc/threads/send") && response.request().method() === "POST",
  );
  await pageA.keyboard.press("Enter");
  const sent = await sendResponse;
  expect(sent.ok()).toBe(true);
  await expect(
    pageA.getByText(/writing that into my home|isolation-ok|handled/i).first(),
  ).toBeVisible({
    timeout: 30_000,
  });

  await pageA.reload();
  await expect(pageA.getByText(/isolation-ok|writing that into my home/i).first()).toBeVisible();
  await captureScreenshot(pageA, testInfo, "07-durable-bot-work");

  await a.close();
  await b.close();
});

test("takeover, routine, plugins, and export are reachable", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `flow-${stamp}@rakazo.test`, "password12", "Flow");
  await completeOnboarding(page, ["A bit of everything", "Clear and tight"]);

  const composer = page.getByPlaceholder(/작업 지시/);
  await composer.fill("install the gsc cli and sign in");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/sign in to continue|protected input/i).first()).toBeVisible({
    timeout: realSandboxTimeout(90_000, 30_000),
  });
  await expect
    .poll(() => threadRunStatus(page), {
      timeout: realSandboxTimeout(90_000, 30_000),
      message: "the protected-input run must be ready for takeover",
    })
    .toBe("waiting_takeover");
  await captureScreenshot(page, testInfo, "08-protected-input-request");
  await page.getByTitle("에이전트 브라우저").click();
  const sidePanel = page.getByTestId("side-panel");
  await expect(sidePanel).toHaveCSS("width", "384px");
  const [mainBox, panelBox] = await Promise.all([
    page.locator("main").boundingBox(),
    sidePanel.boundingBox(),
  ]);
  expect(mainBox).not.toBeNull();
  expect(panelBox).not.toBeNull();
  expect((mainBox?.x ?? 0) + (mainBox?.width ?? 0)).toBeLessThanOrEqual(panelBox?.x ?? 0);
  await page.getByRole("button", { name: "직접 제어" }).click();
  await expect(page.getByRole("button", { name: "브라우저 닫기" })).toBeVisible();
  if (process.env.SANDBOX_PROVIDER === "box") await waitForBoxFramebuffer(page);
  await captureScreenshot(page, testInfo, "09-computer-takeover");
  await page.getByRole("button", { name: "봇에게 제어권 반환" }).last().click();
  await expect(page.getByRole("button", { name: "브라우저 닫기" })).toBeHidden();
  await expect(page.getByText(/signed in|session stays/i).first()).toBeVisible({
    timeout: realSandboxTimeout(90_000, 30_000),
  });

  await page.getByText("+ 새 자동 작업").click();
  await page.locator("label:has-text('이름') input").fill("Monday briefing");
  await page
    .locator("label:has-text('작업 지시') textarea")
    .fill("write a file in your home called notes/result.txt that says routine-ok");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByText("Monday briefing")).toBeVisible();
  await captureScreenshot(page, testInfo, "10-routine-created");

  await page.getByText("플러그인").click();
  await expect(page.getByPlaceholder("앱 검색")).toBeVisible();
  await expect(page.getByText("Gmail", { exact: true })).toBeVisible();
  await expect(page.getByText("Slack", { exact: true })).toBeVisible();
  await expect(page.getByText("GitHub", { exact: true })).toBeVisible();
  await expect(page.getByText("Notion", { exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "11-plugins-catalog");

  const gmailRow = page.getByText("Gmail", { exact: true }).locator("..").locator("..");
  await gmailRow.getByRole("button", { name: "연결", exact: true }).click();
  await expect(gmailRow.getByRole("button", { name: "연결 해제", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "연결됨", exact: true }).click();
  await expect(page.getByText("Slack", { exact: true })).toBeHidden();
  await captureScreenshot(page, testInfo, "11a-connected-plugins");

  await gmailRow.getByRole("button", { name: "연결 해제", exact: true }).click();
  await expect(page.getByText("연결된 앱이 없습니다.", { exact: true })).toBeVisible();
  await expect(page.getByText("Gmail", { exact: true })).toBeHidden();
  await captureScreenshot(page, testInfo, "11b-connected-plugins-empty");

  await page.getByRole("tab", { name: "전체", exact: true }).click();
  await expect(page.getByText("Gmail", { exact: true })).toBeVisible();
  await expect(gmailRow.getByRole("button", { name: "연결", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "플러그인 닫기" }).click();

  await page.getByText("Chief").first().click();
  const gear = page.getByRole("button", { name: "봇 설정" });
  if (!(await gear.isVisible().catch(() => false))) {
    await page.getByTitle("에이전트 브라우저").click();
  }
  await gear.click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "내보내기" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/chief-export\.json/i);
  const settings = page.getByTestId("bot-settings");
  await expect(settings.getByRole("button", { name: "Archive bot" })).toHaveCount(0);
  await expect(settings.getByRole("button", { name: "Delete bot" })).toHaveCount(0);
  await page.getByRole("button", { name: "패널 닫기" }).click();

  await page.locator("aside").first().getByRole("button", { name: /Chief/ }).first().click({
    button: "right",
  });
  const botMenu = page.getByRole("menu", { name: "Chief 작업 메뉴" });
  await expect(botMenu.getByRole("menuitem", { name: "보관" })).toBeVisible();
  await botMenu.getByRole("menuitem", { name: "삭제" }).click();
  await expect(page.getByRole("radio", { name: /메모리 유지/ })).toBeChecked();
  await expect(page.getByRole("radio", { name: /메모리도 삭제/ })).toBeVisible();
  await page.getByRole("button", { name: "취소" }).click();
  await captureScreenshot(page, testInfo, "12-bot-settings");
});

test("sign-in, spawn, and stop work in the shell", async ({ page }, testInfo) => {
  const stamp = Date.now();
  const email = `shell-${stamp}@rakazo.test`;
  await signup(page, email, "password12", "Shell");
  await completeOnboarding(page, ["A bit of everything", "Clear and tight"]);

  const composer = page.getByPlaceholder(/작업 지시/);
  await composer.fill("spawn a bot named Scout to research venues");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("complementary").getByRole("button", { name: /Scout/ })).toBeVisible({
    timeout: 30_000,
  });
  await captureScreenshot(page, testInfo, "13-spawned-bot");

  await page
    .getByRole("complementary")
    .getByRole("button", { name: /^Chief/ })
    .click();
  await composer.fill("keep working until I stop you");
  await page.keyboard.press("Enter");
  await expect(page.getByText("still working").first()).toBeVisible({ timeout: 30_000 });
  await captureScreenshot(page, testInfo, "14-active-bot-work");
  await page.getByRole("button", { name: "작업 중지", exact: true }).click();
  await expect(page.getByRole("button", { name: "전송" })).toBeVisible({ timeout: 30_000 });

  await page.context().clearCookies();
  await page.goto("/sign-in");
  await page.getByPlaceholder("이메일 주소").fill(email);
  await page.getByPlaceholder("비밀번호 (8자 이상)").fill("password12");
  await page.getByRole("button", { name: "이메일로 로그인" }).click();
  await page.waitForURL(/\/app/, { timeout: 20_000 });
  await expect(
    page.getByRole("complementary").getByRole("button", { name: /^Chief/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("complementary").getByRole("button", { name: /Scout/ }),
  ).toBeVisible();
  await captureScreenshot(page, testInfo, "15-restored-session");
});

test("bot context menu pins, duplicates, edits, and confirms deletion", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `menu-${stamp}@rakazo.test`, "password12", "Menu");
  await completeOnboarding(page, ["A bit of everything", "Clear and tight"]);

  const chief = page.getByRole("button", { name: /Chief/ }).first();
  await chief.click({ button: "right" });
  await expect(page.getByRole("menu", { name: "Chief 작업 메뉴" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "봇 설정" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "복제" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "삭제" })).toBeVisible();
  await captureScreenshot(page, testInfo, "16-bot-context-menu");
  await page.getByRole("menuitem", { name: "읽지 않음으로 표시" }).click();

  // Chief is the open bot, so the auto-read on window focus must not undo the manual mark.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await chief.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "읽음으로 표시" })).toBeVisible();
  await page.getByRole("menuitem", { name: "읽음으로 표시" }).click();

  await chief.click({ button: "right" });
  await page.getByRole("menuitem", { name: "고정", exact: true }).click();

  await chief.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "고정 해제", exact: true })).toBeVisible();
  await page.getByRole("menuitem", { name: "복제" }).click();
  await expect(page.getByText("Chief copy").first()).toBeVisible();
  await captureScreenshot(page, testInfo, "17-pinned-and-duplicated-bot");

  const copy = page.getByRole("button", { name: /Chief copy/ }).first();
  await copy.click({ button: "right" });
  await page.getByRole("menuitem", { name: "삭제" }).click();
  await expect(
    page.getByRole("alertdialog", { name: "Chief copy 봇을 삭제할까요?" }),
  ).toBeVisible();
  await captureScreenshot(page, testInfo, "18-delete-confirmation");
  await page.getByRole("button", { name: "취소" }).click();

  await chief.click({ button: "right" });
  await page.getByRole("menuitem", { name: "봇 설정" }).click();
  await expect(page.locator("label:has-text('이름') input")).toHaveValue("Chief");
  await captureScreenshot(page, testInfo, "19-edit-profile");
});

async function threadRunStatus(page: Page) {
  const result = await rpc<{ run?: { status?: string } | null }>(page, "threads/get", {
    botId: activeBotId(page),
  });
  return result.run?.status ?? "idle";
}

async function waitForBoxFramebuffer(page: Page) {
  await expect
    .poll(
      async () => {
        for (const frame of page.frames()) {
          if (frame === page.mainFrame()) continue;
          const canvas = frame.locator("canvas").first();
          if ((await canvas.count()) === 0) continue;
          const ready = await canvas
            .evaluate((element) => {
              const framebuffer = element as HTMLCanvasElement;
              return framebuffer.width > 0 && framebuffer.height > 0;
            })
            .catch(() => false);
          if (ready) return true;
        }
        return false;
      },
      { timeout: 60_000, message: "the Box noVNC framebuffer must be ready" },
    )
    .toBe(true);
}
