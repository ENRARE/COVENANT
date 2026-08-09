import type {
  AuditDisplayModel,
  DisplayEntry,
  DisplayEvent,
} from "@/lib/audit-display";
import React from "react";

const roles = [
  [
    "01",
    "Procurement Agent",
    "Proposes exact payment intent. Cannot authorize or execute.",
  ],
  [
    "02",
    "Authority",
    "Evaluates the frozen policy and records an independent decision.",
  ],
  [
    "03",
    "Authorization Signer",
    "Authorizes only the exact approved payment for a short window.",
  ],
  [
    "04",
    "Circle Executor",
    "Submits immutable authorized data. Cannot choose payment fields.",
  ],
  [
    "05",
    "CovenantVault",
    "Enforces limits, replay protection, revocation, and token movement.",
  ],
  [
    "06",
    "Audit / Evidence",
    "Observes and explains. Holds no financial authority.",
  ],
] as const;

function short(value: string, start = 10, end = 6) {
  return value.length <= start + end + 3
    ? value
    : `${value.slice(0, start)}…${value.slice(-end)}`;
}

function InspectableValue({ value }: Readonly<{ value: string }>) {
  return <code title={value}>{short(value)}</code>;
}

function Fact({ label, value }: Readonly<DisplayEntry>) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd>
        <InspectableValue value={value} />
      </dd>
    </div>
  );
}

function TimelineEvent({ event }: Readonly<{ event: DisplayEvent }>) {
  return (
    <details
      className="timeline-event"
      data-event-type={event.eventType}
      data-stage={event.stage}
    >
      <summary>
        <span className="timeline-index">
          {event.sequence.padStart(2, "0")}
        </span>
        <span className="timeline-title">
          <small>{event.stage.replaceAll("_", " ")}</small>
          <strong>{event.eventType.replaceAll("_", " ")}</strong>
        </span>
        <span className={`status status-${event.outcome.toLowerCase()}`}>
          {event.outcome}
        </span>
      </summary>
      <div className="event-inspector">
        <div className="inspector-classification">
          <span>{event.evidenceClass}</span>
          <span>{event.claimScope}</span>
        </div>
        <dl className="inspector-grid">
          <Fact label="eventId" value={event.eventId} />
          <Fact label="source kind" value={event.source.kind} />
          <Fact label="source event type" value={event.source.eventType} />
          <Fact label="source identity" value={event.source.identity} />
          <Fact label="source position" value={event.source.position} />
          {event.source.occurredAt === undefined ? null : (
            <Fact label="source occurredAt" value={event.source.occurredAt} />
          )}
          {event.subject.map((entry) => (
            <Fact key={`subject-${entry.label}`} {...entry} />
          ))}
          {event.causes.map((cause, index) => (
            <Fact
              key={cause}
              label={`causal parent ${String(index + 1)}`}
              value={cause}
            />
          ))}
          {event.details.map((entry) => (
            <Fact key={`detail-${entry.label}`} {...entry} />
          ))}
        </dl>
      </div>
    </details>
  );
}

function Claim({ label, value }: Readonly<{ label: string; value: boolean }>) {
  return (
    <div className="claim-row">
      <span>{label}</span>
      <strong className={value ? "claim-yes" : "claim-no"}>
        {value ? "Yes" : "No"}
      </strong>
    </div>
  );
}

export function AuditConsole({
  model,
}: Readonly<{ model: AuditDisplayModel }>) {
  return (
    <main className="console-shell" id="main-content">
      <header className="topbar">
        <div className="wordmark" aria-label="Covenant">
          COVENANT<span>•</span>
        </div>
        <nav aria-label="Console sections">
          <span>Authority</span>
          <span>Evidence</span>
          <span>Controls</span>
          <span>Timeline</span>
          <span>Claims</span>
        </nav>
        <span className="read-only-badge">
          Read-only / Schema v{model.schemaVersion}
        </span>
      </header>

      <section className="hero" aria-labelledby="console-title">
        <div className="hero-copy">
          <p className="eyebrow">ARC TESTNET / FROZEN MVP DEMONSTRATION</p>
          <h1 id="console-title">
            Bounded financial authority for autonomous software
          </h1>
          <p className="sequence-copy">
            AI proposes. Covenant authorizes. Circle submits. Arc execution is
            independently verified.
          </p>
          <div className="invariant">
            <span>SECURITY INVARIANT</span>
            <strong>
              No component capable of generating payment requests shall possess
              authority to execute payments.
            </strong>
          </div>
        </div>
        <div className="hero-orbit" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="orbit-core">C</div>
          <span className="orbit-label orbit-agent">PROPOSE</span>
          <span className="orbit-label orbit-authority">AUTHORIZE</span>
          <span className="orbit-label orbit-execute">OBSERVE</span>
        </div>
      </section>

      <section
        className="payment-card"
        id="payment"
        aria-labelledby="payment-title"
      >
        <div className="payment-amount">
          <p className="eyebrow">APPROVED PAYMENT</p>
          <h2 id="payment-title">{model.payment.amount}</h2>
          <span>{model.payment.amountBaseUnits} base units</span>
        </div>
        <dl className="payment-facts">
          <Fact label="Network" value={model.payment.network} />
          <Fact label="Recipient" value={model.payment.recipient} />
          <Fact label="CovenantVault" value={model.payment.vault} />
          <Fact
            label="Provider outcome"
            value={model.payment.providerOutcome}
          />
          <Fact label="Automatic retry" value="No" />
          <Fact
            label="Execution classification"
            value={model.payment.executionClassification}
          />
        </dl>
      </section>

      <section
        className="section"
        id="authority"
        aria-labelledby="authority-title"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">AUTHORITY SEPARATION</p>
            <h2 id="authority-title">One payment. Six bounded roles.</h2>
          </div>
          <p>No role can both invent a payment request and execute it.</p>
        </div>
        <div className="role-grid">
          {roles.map(([number, title, description]) => (
            <article className="role-card" key={title}>
              <span>{number}</span>
              <h3>{title}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </section>

      <section
        className="section"
        id="evidence"
        aria-labelledby="evidence-title"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">TWO TRUST DOMAINS</p>
            <h2 id="evidence-title">Provider state is not chain evidence.</h2>
          </div>
          <p>
            Independent observations stay separate until deterministic
            reconciliation.
          </p>
        </div>
        <div className="evidence-grid">
          <article className="evidence-panel provider-panel">
            <header>
              <span className="domain-mark">01</span>
              <div>
                <p className="eyebrow">PROVIDER EVIDENCE</p>
                <h3>Circle submission boundary</h3>
              </div>
              <span className="status status-unknown">UNKNOWN</span>
            </header>
            <div
              className="progression"
              aria-label="Circle durable progression"
            >
              {model.providerEvidence.progression.map((step, index) => (
                <div key={step}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{step}</strong>
                </div>
              ))}
            </div>
            <div className="evidence-note">
              <strong>No automatic retry</strong>
              <p>Provider evidence alone does not prove Arc execution.</p>
            </div>
          </article>

          <article className="evidence-panel arc-panel">
            <header>
              <span className="domain-mark">02</span>
              <div>
                <p className="eyebrow">ARC EVIDENCE</p>
                <h3>Observed Arc Testnet execution</h3>
              </div>
              <span className="status status-verified">RECEIPT SUCCESS</span>
            </header>
            <div className="check-grid">
              {model.arcEvidence.checks.map((check) => (
                <div className="check" key={check.label}>
                  <span aria-hidden="true">✓</span>
                  <div>
                    <strong>{check.label}</strong>
                    <InspectableValue value={check.value} />
                  </div>
                </div>
              ))}
            </div>
            <dl className="accounting-grid">
              {model.arcEvidence.accounting.map((entry) => (
                <Fact key={entry.label} {...entry} />
              ))}
            </dl>
          </article>
        </div>
        <div className="reconciliation" data-testid="reconciliation">
          <div>
            <p className="eyebrow">RECONCILIATION</p>
            <strong>{model.payment.executionClassification}</strong>
          </div>
          <p>
            Independent Arc receipt, log, transfer, and vault-state evidence
            resolves the execution question without another Circle POST.
          </p>
        </div>
      </section>

      <section
        className="section"
        id="controls"
        aria-labelledby="controls-title"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">SECURITY CONTROLS</p>
            <h2 id="controls-title">Rejection paths stay visible.</h2>
          </div>
          <p>The compromised-proposer result covers one fixed scenario only.</p>
        </div>
        <div className="control-grid">
          {model.securityControls.map((control) => (
            <article className="control-card" key={control.label}>
              <span
                className={`control-dot control-${control.status.toLowerCase()}`}
              />
              <div>
                <h3>{control.label}</h3>
                <InspectableValue value={control.eventId} />
              </div>
              <strong>{control.status}</strong>
            </article>
          ))}
        </div>
      </section>

      <section
        className="section timeline-section"
        id="timeline"
        aria-labelledby="timeline-title"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">DETERMINISTIC AUDIT TIMELINE</p>
            <h2 id="timeline-title">
              {model.events.length} canonical events. Every link inspectable.
            </h2>
          </div>
          <p>
            Select an event to inspect source identity, causal parents, and
            sanitized details.
          </p>
        </div>
        <div className="projection-strip">
          <span>PROJECTION ID</span>
          <code title={model.projectionId}>{model.projectionId}</code>
          <span>{model.mode.replaceAll("_", " ")}</span>
        </div>
        <div className="timeline-list">
          {model.events.map((event) => (
            <TimelineEvent key={event.eventId} event={event} />
          ))}
        </div>
      </section>

      <section
        className="section claim-boundary"
        id="claims"
        aria-labelledby="claims-title"
      >
        <div>
          <p className="eyebrow">CLAIM BOUNDARY</p>
          <h2 id="claims-title">
            What this demonstration proves—and what it does not.
          </h2>
          <p>
            Evidence is deterministic and non-authoritative. CovenantVault
            remains authoritative for financial enforcement.
          </p>
        </div>
        <div className="claim-list">
          <Claim
            label="Circle submission attempt observed"
            value={model.claimBoundary.circleSubmissionAttemptObserved}
          />
          <Claim
            label="Circle provider outcome known"
            value={model.claimBoundary.circleProviderOutcomeKnown}
          />
          <Claim
            label="Arc execution observed"
            value={model.claimBoundary.arcExecutionObserved}
          />
          <Claim
            label="Arc payment settlement claimed"
            value={model.claimBoundary.arcPaymentSettlement}
          />
          <Claim
            label="Payment finality claimed"
            value={model.claimBoundary.paymentFinality}
          />
          <Claim
            label="Database financial authority"
            value={model.claimBoundary.databaseFinancialAuthority}
          />
          <Claim
            label="Automatic resubmission performed"
            value={model.claimBoundary.automaticResubmission}
          />
        </div>
      </section>

      <footer>
        <span>COVENANT / MVP</span>
        <p>
          Static committed evidence · No runtime network · No payment authority
        </p>
      </footer>
    </main>
  );
}
