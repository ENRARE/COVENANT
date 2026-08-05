"use client";

import { useMemo, useState } from "react";
import type { AuditDisplayModel, DisplayEvent } from "@/lib/audit-display";

const TRUNCATE_AT = 18;

function short(value: string) {
  return value.length <= TRUNCATE_AT
    ? value
    : `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function Field({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="field">
      <dt>{label}</dt>
      <dd title={value}>{short(value)}</dd>
    </div>
  );
}

function EventCard({ event }: Readonly<{ event: DisplayEvent }>) {
  return (
    <article
      className="event-card"
      data-event-type={event.eventType}
      data-stage={event.stage}
    >
      <header>
        <span className="sequence">#{event.sequence}</span>
        <div>
          <p className="eyebrow">{event.stage.replaceAll("_", " ")}</p>
          <h2>{event.eventType.replaceAll("_", " ")}</h2>
        </div>
        <span className={`outcome outcome-${event.outcome.toLowerCase()}`}>
          {event.outcome}
        </span>
      </header>
      <div className="classification">
        <span>{event.evidenceClass}</span>
        <span>{event.claimScope}</span>
      </div>
      <dl className="event-fields">
        <Field label="eventId" value={event.eventId} />
        <Field
          label="source"
          value={`${event.source.kind} / ${event.source.eventType} / ${event.source.position}`}
        />
        {event.causes.map((cause, index) => (
          <Field
            key={cause}
            label={`cause ${String(index + 1)}`}
            value={cause}
          />
        ))}
        {event.details.map((entry) => (
          <Field key={entry.label} label={entry.label} value={entry.value} />
        ))}
      </dl>
    </article>
  );
}

export function AuditConsole({
  model,
}: Readonly<{ model: AuditDisplayModel }>) {
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("ALL");
  const stages = useMemo(
    () => ["ALL", ...new Set(model.events.map((event) => event.stage))],
    [model.events],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return model.events.filter((event) => {
      const matchesStage = stage === "ALL" || event.stage === stage;
      const haystack =
        `${event.eventType} ${event.stage} ${event.outcome} ${event.evidenceClass} ${event.claimScope}`.toLowerCase();
      return matchesStage && (needle === "" || haystack.includes(needle));
    });
  }, [model.events, query, stage]);

  return (
    <main className="console-shell">
      <section className="hero" aria-labelledby="console-title">
        <div>
          <p className="eyebrow">COVENANT / MVP AUDIT CONSOLE</p>
          <h1 id="console-title">
            Authorization evidence, not payment authority.
          </h1>
          <p className="lede">
            A deterministic, offline projection of one frozen demonstration.
            This interface cannot propose, authorize, submit, settle, or revoke
            payments.
          </p>
        </div>
        <div className="mode-card">
          <span>MODE</span>
          <strong>{model.mode.replaceAll("_", " ")}</strong>
          <span>EVENTS</span>
          <strong>{model.events.length}</strong>
        </div>
      </section>

      <section className="boundary" aria-labelledby="boundary-title">
        <div>
          <p className="eyebrow">CLAIM BOUNDARY</p>
          <h2 id="boundary-title">All authority claims are false</h2>
        </div>
        {Object.entries(model.claimBoundary).map(([key, value]) => (
          <div className="boundary-item" key={key}>
            <span>{key}</span>
            <strong>{String(value).toUpperCase()}</strong>
          </div>
        ))}
      </section>

      <section className="identity" aria-label="Projection identity">
        <span>PROJECTION ID</span>
        <code>{model.projectionId}</code>
        <span>SCHEMA {model.schemaVersion}</span>
      </section>

      <section className="controls" aria-label="Ephemeral timeline controls">
        <label>
          FILTER EVENTS
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder="Try rejected or settlement"
          />
        </label>
        <label>
          STAGE
          <select
            value={stage}
            onChange={(event) => {
              setStage(event.target.value);
            }}
          >
            {stages.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <p>
          {filtered.length} of {model.events.length} events / controls are local
          and reset on reload
        </p>
      </section>

      <section className="timeline" aria-label="Audit timeline">
        {filtered.map((event) => (
          <EventCard key={event.eventId} event={event} />
        ))}
        {filtered.length === 0 ? (
          <p className="empty">No canonical events match this local view.</p>
        ) : null}
      </section>
    </main>
  );
}
