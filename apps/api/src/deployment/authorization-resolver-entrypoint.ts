import { createAuthorizationContextResolver } from "./authorization-resolver.js";

const filename = process.env.COVENANT_AUTHORIZATION_SPEC_FILE?.trim();
if (filename === undefined || filename.length === 0)
  throw new Error("COVENANT_AUTHORIZATION_SPEC_FILE is required");

export default createAuthorizationContextResolver(filename);
