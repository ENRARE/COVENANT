import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TimelineUnavailable } from "./timeline-unavailable";

describe("COV-016 unavailable page", () => {
  it("renders only fixed sanitized content", () => {
    const markup = renderToStaticMarkup(<TimelineUnavailable />);
    expect(markup).toContain("Audit timeline unavailable");
    expect(markup).toContain(
      "The validated audit timeline cannot be displayed.",
    );
    for (const forbidden of [
      "projectionId",
      "eventId",
      "Error:",
      "stack",
      "path",
      "digest",
      "Zod",
    ]) {
      expect(markup).not.toContain(forbidden);
    }
  });
});
