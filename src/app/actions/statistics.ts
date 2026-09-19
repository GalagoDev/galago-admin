"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { importInventoryFile, InventoryError, saveInventoryAlias } from "@/lib/inventory";
import { normalizeStatisticsDate, sarajevoDateKey } from "@/lib/daily-statistics";

function returnDate(formData: FormData) {
  return normalizeStatisticsDate(formData.get("date")) || sarajevoDateKey();
}

export async function uploadInventoryAction(formData: FormData) {
  const date = returnDate(formData);
  const file = formData.get("inventory");
  if (!(file instanceof File)) redirect(`/stats/today?date=${date}&error=file-missing`);

  try {
    const result = await importInventoryFile(file);
    revalidatePath("/stats/today");
    redirect(`/stats/today?date=${date}&inventory=${result.imported ? "added" : "duplicate"}&count=${result.itemCount}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    console.error("Inventory import failed", error);
    const code = error instanceof InventoryError ? error.code : "upload-failed";
    redirect(`/stats/today?date=${date}&error=${encodeURIComponent(code)}`);
  }
}

export async function saveInventoryAliasAction(formData: FormData) {
  const date = returnDate(formData);
  const alias = String(formData.get("alias") || "");
  const productId = Number(formData.get("productId"));
  if (!alias.trim() || !Number.isInteger(productId) || productId <= 0) {
    redirect(`/stats/today?date=${date}&error=alias-invalid`);
  }

  try {
    saveInventoryAlias(alias, productId);
    revalidatePath("/stats/today");
    redirect(`/stats/today?date=${date}&alias=saved`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    console.error("Inventory alias save failed", error);
    const code = error instanceof InventoryError ? error.code : "alias-failed";
    redirect(`/stats/today?date=${date}&error=${encodeURIComponent(code)}`);
  }
}
