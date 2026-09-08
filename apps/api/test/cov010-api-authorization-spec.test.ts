import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { PlatformCovenant } from "@covenant/core";
import { createAuthorizationContextResolver } from "../src/deployment/authorization-resolver.js";

const ROOT = resolve(import.meta.dirname, "../../..");
const AUTHORIZATION_SPEC_FILE = resolve(
  ROOT,
  "deployment/arc-testnet/cov010-api-authorization-spec.json",
);
const PROJECT_ID =
  "0x7bf8f28b510a05cf48b7a239b35e6e8e0cde9db7371fa33f8e9e1c06c84177ee";
const COVENANT_ID =
  "0x0982b0ffb2c5585995515dcd93162f77beb6075d450c33bc19a881b745d7f2d7";

function covenant(id: string): PlatformCovenant {
  return { id } as PlatformCovenant;
}

describe("COV-010 API authorization trust anchor", () => {
  it("loads the reviewed project and Covenant identity", () => {
    const resolver = createAuthorizationContextResolver(
      AUTHORIZATION_SPEC_FILE,
    );

    const context = resolver(PROJECT_ID, covenant(COVENANT_ID));
    if (
      context === undefined ||
      typeof context.covenantSpec !== "object" ||
      context.covenantSpec === null
    )
      throw new Error("reviewed authorization context was not loaded");
    expect((context.covenantSpec as Record<string, unknown>).covenantId).toBe(
      COVENANT_ID,
    );
  });

  it("fails closed for a different project or Covenant identity", () => {
    const resolver = createAuthorizationContextResolver(
      AUTHORIZATION_SPEC_FILE,
    );

    expect(
      resolver(`0x${"90".repeat(32)}`, covenant(COVENANT_ID)),
    ).toBeUndefined();
    expect(
      resolver(PROJECT_ID, covenant(`0x${"91".repeat(32)}`)),
    ).toBeUndefined();
  });
});
