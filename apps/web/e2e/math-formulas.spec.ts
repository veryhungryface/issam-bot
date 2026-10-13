import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

/**
 * Formulas, typeset.
 *
 * This is a teacher's assistant, so a fair share of every answer is maths, and until now a
 * reply came back as the raw TeX the model wrote: `$x^2$` sitting in the bubble as text.
 * KaTeX now renders it. The parsing is unit-tested in `@rakazo/chat-ui`; what needs a real
 * browser is the rest of the promise — that the typesetter is fetched on demand and
 * actually arrives, that both notations the models use end up rendered, that a fenced block
 * of LaTeX stays text, and that a wide equation does not push the page sideways on a phone.
 */

const ASK = "write a formula for me";

test("a reply's maths is typeset, and the LaTeX being taught stays text", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `math-${stamp}@rakazo.test`, "password12", "Math QA");
  await completeOnboarding(page, testInfo);

  const transcript = page.getByTestId("transcript");
  const composer = page.getByRole("combobox", { name: /^Message/ });
  await expect(composer).toBeVisible();
  await composer.fill(ASK);
  await composer.press("Enter");

  const reply = transcript.locator("[data-message-id]").filter({ hasText: "이차방정식" }).first();
  await expect(reply).toBeVisible({ timeout: 20_000 });

  // KaTeX arrives on its own schedule — it is fetched only because this message needed it.
  const inline = reply.locator(".katex").first();
  await expect(inline).toBeVisible({ timeout: 20_000 });

  // Three formulas, three ways of writing one: `\(…\)` inline, a lone `$$…$$` line, and
  // `\[…\]`. The last two mean a displayed equation and have to come out as one — written
  // on a single line they would otherwise parse as inline maths and be set small.
  await expect(reply.locator(".katex")).toHaveCount(3);
  await expect(reply.locator(".katex-display")).toHaveCount(2);
  await expect(reply.locator(".katex-display").first()).toBeVisible();

  // Typeset, not merely present: KaTeX builds the fraction bar as its own element, so this
  // fails if the TeX was dropped into the page as plain characters.
  await expect(reply.locator(".katex .frac-line").first()).toBeVisible();

  // The source is gone from the prose — no stray delimiters left behind.
  const prose = (await reply.innerText()).replace(/\s+/g, " ");
  expect(prose).toContain("이차방정식");
  expect(prose).not.toContain("\\frac{-b");
  expect(prose).not.toContain("$$");
  expect(prose).not.toContain("\\sum_");

  // The control: inside a fence, LaTeX is the subject matter and has to stay readable.
  const fenced = reply.locator("pre");
  await expect(fenced).toContainText("\\(x^2\\)");
  await expect(fenced.locator(".katex")).toHaveCount(0);

  await captureScreenshot(page, testInfo, "math-formulas-desktop");
});

test("a wide equation scrolls in its own box instead of widening the page", async ({
  browser,
}, testInfo) => {
  // A phone is where these are read, and a displayed integral is easily wider than the
  // bubble holding it. Letting it widen the page would break every other screen too.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const stamp = Date.now();
  await signup(page, `math-phone-${stamp}@rakazo.test`, "password12", "Math Phone");
  await completeOnboarding(page, testInfo);

  const composer = page.getByRole("combobox", { name: /^Message/ });
  await composer.fill(ASK);
  await composer.press("Enter");

  const display = page.getByTestId("transcript").locator(".katex-display").first();
  await expect(display).toBeVisible({ timeout: 20_000 });

  const width = page.viewportSize()?.width ?? 0;
  const box = await display.boundingBox();
  expect(box).toBeTruthy();
  if (box) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  }

  // The document itself must not scroll sideways, whatever the formula does inside its box.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  await captureScreenshot(page, testInfo, "math-formulas-phone");
  await context.close();
});
