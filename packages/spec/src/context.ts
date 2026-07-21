import {
  authorizationReceiptSchema,
  covenantSpecSchema,
  decisionReceiptSchema,
  paymentIntentSchema,
} from "./schemas.js";

export function validatePaymentIntentContext(
  covenant: unknown,
  intent: unknown,
) {
  const covenantSpec = covenantSpecSchema.parse(covenant);
  const paymentIntent = paymentIntentSchema.parse(intent);

  if (paymentIntent.createdAt < covenantSpec.validAfter) {
    throw new Error("PaymentIntent.createdAt precedes CovenantSpec.validAfter");
  }
  if (paymentIntent.createdAt > covenantSpec.validUntil) {
    throw new Error("PaymentIntent.createdAt exceeds CovenantSpec.validUntil");
  }
  if (paymentIntent.expiresAt > covenantSpec.validUntil) {
    throw new Error("PaymentIntent.expiresAt exceeds CovenantSpec.validUntil");
  }
  return { covenantSpec, paymentIntent } as const;
}

export function validateAuthorizationContext(
  covenant: unknown,
  intent: unknown,
  decision: unknown,
  authorization: unknown,
) {
  const { covenantSpec, paymentIntent } = validatePaymentIntentContext(
    covenant,
    intent,
  );
  const decisionReceipt = decisionReceiptSchema.parse(decision);
  const authorizationReceipt = authorizationReceiptSchema.parse(authorization);

  if (decisionReceipt.createdAt < paymentIntent.createdAt) {
    throw new Error(
      "DecisionReceipt.createdAt precedes PaymentIntent.createdAt",
    );
  }
  if (authorizationReceipt.validUntil <= decisionReceipt.createdAt) {
    throw new Error(
      "AuthorizationReceipt.validUntil must follow DecisionReceipt.createdAt",
    );
  }
  if (authorizationReceipt.validUntil > paymentIntent.expiresAt) {
    throw new Error(
      "AuthorizationReceipt.validUntil exceeds PaymentIntent.expiresAt",
    );
  }
  if (authorizationReceipt.validUntil > covenantSpec.validUntil) {
    throw new Error(
      "AuthorizationReceipt.validUntil exceeds CovenantSpec.validUntil",
    );
  }
  return {
    covenantSpec,
    paymentIntent,
    decisionReceipt,
    authorizationReceipt,
  } as const;
}
