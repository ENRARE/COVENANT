import Link from "next/link";
import Image from "next/image";
import React from "react";
import { BrandLogo } from "./brand-logo";
import { EvidencePreview, type EvidencePreviewProps } from "./evidence-preview";
import { ProcurementScenario } from "./procurement-scenario";
import { Reveal } from "./reveal";
import { SiteNavigation } from "./site-navigation";

type SecurityControl = Readonly<{
  label: string;
  status: "REJECTED" | "VERIFIED";
  eventId: string;
}>;

const operatingRoles = [
  {
    title: "Procurement Agent",
    description: "Proposes actions. No payment execution authority.",
    icon: "/operating-model/procurement-agent.png",
  },
  {
    title: "Authority",
    description: "Evaluates the proposal against exact policy.",
    icon: "/operating-model/authority.png",
  },
  {
    title: "Authorization Signer",
    description: "Authorizes exact approved payment data.",
    icon: "/operating-model/authorization-signer.png",
  },
  {
    title: "Circle Executor",
    description: "Submits only authorized immutable instructions.",
    icon: "/operating-model/circle-executor.png",
  },
  {
    title: "CovenantVault",
    description: "Enforces financial rules onchain.",
    icon: "/operating-model/covenant-vault.png",
  },
  {
    title: "Audit / Evidence",
    description: "Observes and explains outcomes.",
    icon: "/operating-model/audit-evidence.png",
  },
] as const;

export function LandingPage({
  evidence,
  securityControls,
}: Readonly<{
  evidence: EvidencePreviewProps;
  securityControls: readonly SecurityControl[];
}>) {
  return (
    <div className="site-root">
      <SiteNavigation />

      <main id="main-content">
        <section className="site-hero" aria-labelledby="hero-title">
          <div className="site-container">
            <Reveal className="hero-copy">
              <p className="site-kicker">
                Financial governance infrastructure for autonomous software
              </p>
              <h1 id="hero-title">
                Bounded financial authority for autonomous software
              </h1>
              <p className="hero-lede">
                AI proposes. Covenant authorizes. Circle submits. Arc execution
                is independently verified.
              </p>
              <div className="site-actions">
                <span
                  aria-disabled="true"
                  className="site-button site-button-primary site-button-disabled"
                >
                  Documentation coming soon
                </span>
                <a
                  className="site-button site-button-secondary"
                  href="#use-case"
                >
                  View Use Case
                </a>
              </div>
            </Reveal>
          </div>
        </section>

        <section
          className="site-section product-section"
          id="product"
          aria-labelledby="product-title"
        >
          <div className="site-container product-stage">
            <span aria-hidden="true" className="product-ghost-word">
              CONTROL
            </span>
            <Reveal className="product-heading">
              <p className="site-kicker">THE CONTROL LAYER</p>
              <h2 id="product-title">
                Financial control infrastructure around autonomous agents
              </h2>
            </Reveal>
            <Reveal
              className="product-statement product-statement-first"
              delay={80}
            >
              <p>AI agents decide what actions they want to take.</p>
            </Reveal>
            <Reveal
              className="product-statement product-statement-second"
              delay={140}
            >
              <p>
                COVENANT governs whether those actions receive financial
                authority.
              </p>
            </Reveal>
            <Reveal className="product-limits" delay={180}>
              <div>
                <span>THE AGENT DOES NOT</span>
                <div className="product-limit-list">
                  <strong>approve its own request</strong>
                  <strong>receive unrestricted access to funds</strong>
                </div>
              </div>
              <span
                aria-disabled="true"
                className="product-docs-cta product-docs-cta-disabled"
              >
                Documentation coming soon
              </span>
            </Reveal>
          </div>
        </section>

        <section
          className="site-section operation-section"
          id="how-it-works"
          aria-labelledby="operation-title"
        >
          <div className="site-container">
            <Reveal className="operation-intro">
              <p className="site-kicker">OPERATING MODEL</p>
              <h2 id="operation-title">Separation is the system.</h2>
              <p>
                Each component has one narrow responsibility. Proposal and
                payment execution never share authority.
              </p>
            </Reveal>

            <div className="role-pipeline">
              {operatingRoles.map(({ title, description, icon }, itemIndex) => (
                <Reveal delay={itemIndex * 55} key={title}>
                  <article className="operation-role">
                    <div className="operation-role-icon" aria-hidden="true">
                      <Image
                        alt=""
                        height={96}
                        src={icon}
                        unoptimized
                        width={96}
                      />
                    </div>
                    <div className="operation-role-copy">
                      <h3>{title}</h3>
                      <p>{description}</p>
                    </div>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section
          className="use-case-section"
          id="use-case"
          aria-labelledby="use-case-title"
        >
          <ProcurementScenario />
        </section>

        <section
          className="site-section security-section"
          id="security"
          aria-labelledby="security-title"
        >
          <div className="site-container">
            <Reveal className="section-intro security-intro">
              <p className="site-kicker">SECURITY MODEL</p>
              <h2 id="security-title">Authority stays separated by design</h2>
              <p>
                The frozen demonstration makes failures inspectable without
                expanding its security claims.
              </p>
            </Reveal>

            <div className="security-grid">
              {securityControls.map((control, index) => (
                <Reveal delay={index * 55} key={control.eventId}>
                  <article className="security-control">
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <h3>{control.label}</h3>
                    <strong data-status={control.status}>
                      {control.status}
                    </strong>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section
          className="site-section evidence-section"
          id="evidence"
          aria-labelledby="evidence-title"
        >
          <div className="site-container evidence-layout">
            <Reveal className="section-intro evidence-copy">
              <p className="site-kicker">PRODUCT EVIDENCE</p>
              <h2 id="evidence-title">
                Two trust domains. One precise account.
              </h2>
              <div className="evidence-copy-body">
                <p>
                  Circle provider evidence and Arc execution evidence stay
                  separate. Provider state alone never establishes Arc success.
                </p>
                <p className="claim-note">
                  Observed Arc execution is not described as settlement or
                  finality.
                </p>
              </div>
            </Reveal>
            <Reveal delay={100}>
              <EvidencePreview evidence={evidence} />
            </Reveal>
          </div>
        </section>

        <section className="site-final-cta" aria-labelledby="final-cta-title">
          <div className="site-container">
            <Reveal>
              <p className="site-kicker">COVENANT / MVP</p>
              <h2 id="final-cta-title">
                Give autonomous software rules for money.
              </h2>
              <p>
                Separate proposal, authorization, execution, enforcement, and
                evidence.
              </p>
              <div className="site-actions">
                <span
                  aria-disabled="true"
                  className="site-button site-button-primary site-button-disabled"
                >
                  Documentation coming soon
                </span>
                <a
                  className="site-button site-button-secondary"
                  href="#use-case"
                >
                  View Use Case
                </a>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="site-container footer-layout">
          <div>
            <Link aria-label="COVENANT home" className="footer-brand" href="/">
              <BrandLogo />
            </Link>
            <p>Bounded financial authority for autonomous software.</p>
          </div>
          <nav aria-label="Footer navigation">
            <a href="#product">Product</a>
            <a href="#security">Security</a>
          </nav>
          <p>Arc Testnet · Read-only evidence</p>
        </div>
      </footer>
    </div>
  );
}
