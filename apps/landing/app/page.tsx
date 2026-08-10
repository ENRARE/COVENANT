import { LandingPage } from "../components/marketing/landing-page";

const evidence = {
  amount: "0.01 USDC",
  network: "Arc Testnet",
  providerOutcome: "UNKNOWN",
  automaticRetry: false,
  arcObserved: true,
  reconciliation: "ARC_EXECUTION_SUCCEEDED",
} as const;

const securityControls = [
  {
    label: "Fixed compromised proposer",
    status: "REJECTED",
    eventId: "fixed-compromised-proposer",
  },
  {
    label: "Direct vault bypass",
    status: "REJECTED",
    eventId: "direct-vault-bypass",
  },
  {
    label: "Unauthorized revocation",
    status: "REJECTED",
    eventId: "unauthorized-revocation",
  },
  {
    label: "Valid revocation",
    status: "VERIFIED",
    eventId: "valid-revocation",
  },
  {
    label: "Post-revocation execution",
    status: "REJECTED",
    eventId: "post-revocation-execution",
  },
] as const;

export default function HomePage() {
  return (
    <LandingPage evidence={evidence} securityControls={securityControls} />
  );
}
