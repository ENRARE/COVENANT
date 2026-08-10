"use client";

import {
  default as React,
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

export function Reveal({
  children,
  delay = 0,
  className = "",
}: Readonly<{
  children: ReactNode;
  delay?: number;
  className?: string;
}>) {
  const elementRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = elementRef.current;
    if (element === null) return;

    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !("IntersectionObserver" in window)
    ) {
      setVisible(true);
      setReady(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -10%", threshold: 0.1 },
    );

    observer.observe(element);
    setReady(true);
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div
      className={`site-reveal ${className}`.trim()}
      data-ready={ready}
      data-visible={visible}
      ref={elementRef}
      style={{ "--reveal-delay": `${String(delay)}ms` } as CSSProperties}
    >
      {children}
    </div>
  );
}
