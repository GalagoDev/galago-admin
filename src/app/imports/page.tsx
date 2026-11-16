import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { getImportsOverview } from "@/lib/import-payments";
import { ImportsPanel } from "@/components/imports-panel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function ImportsPage() {
  if (!await isAuthenticated()) redirect("/login");
  return <ImportsPanel initial={getImportsOverview()} />;
}
