import {
  formatUsdc,
  positiveMoneySchema,
  signedInvoiceSchema,
} from "@covenant/spec";
import { z } from "zod";
import { AgentError, callDependency } from "./errors.js";
import type { AgentService } from "./service.js";
import type { AgentProposalResult } from "./types.js";

export type ProcurementProductId = "gpu-h100-hour";

export type ProcurementInvoiceSourceRequest = Readonly<{
  productId: ProcurementProductId;
  maximumAmount: string;
}>;

export type ProcurementInvoiceSource = Readonly<{
  requestSignedInvoice(
    request: ProcurementInvoiceSourceRequest,
  ): Promise<unknown>;
}>;

export type ProcurementIntegrationDependencies = Readonly<{
  invoiceSource: ProcurementInvoiceSource;
  agent: Pick<AgentService, "proposePayment">;
}>;

export type ProcurementIntegration = Readonly<{
  procurePayment(request: unknown): Promise<AgentProposalResult>;
}>;

const productIdSchema = z.literal("gpu-h100-hour");

const publicProcurementRequestSchema = z
  .object({
    productId: productIdSchema,
    maximumAmount: z.unknown(),
  })
  .strict();

function parsePublicProcurementRequest(value: unknown): Readonly<{
  productId: ProcurementProductId;
  maximumAmount: bigint;
}> {
  try {
    const request = publicProcurementRequestSchema.parse(value);
    return Object.freeze({
      productId: request.productId,
      maximumAmount: positiveMoneySchema.parse(request.maximumAmount),
    });
  } catch {
    throw new AgentError("MALFORMED_INPUT");
  }
}

function parseProcurementInvoice(value: unknown) {
  try {
    return signedInvoiceSchema.parse(value);
  } catch {
    throw new AgentError("PROCUREMENT_INVOICE_INVALID");
  }
}

export function createProcurementIntegration(
  dependencies: ProcurementIntegrationDependencies,
): ProcurementIntegration {
  async function procurePayment(
    publicInput: unknown,
  ): Promise<AgentProposalResult> {
    const request = parsePublicProcurementRequest(publicInput);
    const sourceRequest: ProcurementInvoiceSourceRequest = Object.freeze({
      productId: request.productId,
      maximumAmount: formatUsdc(request.maximumAmount),
    });

    const rawSignedInvoice = await callDependency({
      operation: () =>
        dependencies.invoiceSource.requestSignedInvoice(sourceRequest),
      code: "PROCUREMENT_SOURCE_FAILURE",
    });
    const signedInvoice = parseProcurementInvoice(rawSignedInvoice);

    if (signedInvoice.payload.productId !== request.productId) {
      throw new AgentError("PROCUREMENT_INVOICE_INVALID");
    }
    if (signedInvoice.payload.amount > request.maximumAmount) {
      throw new AgentError("PROCUREMENT_AMOUNT_EXCEEDS_MAXIMUM");
    }

    return dependencies.agent.proposePayment(
      Object.freeze({
        signedInvoice: rawSignedInvoice,
        procurementRequest: Object.freeze({
          productId: request.productId,
          expectedAmount: formatUsdc(signedInvoice.payload.amount),
        }),
      }),
    );
  }

  return Object.freeze({ procurePayment });
}
