import { expect, type Locator, test } from "@playwright/test";
import { completeOnboarding, signup } from "./helpers";

/**
 * The panel slides in, so the first box it reports is a frame of that slide, not the panel.
 * Measuring then compares a mid-animation width against a settled one, and worse, aims the
 * drag at where the handle used to be — the press lands on nothing and the panel never
 * moves. Waiting for two equal readings costs a few frames and removes both.
 */
async function settledBox(locator: Locator) {
  let previous = -1;
  await expect
    .poll(async () => {
      const width = (await locator.boundingBox())?.width ?? 0;
      const settled = width > 0 && width === previous;
      previous = width;
      return settled;
    })
    .toBe(true);
  return locator.boundingBox();
}

test("dragging the panel edge widens the panel and the computer preview with it", async ({
  page,
}) => {
  const stamp = Date.now();
  await signup(page, `panel-resize-${stamp}@rakazo.test`, "password12", "Panel Resize");
  await completeOnboarding(page);

  await page.getByTitle("Agent computer").click();
  const sidePanel = page.getByTestId("side-panel");
  await expect(sidePanel).toHaveAttribute("data-panel", "computer");
  const preview = sidePanel.getByTestId("computer-preview");
  await expect(preview).toBeVisible();

  const panelBefore = await settledBox(sidePanel);
  const previewBefore = await settledBox(preview);
  expect(panelBefore).not.toBeNull();
  expect(previewBefore).not.toBeNull();

  const handle = sidePanel.getByRole("separator", { name: "Resize panel" });
  const handleBox = await settledBox(handle);
  expect(handleBox).not.toBeNull();
  await page.mouse.move(
    (handleBox?.x ?? 0) + (handleBox?.width ?? 0) / 2,
    (handleBox?.y ?? 0) + (handleBox?.height ?? 0) / 2,
  );
  await page.mouse.down();
  await page.mouse.move((handleBox?.x ?? 0) - 200, (handleBox?.y ?? 0) + 40, { steps: 8 });
  await page.mouse.up();

  const panelAfter = await settledBox(sidePanel);
  const previewAfter = await settledBox(preview);
  expect(panelAfter?.width ?? 0).toBeGreaterThan((panelBefore?.width ?? 0) + 100);
  // The preview must track the panel, not stay pinned to the old fixed body width.
  expect(previewAfter?.width ?? 0).toBeGreaterThan((previewBefore?.width ?? 0) + 100);
  // A 16/10 preview grows in both axes, so the live screen actually gets bigger.
  expect(previewAfter?.height ?? 0).toBeGreaterThan(previewBefore?.height ?? 0);

  // The width survives a reload, and the preview comes back at the stored size.
  await page.reload();
  await page.getByTitle("Agent computer").click();
  await expect(sidePanel).toHaveAttribute("data-panel", "computer");
  const panelReloaded = await settledBox(sidePanel);
  expect(panelReloaded?.width ?? 0).toBeGreaterThan((panelBefore?.width ?? 0) + 100);
});
