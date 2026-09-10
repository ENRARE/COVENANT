import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";
import { ARC_TESTNET_PROFILE } from "../packages/config/src/arc-testnet.ts";
import { parseArcDeploymentPlanInput } from "../packages/spec/src/deployment-plan.ts";

const input = JSON.parse(
  readFileSync(
    resolve("deployment/arc-testnet/fresh-demo-deployment-plan-input.json"),
    "utf8",
  ),
);

test("fresh demo deployment input preserves the reviewed Arc terms", () => {
  const parsed = parseArcDeploymentPlanInput(input, {
    chainId: ARC_TESTNET_PROFILE.chainId,
    usdcInterfaceAddress: ARC_TESTNET_PROFILE.usdcInterfaceAddress,
    profileDigest: `0x${"11".repeat(32)}`,
    nowSeconds: 1_789_000_000n,
  });
  assert.equal(
    parsed.constructor.covenantId,
    "0x9efcc49d65443927f3c4c1bdea6e88b5d72122f8938518fb75c8cafeb955c859",
  );
  assert.equal(
    parsed.constructor.agentSigner,
    "0xa5a0c0B3279085E47E18a3e65583732E5e4000ae",
  );
  assert.equal(
    parsed.constructor.authorizationSigner,
    "0x803fA7BDb80C6AF83e40B8Aa530A3cB867E6C967",
  );
  assert.equal(
    parsed.constructor.token,
    ARC_TESTNET_PROFILE.usdcInterfaceAddress,
  );
  assert.equal(
    parsed.constructor.recipient,
    "0xDbf314C646792dbbD48070e799E7B1EE5d913aB1",
  );
  assert.equal(parsed.constructor.maxAmountPerPayment, "1000000");
  assert.equal(parsed.constructor.totalBudget, "3000000");
  assert.equal(BigInt(parsed.constructor.maxAmountPerPayment) / 1_000_000n, 1n);
  assert.equal(BigInt(parsed.constructor.totalBudget) / 1_000_000n, 3n);
  assert.equal(parsed.constructor.maxPaymentCount, "3");
  assert.equal(parsed.constructor.validAfter, "1788998400");
  assert.equal(parsed.constructor.validUntil, "1820534400");
  assert.equal(
    parsed.constructor.policyHash,
    "0x426bae23597d4adadceacd3dbef1dc20b3cdfc041693885576f632df9b70915f",
  );
  assert.equal(parsed.constructor.policyVersion, "cov-018-testnet-1");
  assert.equal("vaultAddress" in parsed.constructor, false);
});
