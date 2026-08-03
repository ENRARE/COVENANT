import { formatUsdc, positiveMoneySchema } from "@covenant/spec";
import { z } from "zod";
import { AgentError, callDependency } from "./errors.js";
import type {
  ProcurementInvoiceSource,
  ProcurementInvoiceSourceRequest,
} from "./procurement-integration.js";

export type AgenticApiInvoiceClient = Readonly<{
  requestInvoiceCandidate(
    request: ProcurementInvoiceSourceRequest,
  ): Promise<unknown>;
}>;

export type AgenticApiInvoiceSourceDependencies = Readonly<{
  client: AgenticApiInvoiceClient;
}>;

const invoiceSourceRequestSchema = z
  .object({
    productId: z.literal("gpu-h100-hour"),
    maximumAmount: z.string(),
  })
  .strict();

function parseInvoiceSourceRequest(
  value: unknown,
): ProcurementInvoiceSourceRequest {
  try {
    const request = invoiceSourceRequestSchema.parse(value);
    const maximumAmount = positiveMoneySchema.parse(request.maximumAmount);
    const canonicalMaximumAmount = formatUsdc(maximumAmount);

    if (request.maximumAmount !== canonicalMaximumAmount) {
      throw new AgentError("MALFORMED_INPUT");
    }

    return Object.freeze({
      productId: request.productId,
      maximumAmount: canonicalMaximumAmount,
    });
  } catch {
    throw new AgentError("MALFORMED_INPUT");
  }
}

export function createAgenticApiInvoiceSource(
  dependencies: AgenticApiInvoiceSourceDependencies,
): ProcurementInvoiceSource {
  async function requestSignedInvoice(
    request: ProcurementInvoiceSourceRequest,
  ): Promise<unknown> {
    const clientRequest = parseInvoiceSourceRequest(request);

    return callDependency({
      operation: () =>
        dependencies.client.requestInvoiceCandidate(clientRequest),
      code: "PROCUREMENT_SOURCE_FAILURE",
    });
  }

  return Object.freeze({ requestSignedInvoice });
}
