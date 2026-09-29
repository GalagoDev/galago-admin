"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAuth } from "@/lib/auth";
import { syncInventoryFromShopify } from "@/lib/inventory-shopify-sync";

export async function syncInventoryFromShopifyAction() {
  if (!(await requireAuth())) redirect("/login");

  let result;
  try {
    result = await syncInventoryFromShopify();
  } catch (error) {
    console.error("Manual Shopify Lager sync failed", error);
    revalidatePath("/inventory");
    redirect("/inventory?sync=error");
  }

  revalidatePath("/");
  revalidatePath("/inventory");
  revalidatePath("/stats/today");
  redirect(
    `/inventory?sync=success&matched=${result.matchedProducts}&catalog=${result.catalogProducts}&unmatched=${result.unmatchedVariants}`,
  );
}
