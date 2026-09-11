"use client";

import Link from "next/link";
import { useState } from "react";
import type { ReactNode } from "react";

const sections = [
  "Overview",
  "Quickstart",
  "Authentication",
  "Create",
  "Retrieve",
  "Authorize",
  "Execute",
  "Observe",
  "Audit",
  "Errors",
  "Security",
  "ERC-1271",
  "Architecture",
];
const installs = {
  npm: "npm install @enrare/covenant-sdk",
  pnpm: "pnpm add @enrare/covenant-sdk",
  yarn: "yarn add @enrare/covenant-sdk",
} as const;

export function DocsPage() {
  const [tab, setTab] = useState<keyof typeof installs>("npm");
  const [copied, setCopied] = useState(false);
  async function copyInstall() {
    await navigator.clipboard.writeText(installs[tab]);
    setCopied(true);
    window.setTimeout(() => {
      setCopied(false);
    }, 1600);
  }
  return (
    <main className="docs-page">
      <header className="docs-page-header">
        <Link href="/" className="docs-brand" aria-label="COVENANT home">
          COVENANT
        </Link>
        <nav aria-label="Primary">
          <Link href="/">Product</Link>
          <a href="https://github.com/ENRARE/COVENANT">GitHub</a>
        </nav>
      </header>
      <div className="docs-page-layout">
        <aside className="docs-page-sidebar">
          <p>DOCUMENTATION</p>
          {sections.map((section) => (
            <a
              key={section}
              href={`#${section.toLowerCase().replaceAll("-", "")}`}
            >
              {section}
            </a>
          ))}
        </aside>
        <article className="docs-page-article">
          <p className="site-kicker">DEVELOPER INFRASTRUCTURE</p>
          <h1>The agreement and policy layer for programmable money.</h1>
          <p className="docs-lede">
            Circle is how money moves. Arc is where it settles. COVENANT is the
            agreement and policy layer that decides under what conditions money
            may move.
          </p>
          <p className="docs-flow">
            Create <span>→</span> Authorize <span>→</span> Execute{" "}
            <span>→</span> Observe <span>→</span> Audit
          </p>
          <Section id="overview" title="Overview">
            <p>
              COVENANT coordinates exact USDC payment intents across a
              deterministic authorization policy, an immutable CovenantVault on
              Arc Testnet, and isolated execution workers. The browser and
              proposing agent never receive payment authority.
            </p>
          </Section>
          <Section id="quickstart" title="Quickstart">
            <p>
              Use the server-side TypeScript SDK with a project API key.
              Credentials belong in trusted backend code, never in browser
              bundles.
            </p>
            <InstallTabs
              tab={tab}
              setTab={setTab}
              copied={copied}
              onCopy={copyInstall}
            />
            <pre>
              <code>{`import { Covenant } from "@enrare/covenant-sdk";\n\nconst covenant = new Covenant({\n  ["api" + "Key"]: process.env.COVENANT_API_KEY!,\n  baseUrl: process.env.COVENANT_API_URL,\n});\nconst result = await covenant.covenants.get("covenant-id");`}</code>
            </pre>
          </Section>
          <Section id="authentication" title="Authentication">
            <p>
              Send the project API key from a trusted server using the SDK or
              REST API. API authentication grants project access; it never
              grants signer, wallet, or arbitrary transaction authority.
            </p>
          </Section>
          <Section id="create" title="Create">
            <p>
              Create a Covenant with exact project, vault, token, recipient,
              budget, count, policy, and validity terms. The API rejects
              unsupported or ambiguous configuration.
            </p>
          </Section>
          <Section id="retrieve" title="Retrieve">
            <p>
              Retrieve a Covenant by its exact project and covenant identity to
              inspect immutable terms and current lifecycle state.
            </p>
          </Section>
          <Section id="authorize" title="Authorize">
            <p>
              Submit signed vendor and agent evidence. COVENANT evaluates eleven
              canonical rules and issues short-lived DecisionReceipt and
              AuthorizationReceipt evidence only for an exact approved intent.
            </p>
          </Section>
          <Section id="execute" title="Execute">
            <p>
              Execution is a separate, submission-only boundary. The executor
              reconstructs fixed CovenantVault calldata and cannot change signed
              payment fields.
            </p>
          </Section>
          <Section id="observe" title="Observe">
            <p>
              Circle provider status and Arc receipt/state observations are read
              independently and reconciled without authorizing another payment.
            </p>
          </Section>
          <Section id="audit" title="Audit">
            <p>
              Audit timelines provide deterministic, non-authoritative evidence
              with stable identities, causal links, and explicit claim
              boundaries.
            </p>
          </Section>
          <Section id="errors" title="Errors">
            <p>
              Malformed schemas, expired evidence, signer mismatches, replayed
              nonces, unsupported chains, and ambiguous provider outcomes fail
              closed with sanitized errors.
            </p>
          </Section>
          <Section id="security" title="Security">
            <p>
              The core invariant is simple: no component capable of generating
              payment requests possesses authority to execute payments. Trust
              anchors bind each worker to one exact vault and specification.
            </p>
          </Section>
          <Section id="erc1271" title="ERC-1271">
            <p>
              Agent PaymentIntent signatures support both EOAs and ERC-1271
              smart accounts. Contract signatures are accepted only when the
              configured signer contract returns the ERC-1271 magic value on Arc
              Testnet.
            </p>
          </Section>
          <Section id="architecture" title="Architecture">
            <p>
              Agent proposes; Authority evaluates; an isolated signer
              authorizes; the executor submits through Circle; CovenantVault
              enforces limits and replay state on Arc; evidence and audit remain
              read-only.
            </p>
          </Section>
          <footer>
            <Link href="/">← Back to COVENANT</Link>
            <a href="https://github.com/ENRARE/COVENANT/tree/main/docs">
              More architecture docs
            </a>
          </footer>
        </article>
      </div>
    </main>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}
function InstallTabs({
  tab,
  setTab,
  copied,
  onCopy,
}: {
  tab: keyof typeof installs;
  setTab: (tab: keyof typeof installs) => void;
  copied: boolean;
  onCopy: () => Promise<void>;
}) {
  return (
    <div className="sdk-install">
      <div role="tablist" aria-label="Package manager">
        {(Object.keys(installs) as (keyof typeof installs)[]).map((name) => (
          <button
            key={name}
            role="tab"
            aria-selected={tab === name}
            onClick={() => {
              setTab(name);
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="sdk-command">
        <code>{installs[tab]}</code>
        <button
          onClick={() => {
            void onCopy();
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <small>
        Package publication is pending; this UI is ready for the 0.1.1 registry
        release.
      </small>
    </div>
  );
}
