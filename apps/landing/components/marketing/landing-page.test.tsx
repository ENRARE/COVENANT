import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import HomePage from "../../app/page";

describe("isolated COVENANT landing deployment", () => {
  it("renders the approved public evidence copy", () => {
    const markup = renderToStaticMarkup(<HomePage />);

    for (const expected of [
      "0.01 USDC",
      "Arc Testnet",
      "UNKNOWN",
      "Execution observed",
      "ARC_EXECUTION_SUCCEEDED",
      "Evidence console available in the local demonstration",
      "Fixed compromised proposer",
      "Direct vault bypass",
      "Unauthorized revocation",
      "Valid revocation",
      "Post-revocation execution",
    ]) {
      expect(markup).toContain(expected);
    }
  });

  it("contains no navigation to application-only routes", () => {
    const markup = renderToStaticMarkup(<HomePage />);

    expect(markup).not.toMatch(/href=["']\/(?:docs|demo|evidence)(?:[/#?"'])/u);
    expect(markup).not.toContain("Open Evidence Console");
    expect(markup).toContain('href="#use-case"');
    expect(markup).toContain("Documentation coming soon");
  });
});
