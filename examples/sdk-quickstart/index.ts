import { Covenant } from "@covenant/sdk";

const projectKey = process.env.COVENANT_API_KEY;
const baseUrl = process.env.COVENANT_API_URL;
if (projectKey === undefined || baseUrl === undefined)
  throw new Error("COVENANT_API_KEY and COVENANT_API_URL are required");

const covenant = new Covenant({ ["apiKey"]: projectKey, baseUrl });
const agreement = await covenant.covenants.create({
  payer: "0x1111111111111111111111111111111111111111",
  beneficiary: "0x2222222222222222222222222222222222222222",
  amount: "500",
  conditions: {
    policyHash:
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    policyVersion: "1",
  },
  expiresAt: "1900000000",
});

console.log("created", agreement.id);
const retrieved = await covenant.covenants.retrieve(agreement.id);
console.log("retrieved", retrieved.status);
const authorizationRequest = await covenant.covenants.authorize(agreement.id, {
  idempotencyKey: `authorize-${agreement.id}`,
});
console.log(
  "authorization requested",
  authorizationRequest.authorizationStatus,
);
const operation = await covenant.covenants.execute(agreement.id, {
  idempotencyKey: `execute-${agreement.id}`,
});
const execution = await covenant.executions.retrieve(operation.execution.id);
console.log("execution state", execution.status);
