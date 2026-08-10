"use client";

import React, { useEffect, useRef } from "react";
import { ProcurementIcon, type ProcurementIconName } from "./procurement-icon";

const procurementSteps: readonly Readonly<{
  label: string;
  icon: ProcurementIconName;
}>[] = [
  { label: "AI detects low inventory", icon: "inventory" },
  { label: "AI proposes a supplier purchase", icon: "proposal" },
  { label: "COVENANT checks policy", icon: "policy" },
  {
    label: "Exact payment receives authorization",
    icon: "authorization",
  },
  { label: "Executor submits only authorized data", icon: "execution" },
  { label: "CovenantVault enforces financial rules", icon: "vault" },
  { label: "Audit evidence records the outcome", icon: "evidence" },
] as const;

export function ProcurementScenario() {
  const sceneRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const scene = sceneRef.current;
    const viewport = viewportRef.current;
    const track = trackRef.current;

    if (!scene || !viewport || !track) {
      return;
    }

    let animationFrame = 0;

    const render = () => {
      animationFrame = 0;
      const availableScroll = Math.max(
        scene.offsetHeight - window.innerHeight,
        1,
      );
      const progress = Math.min(
        Math.max(-scene.getBoundingClientRect().top / availableScroll, 0),
        1,
      );
      const availableShift = Math.max(
        track.scrollWidth - viewport.clientWidth,
        0,
      );

      const horizontalOffset = String(-progress * availableShift);
      track.style.transform = `translate3d(${horizontalOffset}px, 0, 0)`;
    };

    const requestRender = () => {
      if (animationFrame === 0) {
        animationFrame = window.requestAnimationFrame(render);
      }
    };

    render();
    window.addEventListener("scroll", requestRender, { passive: true });
    window.addEventListener("resize", requestRender);

    return () => {
      window.removeEventListener("scroll", requestRender);
      window.removeEventListener("resize", requestRender);
      window.cancelAnimationFrame(animationFrame);
    };
  }, []);

  return (
    <div className="procurement-scroll-scene" ref={sceneRef}>
      <div className="procurement-sticky">
        <div className="site-container procurement-stage">
          <header className="scenario-header">
            <p className="site-kicker">ILLUSTRATIVE PROCUREMENT SCENARIO</p>
            <div className="scenario-heading-row">
              <h2 id="use-case-title">
                Autonomous procurement without unrestricted AI access to money
              </h2>
              <p>
                An AI procurement agent notices inventory is running low and
                proposes a $4,800 supplier purchase.
              </p>
            </div>
          </header>

          <div className="procurement-viewport" ref={viewportRef}>
            <ol
              className="procurement-track"
              aria-label="Illustrative procurement sequence"
              ref={trackRef}
            >
              {procurementSteps.map(({ label, icon }, index) => (
                <li className="procurement-card" key={label}>
                  <div className="procurement-card-top">
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <ProcurementIcon name={icon} />
                  </div>
                  <strong>{label}</strong>
                </li>
              ))}
            </ol>
          </div>

          <p className="use-case-close">
            AI decides what it wants to buy. COVENANT controls what it is
            allowed to do with money.
          </p>
        </div>
      </div>
    </div>
  );
}
