import React from "react";

export function TimelineUnavailable() {
  return (
    <main className="unavailable" data-testid="timeline-unavailable">
      <h1>Audit timeline unavailable</h1>
      <p>The validated audit timeline cannot be displayed.</p>
    </main>
  );
}
