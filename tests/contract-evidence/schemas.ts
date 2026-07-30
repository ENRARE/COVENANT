import { z } from "zod";

export const LOCAL_CHAIN_ID = 5_042_002;
export const LOCAL_CHAIN_ID_BIGINT = 5_042_002n;
export const LOCAL_CHAIN_ID_STRING = "5042002";

export const LOCAL_EVIDENCE_TYPES = [
  "LOCAL_EVM_DEPLOYMENT_VERIFIED",
  "LOCAL_VAULT_FUNDED_VERIFIED",
  "LOCAL_VAULT_EXECUTION_SUBMITTED",
  "LOCAL_VAULT_EXECUTION_VERIFIED",
  "LOCAL_REPLAY_REJECTED",
  "LOCAL_BYPASS_REJECTED",
  "LOCAL_NON_ISSUER_REVOCATION_REJECTED",
  "LOCAL_COVENANT_REVOCATION_VERIFIED",
  "LOCAL_POST_REVOCATION_EXECUTION_REJECTED",
] as const;

export const localEvidenceTypeSchema = z.enum(LOCAL_EVIDENCE_TYPES);

const evidenceRecordSchema = z
  .object({
    type: localEvidenceTypeSchema,
    status: z.literal("PASS"),
  })
  .strict();

const unsignedCountSchema = z.string().regex(/^(0|[1-9][0-9]*)$/u);

export const localEvidenceResultSchema = z
  .object({
    schemaVersion: z.literal("1"),
    mode: z.literal("LOCAL_ANVIL"),
    chainId: z.literal(LOCAL_CHAIN_ID_STRING),
    status: z.literal("VERIFIED"),
    evidence: z
      .array(evidenceRecordSchema)
      .length(LOCAL_EVIDENCE_TYPES.length)
      .superRefine((records, context) => {
        LOCAL_EVIDENCE_TYPES.forEach((type, index) => {
          if (records[index]?.type !== type) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: [index, "type"],
              message: `Expected ${type}`,
            });
          }
        });
      }),
    counts: z
      .object({
        submittedTransactions: unsignedCountSchema,
        successfulReceipts: unsignedCountSchema,
        revertedReceipts: unsignedCountSchema,
      })
      .strict(),
  })
  .strict();

export type LocalEvidenceResult = z.infer<typeof localEvidenceResultSchema>;
