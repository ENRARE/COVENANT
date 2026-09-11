import type { Metadata } from "next";
import { DocsPage } from "@/components/docs-page";

export const metadata: Metadata = {
  title: "Docs | COVENANT",
  description: "Build programmable money flows with COVENANT, Arc, and USDC.",
  alternates: { canonical: "/docs" },
};

export default function Page() {
  return <DocsPage />;
}
