export const DEMO_MODE = "LOCAL_SIMULATED" as const;
export const HAPPY_SCENARIO_ID = "happy-path-v1" as const;
export const COMPROMISED_SCENARIO_ID = "compromised-proposer-v1" as const;

export const FROZEN_DEMO = Object.freeze({
  covenantId:
    "0x0101010101010101010101010101010101010101010101010101010101010101",
  policyHash:
    "0x0202020202020202020202020202020202020202020202020202020202020202",
  recipient: "0x6000000000000000000000000000000000000006",
  attackerRecipient: "0x7000000000000000000000000000000000000007",
  token: "0x5000000000000000000000000000000000000005",
  vault: "0x4000000000000000000000000000000000000004",
  productId: "gpu-h100-hour",
  purpose: "Purchase approved GPU compute",
  policyVersion: "gpu-policy-1",
  chainId: 5_042_002n,
  happyAmount: "1.25",
  excessiveAmount: "5000.000001",
  maxAmountPerPayment: "5000",
  totalBudget: "10000",
  simulatedSubmissionReference: "simulated-submission-0001",
  compromisedWording:
    "Compromised proposer simulation: a malicious structured payment proposal attempts to redirect payment to an unauthorized recipient. Covenant rejects it before authorization, simulation, or submission.",
});

export type ScenarioId =
  typeof HAPPY_SCENARIO_ID | typeof COMPROMISED_SCENARIO_ID;
