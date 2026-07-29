import { describe, expect, it } from "vitest";
import { sanitizedEvidenceError } from "./errors.js";
import { LOCAL_EVIDENCE_TYPES, localEvidenceResultSchema } from "./schemas.js";
import {
  runInvalidIntentClassification,
  runLocalVaultScenario,
} from "./local-vault-scenario.js";

describe("COV-008 deterministic local CovenantVault evidence", () => {
  it("proves the fixed local execution, rejection, and revocation lifecycle", async () => {
    let result;
    try {
      result = localEvidenceResultSchema.parse(await runLocalVaultScenario());
    } catch (error) {
      if (process.env.COVENANT_EVIDENCE_COMMAND === "1") {
        process.stdout.write(
          `COVENANT_LOCAL_EVIDENCE_ERROR=${JSON.stringify(sanitizedEvidenceError(error))}\n`,
        );
      }
      throw error;
    }
    expect(result).toEqual({
      schemaVersion: "1",
      mode: "LOCAL_ANVIL",
      chainId: "5042002",
      status: "VERIFIED",
      evidence: LOCAL_EVIDENCE_TYPES.map((type) => ({
        type,
        status: "PASS",
      })),
      counts: {
        submittedTransactions: "11",
        successfulReceipts: "7",
        revertedReceipts: "4",
      },
    });
    if (process.env.COVENANT_EVIDENCE_COMMAND === "1") {
      process.stdout.write(
        `COVENANT_LOCAL_EVIDENCE_RESULT=${JSON.stringify(result)}\n`,
      );
    }
  });

  it.each(["WRONG_RECIPIENT", "EXCESSIVE_AMOUNT"] as const)(
    "classifies %s through actual local EVM evidence",
    async (kind) => {
      await expect(
        runInvalidIntentClassification(kind),
      ).resolves.toBeUndefined();
    },
  );
});
