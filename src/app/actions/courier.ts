"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { normalizeCourierTracking, courierOrderKey } from "@/lib/courier-status";
import { linkCourierOrder, requestCourierTrackingSync } from "@/lib/courier-tracking-store";
import { kickCourierTrackingSync } from "@/lib/courier-tracking-worker";
import { readReturnImportOrders } from "@/lib/google-order-status";

export async function refreshCourierStatusesAction() {
  if (!await requireAuth()) redirect("/login");
  requestCourierTrackingSync(true);
  void kickCourierTrackingSync();
  revalidatePath("/in-transit");
  redirect("/in-transit?sync=queued");
}
export async function linkCourierTrackingAction(form: FormData) {
  if (!await requireAuth()) redirect("/login");
  let error = "";
  try {
    const key = String(form.get("orderKey") || "");
    const text = String(form.get("trackingNumbers") || "");
    if (!/^[a-f0-9]{64}$/.test(key) || text.length > 3000) throw new Error("invalid-tracking");
    const values = text.split(/[\s,;]+/).filter(Boolean).map(normalizeCourierTracking);
    if (!values.length || values.some(v => !v)) throw new Error("invalid-tracking");
    const orders = await readReturnImportOrders();
    const matches = orders.filter(o => courierOrderKey(o) === key && !o.appStatus && !o.deliveredChecked);
    if (matches.length !== 1) throw new Error("order-changed");
    linkCourierOrder(matches[0], values as string[], "manual");
    requestCourierTrackingSync();
    void kickCourierTrackingSync();
  } catch (e) {
    const known = e instanceof Error ? e.message : "";
    error = ["invalid-tracking", "parcel-count", "tracking-already-linked", "order-changed"].includes(known) ? known : "link-failed";
  }
  revalidatePath("/in-transit");
  redirect(error ? `/in-transit?view=review&courierError=${error}` : "/in-transit?view=review&sync=queued");
}
