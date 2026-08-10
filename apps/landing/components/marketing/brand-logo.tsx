import Image from "next/image";
import React from "react";

export function BrandLogo({
  variant = "white",
  priority = false,
}: Readonly<{
  variant?: "white" | "black";
  priority?: boolean;
}>) {
  const isWhite = variant === "white";

  return (
    <Image
      alt="COVENANT"
      className={`brand-logo brand-logo-${variant}`}
      height={714}
      priority={priority}
      src={isWhite ? "/brand/covenant-white.png" : "/brand/covenant-black.png"}
      unoptimized
      width={isWhite ? 2690 : 2688}
    />
  );
}
