import { expect, type Locator, type Page, type TestInfo, test } from "@playwright/test";

async function captureScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const screenshotPath = testInfo.outputPath(`${name}.png`);
  // Screenshots are attachments for humans, not assertions. The homepage runs
  // JS-driven animation, so a full-page capture can wait on layout stability
  // forever in CI — bound it and let the test continue without the image.
  try {
    await page.screenshot({
      animations: "disabled",
      caret: "hide",
      fullPage: true,
      path: screenshotPath,
      timeout: 15_000,
    });
  } catch {
    return;
  }
  await testInfo.attach(name, { contentType: "image/png", path: screenshotPath });
}

/**
 * Open the Get started dialog, asking again if the first press does not land.
 *
 * The suite runs against `astro dev`, which reloads the page by itself once it has
 * finished building. A reload between the readiness check and the press leaves the press
 * hitting a page whose script has not run again yet, and the dialog stays shut — the
 * homepage is fine, the dev server simply moved underneath the test. Opening is
 * idempotent: the handler returns early when the dialog is already open.
 */
async function openGetStartedDialog(page: Page, trigger: Locator): Promise<Locator> {
  const dialog = page.locator("[data-get-started-dialog]");
  await expect(async () => {
    if (await dialog.isVisible()) return;
    await expect(page.locator("html")).toHaveAttribute("data-get-started-ready", "", {
      timeout: 5_000,
    });
    await trigger.click();
    await expect(dialog).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  return dialog;
}

test.describe("marketing homepage", () => {
  test.beforeEach(async ({ page }) => {
    // CI runners intermittently stall on Google Fonts, and page.screenshot
    // waits for document.fonts — abort font requests so fallbacks render.
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  });

  test("self-host is short CTAs, not an install script", async ({ page }, testInfo) => {
    await page.goto("/");
    await page.waitForLoadState("load");

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const selfHost = page.locator("#selfhost");
    await expect(selfHost).toBeVisible();
    await expect(selfHost.getByRole("heading", { level: 2 })).toBeVisible();
    await expect(selfHost.getByRole("button", { name: /Get started/i })).toBeVisible();
    await expect(selfHost.getByRole("link", { name: /View on GitHub/i })).toBeVisible();
    await expect(selfHost.getByRole("link", { name: /Read the docs/i })).toBeVisible();

    await expect(selfHost.locator("pre")).toHaveCount(0);
    await expect(selfHost).not.toContainText(
      /openssl|docker-compose\.images|POSTGRES_PASSWORD|BETTER_AUTH_SECRET|mkdir rakazo/i,
    );

    await expect(async () => {
      await selfHost.scrollIntoViewIfNeeded();
    }).toPass({ timeout: 15_000 });
    await captureScreenshot(page, testInfo, "01-marketing-homepage-selfhost");

    const dialog = await openGetStartedDialog(
      page,
      selfHost.getByRole("button", { name: /Get started/i }),
    );
    await expect(dialog.getByRole("heading")).toBeVisible();
    await expect(dialog).not.toContainText(
      /openssl|docker-compose\.images|POSTGRES_PASSWORD|BETTER_AUTH_SECRET|mkdir rakazo/i,
    );
    await captureScreenshot(page, testInfo, "02-marketing-get-started");
  });

  test("zh homepage matches the simplified self-host CTAs", async ({ page }, testInfo) => {
    await page.goto("/zh/");
    await page.waitForLoadState("load");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("真正属于你的 AI 队友");
    const selfHost = page.locator("#selfhost");
    await expect(selfHost).toBeVisible();
    await expect(selfHost.getByRole("heading", { level: 2 })).toHaveText("电脑归你所有");
    await expect(selfHost.getByRole("button", { name: "开始使用" })).toBeVisible();
    await expect(selfHost.getByRole("link", { name: "在 GitHub 上查看" })).toBeVisible();
    await expect(selfHost.getByRole("link", { name: "阅读文档" })).toBeVisible();

    await expect(selfHost.locator("pre")).toHaveCount(0);
    await expect(selfHost).not.toContainText(
      /openssl|docker-compose\.images|POSTGRES_PASSWORD|BETTER_AUTH_SECRET|mkdir rakazo/i,
    );

    await expect(async () => {
      await selfHost.scrollIntoViewIfNeeded();
    }).toPass({ timeout: 15_000 });
    await captureScreenshot(page, testInfo, "03-marketing-homepage-zh-selfhost");

    const dialog = await openGetStartedDialog(
      page,
      selfHost.getByRole("button", { name: "开始使用" }),
    );
    await expect(dialog.getByRole("heading")).toHaveText("你想如何开始？");
    await expect(dialog).not.toContainText(
      /openssl|docker-compose\.images|POSTGRES_PASSWORD|BETTER_AUTH_SECRET|mkdir rakazo/i,
    );
    await captureScreenshot(page, testInfo, "04-marketing-zh-get-started");
  });
});
