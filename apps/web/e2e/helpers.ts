import { expect, type Page, type TestInfo } from "@playwright/test";

export function isRealSandboxProvider(provider = process.env.SANDBOX_PROVIDER) {
  return provider === "e2b" || provider === "daytona" || provider === "box";
}

export function realSandboxTimeout(real: number, emulated: number) {
  if (process.env.SANDBOX_PROVIDER === "box") return Math.max(real, 300_000);
  return isRealSandboxProvider() ? real : emulated;
}

export function activeBotId(page: Page) {
  const id = new URL(page.url()).pathname.split("/").filter(Boolean).at(-1);
  if (!id || id === "app") throw new Error(`missing bot id in ${page.url()}`);
  return id;
}

export async function rpc<T>(page: Page, procedure: string, body: unknown): Promise<T> {
  const response = await page.request.post(`/rpc/${procedure}`, {
    data: { json: body },
  });
  const parsed = (await response.json()) as {
    json?: T;
    error?: { message?: string };
  };
  if (!response.ok() || parsed.error) {
    throw new Error(`${procedure} ${response.status()}: ${parsed.error?.message ?? "failed"}`);
  }
  return parsed.json as T;
}

export async function completeOnboarding(page: Page, answers: string[], testInfo?: TestInfo) {
  await page.waitForURL(/\/(onboarding|app)/, { timeout: 20_000 });
  const heading = page.getByRole("heading", {
    name: /AI 모델 연결|첫 번째 봇 만들기/,
  });
  const chief = page.getByText("Chief").first();
  await heading.or(chief).waitFor({ timeout: 20_000 });
  if ((await chief.isVisible().catch(() => false)) && page.url().includes("/app")) return;
  if (
    await page
      .getByRole("heading", { name: "AI 모델 연결" })
      .isVisible()
      .catch(() => false)
  ) {
    if (testInfo) await captureScreenshot(page, testInfo, "02-connect-model");
    await page.getByRole("button", { name: "지금은 건너뛰기" }).click();
    await page
      .getByRole("heading", { name: "첫 번째 봇 만들기" })
      .or(chief)
      .waitFor({ timeout: 20_000 });
  }
  if (
    await page
      .getByRole("heading", { name: "첫 번째 봇 만들기" })
      .isVisible()
      .catch(() => false)
  ) {
    if (testInfo) await captureScreenshot(page, testInfo, "03-create-first-bot");
    await page.locator("label:has-text('이름') input").fill("Chief");
    await page.getByRole("button", { name: "계속" }).click();
    for (const [index, answer] of answers.entries()) {
      const localized: Record<string, string> = {
        "A bit of everything": "여러 가지 업무",
        "Clear and tight": "명확하고 간결하게",
        "Inbox & email": "메일함 및 이메일",
        "Slack & messages": "메신저 및 메시지",
        "Coding & repos": "코딩 및 저장소",
        "Research & writing": "조사 및 글쓰기",
        "Warm and conversational": "따뜻하고 자연스럽게",
        "Polished / formal": "정중하고 격식 있게",
        "Match whatever I draft": "내 초안에 맞춰서",
      };
      const option = page.getByText(localized[answer] ?? answer, {
        exact: true,
      });
      await expect(option).toBeVisible();
      if (testInfo) {
        await captureScreenshot(page, testInfo, `0${index + 4}-onboarding-question-${index + 1}`);
      }
      await option.click();
    }
    const created = page.waitForResponse(
      (response) => response.url().includes("/rpc/bots/create") && response.ok(),
    );
    await page.getByRole("button", { name: "Issam Bot 시작하기" }).click();
    await created;
    await page.waitForURL(/\/app/, { timeout: 5_000 }).catch(() => page.goto("/app"));
  }
  await page.waitForURL(/\/app/);
  await expect(page.getByText("Chief").first()).toBeVisible();
  if (testInfo) await captureScreenshot(page, testInfo, "06-onboarding-complete");
}

export async function signup(
  page: Page,
  email: string,
  password: string,
  name: string,
  testInfo?: TestInfo,
) {
  await page.goto("/sign-up");
  await expect(page.getByRole("heading", { name: "Issam Bot 시작하기" })).toBeVisible();
  if (testInfo) await captureScreenshot(page, testInfo, "01-sign-up");
  await page.getByPlaceholder("이름을 입력하세요").fill(name);
  await page.getByPlaceholder("이메일 주소").fill(email);
  await page.getByPlaceholder("비밀번호 (8자 이상)").fill(password);
  await page.getByRole("button", { name: "계정 만들기" }).click();
}

export async function captureScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const screenshotPath = testInfo.outputPath(`${name}.png`);
  await page.screenshot({
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    path: screenshotPath,
  });
  await testInfo.attach(name, {
    contentType: "image/png",
    path: screenshotPath,
  });
}
