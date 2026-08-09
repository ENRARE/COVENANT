import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import canonicalTimeline from "../data/audit-timeline.json";
import { createAuditDisplayModel } from "../lib/audit-display";
import { describe, expect, it } from "vitest";
import { AuditConsole } from "./audit-console";

describe("COV-020 judge-facing console", () => {
  it("renders the complete fixed walkthrough without a mutation control", () => {
    const markup = renderToStaticMarkup(
      <AuditConsole model={createAuditDisplayModel(canonicalTimeline)} />,
    );
    for (const expected of [
      "COVENANT",
      "Bounded financial authority for autonomous software",
      "AI proposes. Covenant authorizes. Circle submits. Arc execution is independently verified.",
      "0.01 USDC",
      "UNKNOWN",
      "ARC_EXECUTION_SUCCEEDED",
      "Fixed compromised proposer",
      "Direct vault bypass",
      "Unauthorized revocation",
      "Valid revocation",
      "Post-revocation execution",
      "Circle submission attempt observed",
      "Payment finality claimed",
    ]) {
      expect(markup).toContain(expected);
    }
    expect(markup).not.toMatch(/<button|<form|<input|<textarea/iu);
  });
});
