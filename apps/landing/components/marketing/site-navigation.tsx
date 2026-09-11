"use client";

import Link from "next/link";
import React, { useEffect, useState } from "react";
import { BrandLogo } from "./brand-logo";

const links = [
  ["Product", "#product"],
  ["Lifecycle", "#lifecycle"],
  ["Developers", "#developers"],
  ["Security", "#security"],
  ["Docs", "/docs"],
  ["GitHub", "https://github.com/ENRARE/COVENANT"],
] as const;

export function SiteNavigation() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const update = () => {
      setScrolled(window.scrollY > 18);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => {
      window.removeEventListener("scroll", update);
    };
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  return (
    <>
      <a className="site-skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="site-header">
        <nav
          aria-label="Primary navigation"
          className="site-nav"
          data-scrolled={scrolled}
        >
          <Link
            aria-label="COVENANT home"
            className="site-brand"
            href="/"
            onClick={() => {
              setMenuOpen(false);
            }}
          >
            <BrandLogo priority />
          </Link>

          <div className="site-nav-links">
            {links.map(([label, href]) => (
              <a href={href} key={href}>
                {label}
              </a>
            ))}
          </div>

          <a className="site-nav-cta" href="/docs#quickstart">
            Get Started
          </a>
          <a className="site-nav-cta" href="/docs#installation">
            Install SDK
          </a>

          <button
            aria-controls="mobile-navigation"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            className="site-menu-trigger"
            onClick={() => {
              setMenuOpen((current) => !current);
            }}
            type="button"
          >
            <span />
            <span />
          </button>

          <div
            className="site-mobile-menu"
            data-open={menuOpen}
            id="mobile-navigation"
          >
            {links.map(([label, href]) => (
              <a
                href={href}
                key={href}
                onClick={() => {
                  setMenuOpen(false);
                }}
              >
                {label}
              </a>
            ))}
            <a
              className="site-mobile-cta"
              href="/docs#quickstart"
              onClick={() => {
                setMenuOpen(false);
              }}
            >
              Get Started
            </a>
            <a
              className="site-mobile-cta"
              href="/docs#installation"
              onClick={() => {
                setMenuOpen(false);
              }}
            >
              Install SDK
            </a>
          </div>
        </nav>
      </header>
    </>
  );
}
