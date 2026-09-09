import { createAuthorizationContextResolver } from "./authorization-resolver.js";
import { createArcTestnetSignatureVerifierFromRpcUrl } from "./arc-signature-verifier.js";

const filename = process.env.COVENANT_AUTHORIZATION_SPEC_FILE?.trim();
if (filename === undefined || filename.length === 0)
  throw new Error("COVENANT_AUTHORIZATION_SPEC_FILE is required");
const rpcUrl = process.env.COVENANT_ARC_RPC_URL?.trim();
if (rpcUrl === undefined || rpcUrl.length === 0)
  throw new Error("COVENANT_ARC_RPC_URL is required");

export default createAuthorizationContextResolver(
  filename,
  createArcTestnetSignatureVerifierFromRpcUrl(rpcUrl),
);
