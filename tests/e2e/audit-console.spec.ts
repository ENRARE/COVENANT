import { expect, test as base } from "@playwright/test";

const testOrigin = "http://127.0.0.1:3100";

type NetworkGuardFixtures = {
  offlineNetworkGuard: undefined;
};

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

      expect(
        prohibitedAttempts,
        `The E2E browser attempted traffic outside ${testOrigin}.`,
      ).toEqual([]);
    },
    { auto: true },
  ],
});

const projectionId =
  "0x2d746e4eac75eab7cb35182a25afd8b669335d8bbdf175fd72fa1598ba8d0bc3";

test("renders the frozen audit projection", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      name: "Authorization evidence, not payment authority.",
    }),
  ).toBeVisible();
  await expect(page.getByText(projectionId)).toBeVisible();
  await expect(page.locator(".event-card")).toHaveCount(19);
  await expect(page.locator(".event-card").first()).toHaveAttribute(
    "data-event-type",
    "ARC_DEPLOYMENT_EVIDENCE_VERIFIED",
  );
  await expect(page.locator(".event-card").last()).toHaveAttribute(
    "data-event-type",
    "POST_REVOCATION_EXECUTION_REJECTED",
  );
  await expect(
    page.getByText("LOCAL_ANVIL_SETTLEMENT_OBSERVATION", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("ARC_DEPLOYMENT_TRANSACTION_ONLY", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("FIXED_COMPROMISED_PROPOSER_REJECTION", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".boundary-item strong")).toHaveText([
    "FALSE",
    "FALSE",
    "FALSE",
    "FALSE",
  ]);
  await expect(page.getByRole("button")).toHaveCount(0);
});

test("filters only the in-memory view and resets on reload", async ({
  page,
}) => {
  await test.step("navigate to the console", async () => {
    await page.goto("/");
  });
  await test.step("confirm initial timeline", async () => {
    await expect(page.locator(".event-card")).toHaveCount(19);
  });
  await test.step("enter the filter", async () => {
    await page.getByLabel("FILTER EVENTS").fill("rejected");
  });
  await test.step("confirm filtered events", async () => {
    await expect(page.locator(".event-card")).toHaveCount(6);
    await expect(page.getByText("6 of 19 events")).toBeVisible();
  });
  await test.step("reload the page", async () => {
    await page.reload();
  });
  await test.step("confirm fixed initial state restored", async () => {
    await expect(page.getByLabel("FILTER EVENTS")).toHaveValue("");
    await expect(page.locator(".event-card")).toHaveCount(19);
  });
});
