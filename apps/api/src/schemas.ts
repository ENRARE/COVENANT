import { z } from "zod";
import {
  authorizationEvidenceSubmissionSchema,
  PLATFORM_V1_ASSET,
  PLATFORM_V1_NETWORK,
} from "@covenant/core";

const bytes32 = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/u)
  .transform((value) => value.toLowerCase());
const timestamp = z
  .string()
  .regex(/^(0|[1-9]\d*)$/u)
  .max(78);

export const createCovenantRequestSchema = z
  .object({
    id: bytes32.optional(),
    payer: z.string().min(1),
    beneficiary: z.string().min(1),
    amount: z.string().min(1),
    conditions: z
      .object({ policyHash: bytes32, policyVersion: z.string().min(1) })
      .strict()
      .optional(),
    policy: z
      .object({ policyHash: bytes32, policyVersion: z.string().min(1) })
      .strict()
      .optional(),
    createdAt: timestamp.optional(),
    expiresAt: timestamp,
    auditReference: z.string().trim().min(1).max(256).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.conditions === undefined && value.policy === undefined)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["conditions"],
        message: "A conditions or policy reference is required",
      });
    if (
      value.conditions !== undefined &&
      value.policy !== undefined &&
      JSON.stringify(value.conditions) !== JSON.stringify(value.policy)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["policy"],
        message: "conditions and policy references must agree",
      });
  });

export const emptyMutationSchema = z.object({}).strict();
export { authorizationEvidenceSubmissionSchema };
export const webhookEndpointRequestSchema = z
  .object({ url: z.string().url() })
  .strict();
export const paginationSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    after: bytes32.optional(),
  })
  .strict();

export { PLATFORM_V1_ASSET, PLATFORM_V1_NETWORK };
