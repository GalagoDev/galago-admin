"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  CLAIM_STATUSES,
  type ClaimStatus,
  updateCustomerReturnClaimStatus,
} from "@/lib/reklamacije";

export async function updateReklamacijaStatusAction(formData: FormData) {
  const id = String(formData.get("claimId") || "");
  const status = String(formData.get("status") || "") as ClaimStatus;

  if (!/^[a-zA-Z0-9-]{1,100}$/.test(id) || !CLAIM_STATUSES.includes(status)) {
    redirect("/reklamacije?error=invalid-status");
  }

  const updated = updateCustomerReturnClaimStatus(id, status);
  revalidatePath("/reklamacije");
  redirect(updated ? `/reklamacije?updated=${encodeURIComponent(id)}` : "/reklamacije?error=not-found");
}
