"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  CLAIM_STATUSES,
  deleteCustomerReturnClaim,
  type ClaimStatus,
  updateCustomerReturnClaimStatus,
} from "@/lib/reklamacije";

function isValidClaimId(value: string) {
  return /^[a-zA-Z0-9-]{1,100}$/.test(value);
}

export async function updateReklamacijaStatusAction(formData: FormData) {
  const id = String(formData.get("claimId") || "");
  const status = String(formData.get("status") || "") as ClaimStatus;

  if (!isValidClaimId(id) || !CLAIM_STATUSES.includes(status)) {
    redirect("/reklamacije?error=invalid-status");
  }

  const updated = updateCustomerReturnClaimStatus(id, status);
  revalidatePath("/reklamacije");
  redirect(updated ? `/reklamacije?updated=${encodeURIComponent(id)}` : "/reklamacije?error=not-found");
}

export async function deleteReklamacijaAction(formData: FormData) {
  const id = String(formData.get("claimId") || "");
  if (!isValidClaimId(id)) redirect("/reklamacije?error=invalid-claim");

  const deleted = deleteCustomerReturnClaim(id);
  revalidatePath("/reklamacije");
  revalidatePath("/", "layout");
  redirect(deleted ? "/reklamacije?deleted=1" : "/reklamacije?error=not-found");
}
