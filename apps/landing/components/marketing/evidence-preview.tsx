import React from "react";

export type EvidencePreviewProps = Readonly<{
  amount: string;
  network: string;
  providerOutcome: string;
  automaticRetry: boolean;
  arcObserved: boolean;
  reconciliation: string;
}>;

export function EvidencePreview({
  evidence,
}: Readonly<{ evidence: EvidencePreviewProps }>) {
  return (
    <div className="preview-console">
      <div className="preview-toolbar">
        <span>COVENANT / READ-ONLY EVIDENCE</span>
        <span>SCHEMA V2</span>
      </div>
      <div className="preview-summary">
        <div>
          <span>Approved payment</span>
          <strong>{evidence.amount}</strong>
        </div>
        <dl>
          <div>
            <dt>Network</dt>
            <dd>{evidence.network}</dd>
          </div>
          <div>
            <dt>Automatic retry</dt>
            <dd>{evidence.automaticRetry ? "Yes" : "No"}</dd>
          </div>
        </dl>
      </div>
      <div className="preview-domains">
        <article className="preview-domain preview-domain-provider">
          <span>TRUST DOMAIN / PROVIDER</span>
          <h3>Circle provider</h3>
          <strong>{evidence.providerOutcome}</strong>
          <p>Provider state remains separate from Arc observation.</p>
        </article>
        <article className="preview-domain preview-domain-arc">
          <span>TRUST DOMAIN / ARC</span>
          <h3>Arc evidence</h3>
          <strong>
            {evidence.arcObserved ? "Execution observed" : "Not observed"}
          </strong>
          <p>Independent read-only evidence; not a finality claim.</p>
        </article>
      </div>
      <div className="preview-reconciliation">
        <span>RECONCILIATION</span>
        <strong>{evidence.reconciliation}</strong>
      </div>
      <p className="text-link text-link-static">
        Evidence console available in the local demonstration
      </p>
    </div>
  );
}
