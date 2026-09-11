import { expect, test } from "@playwright/test";
import { completeOnboarding, signup } from "./helpers";

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

  const panelBefore = await sidePanel.boundingBox();
  const previewBefore = await preview.boundingBox();
  expect(panelBefore).not.toBeNull();
  expect(previewBefore).not.toBeNull();

  const handle = sidePanel.getByRole("separator", { name: "Resize panel" });
  const handleBox = await handle.boundingBox();
  expect(handleBox).not.toBeNull();
  await page.mouse.move(
    (handleBox?.x ?? 0) + (handleBox?.width ?? 0) / 2,
    (handleBox?.y ?? 0) + (handleBox?.height ?? 0) / 2,
  );
  await page.mouse.down();
  await page.mouse.move((handleBox?.x ?? 0) - 200, (handleBox?.y ?? 0) + 40, { steps: 8 });
  await page.mouse.up();

  const panelAfter = await sidePanel.boundingBox();
  const previewAfter = await preview.boundingBox();
  expect(panelAfter?.width ?? 0).toBeGreaterThan((panelBefore?.width ?? 0) + 100);
  // The preview must track the panel, not stay pinned to the old fixed body width.
  expect(previewAfter?.width ?? 0).toBeGreaterThan((previewBefore?.width ?? 0) + 100);
  // A 16/10 preview grows in both axes, so the live screen actually gets bigger.
  expect(previewAfter?.height ?? 0).toBeGreaterThan(previewBefore?.height ?? 0);

  // The width survives a reload, and the preview comes back at the stored size.
  await page.reload();
  await page.getByTitle("Agent computer").click();
  await expect(sidePanel).toHaveAttribute("data-panel", "computer");
  const panelReloaded = await sidePanel.boundingBox();
  expect(panelReloaded?.width ?? 0).toBeGreaterThan((panelBefore?.width ?? 0) + 100);
});
