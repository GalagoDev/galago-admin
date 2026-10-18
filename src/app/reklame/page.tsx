import type { Metadata } from "next";

import { AdsDashboard } from "@/components/ads-dashboard";

export const metadata: Metadata = {
  title: "Reklame · Galago Admin",
  description: "Potrošnja, prodaja i rezultati Google i Meta reklama.",
};

export default function AdsPage() {
  return <AdsDashboard />;
}
