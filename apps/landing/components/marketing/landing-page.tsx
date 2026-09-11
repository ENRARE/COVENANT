import Link from "next/link";
import { BrandLogo } from "./brand-logo";
import { Reveal } from "./reveal";
import { SiteNavigation } from "./site-navigation";

const lifecycle = [
  ["Create", "Define the agreement."],
  ["Authorize", "Evaluate policy and signatures."],
  ["Execute", "Submit approved USDC movement."],
  ["Observe", "Track execution state."],
  ["Audit", "Reconstruct what happened."],
] as const;
const security = [
  ["EOA + ERC-1271", "The configured signer stays the source of authority."],
  [
    "Fail closed",
    "Invalid, unavailable, or ambiguous verification never becomes approval.",
  ],
  [
    "Exact trust anchors",
    "Each worker is bound to one reviewed vault and CovenantSpec.",
  ],
  [
    "Deterministic policy",
    "Eleven canonical rules run in a fixed, auditable order.",
  ],
] as const;

export function LandingPage() {
  return (
    <div className="site-root refined-site">
      <SiteNavigation />
      <main id="main-content">
        <section
          className="site-hero refined-hero"
          aria-labelledby="hero-title"
        >
          <div className="site-container">
            <div className="hero-copy hero-sequence">
              <p className="site-kicker hero-eyebrow">
                Financial governance infrastructure for autonomous software
              </p>
              <div className="hero-title-mask">
                <h1 id="hero-title">
                  The agreement and policy layer for programmable money
                </h1>
              </div>
              <p className="hero-lede">
                Circle is how money moves. Arc is where it settles. COVENANT
                defines the agreement and conditions under which it may move.
              </p>
              <div className="site-actions hero-actions">
                <a
                  className="site-button site-button-primary"
                  href="/docs#installation"
                >
                  Install SDK
                </a>
                <a
                  className="site-button site-button-secondary"
                  href="/docs#quickstart"
                >
                  Get Started
                </a>
              </div>
            </div>
          </div>
        </section>
        <section
          className="site-section positioning-section"
          id="product"
          aria-labelledby="positioning-title"
        >
          <div className="site-container">
            <Reveal>
              <p className="site-kicker">THE CONTROL LAYER</p>
              <h2 id="positioning-title">
                Money movement needs an explicit authority boundary.
              </h2>
            </Reveal>
            <div className="positioning-flow">
              {[
                ["Circle", "How money moves"],
                ["Arc", "Where it settles"],
                ["COVENANT", "Under what agreement and conditions it may move"],
              ].map(([name, copy], index) => (
                <Reveal delay={(index + 1) * 70} key={name}>
                  <div>
                    <span>{name}</span>
                    <strong>{copy}</strong>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>
        <section
          className="site-section lifecycle-section"
          id="lifecycle"
          aria-labelledby="lifecycle-title"
        >
          <div className="site-container">
            <Reveal>
              <p className="site-kicker">LIFECYCLE</p>
              <h2 id="lifecycle-title">
                One controlled path from intent to evidence.
              </h2>
            </Reveal>
            <ol className="lifecycle-flow">
              {lifecycle.map(([title, copy], index) => (
                <li key={title}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{title}</strong>
                  <p>{copy}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>
        <section
          className="site-section sdk-section"
          id="developers"
          aria-labelledby="sdk-title"
        >
          <div className="site-container sdk-layout">
            <Reveal>
              <p className="site-kicker">TYPESCRIPT SDK</p>
              <h2 id="sdk-title">Start from your trusted backend.</h2>
              <p>
                Use the public SDK without creating a second authorization or
                execution path.
              </p>
              <a className="text-link" href="/docs#quickstart">
                Read the quickstart →
              </a>
            </Reveal>
            <Reveal delay={100}>
              <pre className="sdk-code">
                <code>{`npm install @enrare/covenant-sdk\n\nimport { Covenant } from "@enrare/covenant-sdk";\n\nconst covenant = new Covenant({\n  ["api" + "Key"]: process.env.COVENANT_API_KEY!,\n});`}</code>
              </pre>
            </Reveal>
          </div>
        </section>
        <section
          className="site-section trust-section"
          id="security"
          aria-labelledby="security-title"
        >
          <div className="site-container">
            <Reveal>
              <p className="site-kicker">SECURITY MODEL</p>
              <h2 id="security-title">Authority stays separated by design.</h2>
            </Reveal>
            <div className="trust-list">
              {security.map(([title, copy], index) => (
                <Reveal delay={index * 70} key={title}>
                  <article>
                    <strong>{title}</strong>
                    <p>{copy}</p>
                  </article>
                </Reveal>
              ))}
            </div>
            <a className="text-link" href="/docs#security">
              Explore the security model →
            </a>
          </div>
        </section>
        <section className="site-final-cta" aria-labelledby="final-cta-title">
          <div className="site-container">
            <Reveal>
              <h2 id="final-cta-title">
                Build programmable money with explicit rules.
              </h2>
              <div className="site-actions">
                <a
                  className="site-button site-button-primary"
                  href="/docs#installation"
                >
                  Install SDK
                </a>
                <a
                  className="site-button site-button-secondary"
                  href="/docs#quickstart"
                >
                  Get Started
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
            <p>The agreement and policy layer for programmable money.</p>
          </div>
          <nav aria-label="Footer navigation">
            <a href="#product">Product</a>
            <a href="/docs">Docs</a>
            <a href="/docs#installation">Install SDK</a>
            <a href="https://github.com/ENRARE/COVENANT">GitHub</a>
          </nav>
          <p>Arc Testnet · USDC</p>
        </div>
      </footer>
    </div>
  );
}
