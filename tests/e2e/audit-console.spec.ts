import { expect, test as base } from "@playwright/test";

const testOrigin = "http://127.0.0.1:3100";
const projectionId =
  "0xedf05d3ce6263095b0cd323396e558409eae16090d6b00b599454a22de8f2a05";
const transactionHash =
  "0x1429af87afb5865933cb4bc3870100c8c4d0cde8795efc54e07a9460f8acea55";

type NetworkGuardFixtures = { offlineNetworkGuard: undefined };

const test = base.extend<NetworkGuardFixtures>({
  offlineNetworkGuard: [
    async ({ page }, use) => {
      const prohibitedAttempts: string[] = [];
      await page.route("**/*", async (route) => {
        const requestUrl = new URL(route.request().url());
        if (
          requestUrl.protocol === "http:" &&
          requestUrl.origin === testOrigin
        ) {
          await route.continue();
          return;
        }
        prohibitedAttempts.push("non-loopback HTTP request");
        await route.abort("blockedbyclient");
      });
      await page.routeWebSocket("**/*", async (webSocket) => {
        prohibitedAttempts.push("WebSocket connection");
        await webSocket.close({
          code: 1008,
          reason: "WebSocket connections are prohibited in offline E2E tests",
        });
      });
      await use(undefined);
      expect(prohibitedAttempts).toEqual([]);
    },
    { auto: true },
  ],
});

test("first screen communicates the bounded product", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      name: "Bounded financial authority for autonomous software",
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "AI proposes. Covenant authorizes. Circle submits. Arc execution is independently verified.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      "No component capable of generating payment requests shall possess authority to execute payments.",
    ),
  ).toBeVisible();
  await expect(page.getByText("Read-only / Schema v2")).toBeVisible();
  await expect(
    page.locator("form, input, textarea, select, button"),
  ).toHaveCount(0);
});

test("supports the complete judge walkthrough", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "0.01 USDC" })).toBeVisible();
  await expect(
    page.getByText("Arc Testnet", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("UNKNOWN", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("ARC_EXECUTION_SUCCEEDED", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.locator(".role-card")).toHaveCount(6);
  await expect(
    page.getByText("SUBMISSION_ATTEMPT_STARTED", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No automatic retry", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("RECEIPT SUCCESS", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Transaction observed", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTitle(transactionHash).first()).toBeVisible();
  await expect(page.locator(".control-card")).toHaveCount(5);
  await expect(
    page.getByText("Fixed compromised proposer", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Valid revocation", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".timeline-event")).toHaveCount(21);
  await expect(page.getByTitle(projectionId)).toBeVisible();
  await expect(page.locator(".claim-row strong")).toHaveText([
    "Yes",
    "No",
    "Yes",
    "No",
    "No",
    "No",
    "No",
  ]);
});

test("timeline inspector is keyboard accessible and causally linked", async ({
  page,
}) => {
  await page.goto("/");
  const arcEvent = page.locator(
    '[data-event-type="ARC_EXECUTION_OBSERVATION_RECORDED"]',
  );
  const summary = arcEvent.locator("summary");

  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(arcEvent).toHaveAttribute("open", "");
  await expect(arcEvent.getByTitle(transactionHash)).toBeVisible();
  await expect(
    arcEvent.getByText("source identity", { exact: true }),
  ).toBeVisible();

  const reconciliation = page.locator(
    '[data-event-type="EXECUTION_RECONCILIATION_RECORDED"]',
  );
  await reconciliation.locator("summary").click();
  await expect(
    reconciliation.getByText("causal parent 1", { exact: true }),
  ).toBeVisible();
  await expect(
    reconciliation.getByText("causal parent 2", { exact: true }),
  ).toBeVisible();
});

test("keeps presentation ephemeral and responsive", async ({ page }) => {
  await page.goto("/");
  const firstEvent = page.locator(".timeline-event").first();
  await firstEvent.locator("summary").click();
  await expect(firstEvent).toHaveAttribute("open", "");
  await page.reload();

  await expect(page.locator(".timeline-event").first()).not.toHaveAttribute(
    "open",
    "",
  );
  await expect(page).toHaveURL(`${testOrigin}/`);
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
      fitsViewport: document.documentElement.scrollWidth <= window.innerWidth,
    })),
  ).toEqual({ local: 0, session: 0, fitsViewport: true });
});
