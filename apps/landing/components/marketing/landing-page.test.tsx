import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import HomePage from "../../app/page";

describe("COVENANT public landing", () => {
  it("renders the concise lifecycle and exactly two hero actions", () => {
    const markup = renderToStaticMarkup(<HomePage />);
    for (const text of [
      "Create",
      "Authorize",
      "Execute",
      "Observe",
      "Audit",
      "EOA + ERC-1271",
    ])
      expect(markup).toContain(text);
    expect(markup).not.toContain("PRODUCT EVIDENCE");
    const hero =
      /<section class="site-hero[\s\S]*?<\/section>/u.exec(markup)?.[0] ?? "";
    expect((hero.match(/<a /gu) ?? []).length).toBe(2);
    expect(hero).toContain(
      'class="site-button site-button-primary" href="/docs#installation"',
    );
    expect(hero).toContain(
      'class="site-button site-button-secondary" href="/docs#quickstart"',
    );
    const lifecycleSection =
      /<section class="site-section lifecycle-section"[\s\S]*?<\/section>/u.exec(
        markup,
      )?.[0] ?? "";
    expect((lifecycleSection.match(/<li>/gu) ?? []).length).toBe(5);
    const securitySection =
      /<section class="site-section trust-section"[\s\S]*?<\/section>/u.exec(
        markup,
      )?.[0] ?? "";
    expect((securitySection.match(/<article>/gu) ?? []).length).toBe(4);
  });

  it("keeps docs first-party and GitHub explicit", () => {
    const markup = renderToStaticMarkup(<HomePage />);
    expect(markup).toContain('href="/docs"');
    expect(markup).toContain('href="https://github.com/ENRARE/COVENANT"');
    expect(markup).not.toContain("COVENANT/tree/main/docs");
    expect(markup).toContain(
      'class="site-nav-cta site-nav-install" href="/docs#installation"',
    );
    expect(markup).toContain(
      'class="site-mobile-cta site-mobile-start" href="/docs#quickstart"',
    );
    expect(markup).toContain(
      'class="text-link" href="/docs#quickstart">Read the quickstart',
    );
    expect(markup).toContain(
      'class="text-link" href="/docs#security">Explore the security model',
    );
  });
});
