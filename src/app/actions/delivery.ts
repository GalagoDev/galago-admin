"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { parseCourierDeliveryWorkbook } from "@/lib/delivery-workbook";
import { getActiveOrdersSheetRows } from "@/lib/google-sheets";
import {
  markOrdersDelivered,
  moveOrderToReturns,
  restoreReturnToTransit,
  type OrderMoveReference,
} from "@/lib/google-order-status";
import { matchCourierDeliveries, type DeliveryMatch } from "@/lib/order-matching";

export type DeliveryPreviewState = {
  status: "idle" | "ready" | "error";
  fileName: string;
  totalRows: number;
  matches: DeliveryMatch[];
  ambiguous: Array<{ recipient: string; candidates: string[] }>;
  unmatched: string[];
  error: string;
};

function parseReference(value: FormDataEntryValue): OrderMoveReference | null {
  if (typeof value !== "string" || value.length > 500) return null;
  try {
    const parsed = JSON.parse(value) as Partial<OrderMoveReference>;
    if (!Number.isInteger(parsed.sheetRowNumber) || Number(parsed.sheetRowNumber) < 2) return null;
    if (typeof parsed.fingerprint !== "string" || !/^[a-f0-9]{24}$/.test(parsed.fingerprint)) return null;
    if (typeof parsed.dateLabel !== "string" || !/^\d{2}\/\d{2}\/\d{4}$/.test(parsed.dateLabel)) return null;
    return {
      sheetRowNumber: Number(parsed.sheetRowNumber),
      fingerprint: parsed.fingerprint,
      dateLabel: parsed.dateLabel,
    };
  } catch {
    return null;
  }
}

function refreshOperationalPages() {
  revalidatePath("/");
  revalidatePath("/in-transit");
  revalidatePath("/returns");
  revalidatePath("/undelivered");
}

export async function previewDeliveryWorkbookAction(
  _previousState: DeliveryPreviewState,
  formData: FormData,
): Promise<DeliveryPreviewState> {
  const file = formData.get("workbook");
  if (!(file instanceof File)) {
    return {
      status: "error",
      fileName: "",
      totalRows: 0,
      matches: [],
      ambiguous: [],
      unmatched: [],
      error: "Odaberite Excel dokument.",
    };
  }

  try {
    const [courierRows, activeOrders] = await Promise.all([
      parseCourierDeliveryWorkbook(file),
      getActiveOrdersSheetRows(),
    ]);
    const result = matchCourierDeliveries(courierRows, activeOrders);
    return {
      status: "ready",
      fileName: file.name,
      totalRows: courierRows.length,
      matches: result.matches,
      ambiguous: result.ambiguous.map((entry) => ({
        recipient: entry.source.recipient,
        candidates: entry.candidates,
      })),
      unmatched: result.unmatched.map((entry) => entry.recipient),
      error: "",
    };
  } catch (error) {
    console.error("Delivery workbook preview failed", error);
    return {
      status: "error",
      fileName: file.name,
      totalRows: 0,
      matches: [],
      ambiguous: [],
      unmatched: [],
      error: error instanceof Error ? error.message : "Dokument nije moguće obraditi.",
    };
  }
}

export async function applyDeliveredMatchesAction(formData: FormData) {
  const references = formData
    .getAll("matches")
    .slice(0, 500)
    .map(parseReference)
    .filter((reference): reference is OrderMoveReference => reference !== null);
  if (references.length === 0) redirect("/in-transit?error=no-delivery-selection");

  let result: Awaited<ReturnType<typeof markOrdersDelivered>>;
  try {
    result = await markOrdersDelivered(references);
  } catch (error) {
    console.error("Marking delivered orders failed", error);
    redirect("/in-transit?error=delivery-update-failed");
  }
  refreshOperationalPages();
  redirect(`/in-transit?delivered=${result.moved}&skipped=${result.skipped}`);
}

export async function moveOrderToReturnsAction(formData: FormData) {
  const returnTo = formData.get("returnTo") === "/returns" ? "/returns" : "/in-transit";
  const reference = parseReference(formData.get("order") ?? "");
  if (!reference) redirect(`${returnTo}?error=invalid-order-selection`);

  let result: Awaited<ReturnType<typeof moveOrderToReturns>>;
  try {
    result = await moveOrderToReturns(reference);
  } catch (error) {
    console.error("Moving order to returns failed", error);
    redirect(`${returnTo}?error=return-update-failed`);
  }
  refreshOperationalPages();
  redirect(`${returnTo}?returned=${result.moved}&skipped=${result.skipped}`);
}

export async function restoreReturnToTransitAction(formData: FormData) {
  const reference = parseReference(formData.get("order") ?? "");
  if (!reference) redirect("/returns?error=invalid-return-selection");

  let result: Awaited<ReturnType<typeof restoreReturnToTransit>>;
  try {
    result = await restoreReturnToTransit(reference);
  } catch (error) {
    console.error("Restoring return to in-transit failed", error);
    redirect("/returns?error=restore-update-failed");
  }
  refreshOperationalPages();
  redirect(`/returns?restored=${result.restored}&skipped=${result.skipped}`);
}
