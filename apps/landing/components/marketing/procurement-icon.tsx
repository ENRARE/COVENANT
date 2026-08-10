import React from "react";

export type ProcurementIconName =
  | "inventory"
  | "proposal"
  | "policy"
  | "authorization"
  | "execution"
  | "vault"
  | "evidence";

function IconGlyph({ name }: Readonly<{ name: ProcurementIconName }>) {
  switch (name) {
    case "inventory":
      return (
        <>
          <path d="M8 13h32v27H8z" />
          <path d="M8 23h32M18 13v10M30 23v17" />
          <path d="m13 8 5-3 5 3-5 3-5-3Z" />
          <path d="M13 8v5l5 3 5-3V8" />
        </>
      );
    case "proposal":
      return (
        <>
          <path d="M11 6h19l7 7v29H11z" />
          <path d="M30 6v8h7M17 22h14M17 29h9" />
          <path d="M34 31v10M29 36h10" />
        </>
      );
    case "policy":
      return (
        <>
          <path d="M8 13h32M8 24h32M8 35h32" />
          <circle cx="18" cy="13" r="4" />
          <circle cx="31" cy="24" r="4" />
          <circle cx="15" cy="35" r="4" />
          <path d="m28 36 4 4 8-9" />
        </>
      );
    case "authorization":
      return (
        <>
          <path d="M24 5 38 10v11c0 10-5.8 17.2-14 22-8.2-4.8-14-12-14-22V10l14-5Z" />
          <path d="m16 24 5 5 11-12" />
        </>
      );
    case "execution":
      return (
        <>
          <path d="M7 16h25M26 10l6 6-6 6" />
          <path d="M41 32H16M22 26l-6 6 6 6" />
          <rect x="7" y="27" width="8" height="10" rx="1" />
          <rect x="33" y="11" width="8" height="10" rx="1" />
        </>
      );
    case "vault":
      return (
        <>
          <rect x="6" y="8" width="36" height="33" rx="2" />
          <path d="M12 14h24v21H12z" />
          <circle cx="24" cy="24.5" r="6" />
          <path d="M24 18.5v12M18 24.5h12M42 17h-4M42 32h-4" />
        </>
      );
    case "evidence":
      return (
        <>
          <path d="M8 6h22l7 7v17" />
          <path d="M30 6v8h7M8 6v36h22M14 21h15M14 28h10" />
          <circle cx="33" cy="34" r="7" />
          <path d="m38 39 5 5m-13-10 2 2 4-5" />
        </>
      );
  }
}

export function ProcurementIcon({
  name,
}: Readonly<{ name: ProcurementIconName }>) {
  return (
    <svg
      aria-hidden="true"
      className="procurement-card-icon"
      data-procurement-icon={name}
      fill="none"
      focusable="false"
      viewBox="0 0 48 48"
    >
      <g
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      >
        <IconGlyph name={name} />
      </g>
    </svg>
  );
}
