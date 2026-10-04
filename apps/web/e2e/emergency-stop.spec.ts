import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

/**
 * The real stop is global: pressing it here would cancel every other spec running against the
 * same stack. So the owner flag and both deployment RPCs are fulfilled with fixture data, and the
 * screen - the deliberate second press, the stopped state, the counts, resuming - renders exactly
 * as it would for a deployment owner. The server side is covered by the agents-pause
 * integration test.
 */
test("the owner stops every bot with a deliberate second press, then resumes", async ({
  page,
}, testInfo) => {
  let pausedAt: string | null = null;
  const deployment = () => ({
    ownerUserId: "owner",
    signupsEnabled: true,
    signupAllowlist: [],
    hasDeploymentModelCredential: false,
    defaultProvider: null,
    defaultModel: null,
    computerHost: null,
    canChooseHostComputer: false,
    sandboxProvider: "fake",
    agentsPausedAt: pausedAt,
  });
  const requests: boolean[] = [];
  await page.route("**/rpc/bootstrap", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { json?: { me?: { isDeploymentOwner?: boolean } } };
    if (body.json?.me) body.json.me.isDeploymentOwner = true;
    await route.fulfill({ response, json: body });
  });
  await page.route("**/rpc/deployment/get", (route) =>
    route.fulfill({ contentType: "application/json", json: { json: deployment() } }),
  );
  await page.route("**/rpc/deployment/setAgentsPaused", async (route) => {
    const paused = (route.request().postDataJSON() as { json: { paused: boolean } }).json.paused;
    requests.push(paused);
    pausedAt = paused ? new Date().toISOString() : null;
    await route.fulfill({
      contentType: "application/json",
      json: {
        json: {
          deployment: deployment(),
          cancelledRuns: paused ? 3 : 0,
          sleepingComputers: paused ? 2 : 0,
        },
      },
    });
  });

  const stamp = Date.now();
  const userName = `Owner ${stamp}`;
  await signup(page, `emergency-stop-${stamp}@rakazo.test`, "password12", userName);
  await completeOnboarding(page);

  await page.getByRole("button", { name: new RegExp(userName) }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByTestId("user-settings");
  await settings.getByTestId("ui-locale-select").click();
  await settings.getByRole("option", { name: "한국어", exact: true }).click();

  const section = page.getByTestId("emergency-stop-settings");
  await expect(section.getByRole("heading", { name: "긴급 정지" })).toBeVisible();

  // The first press only asks; nothing has been sent yet.
  await section.getByRole("button", { name: "모든 봇 멈추기…" }).click();
  await expect(section.getByText("모든 사용자의 봇이 지금 하는 일을 전부 취소하고")).toBeVisible();
  expect(requests).toEqual([]);
  await section.getByRole("button", { name: "취소" }).click();
  await expect(section.getByRole("button", { name: "모든 봇 멈추기…" })).toBeVisible();
  expect(requests).toEqual([]);

  await section.getByRole("button", { name: "모든 봇 멈추기…" }).click();
  await section.getByRole("button", { name: "지금 모든 봇 멈추기" }).click();
  await expect(section.getByRole("status")).toContainText("모든 봇이 멈춰 있어요");
  await expect(
    section.getByText("실행 중이던 작업 3개를 멈추고 브라우저 2개를 껐어요."),
  ).toBeVisible();
  expect(requests).toEqual([true]);
  await captureScreenshot(page, testInfo, "emergency-stop-ko");

  await section.getByRole("button", { name: "모든 봇 다시 시작" }).click();
  await expect(section.getByRole("button", { name: "모든 봇 멈추기…" })).toBeVisible();
  await expect(section.getByRole("status")).toHaveCount(0);
  expect(requests).toEqual([true, false]);
});
