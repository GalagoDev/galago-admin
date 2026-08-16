"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  ContainerTrackingError,
  createTrackedContainer,
  deleteTrackedContainer,
  isContainerTrackingConfigured,
  refreshDueContainers,
  refreshTrackedContainer,
} from "@/lib/containers";

function parseContainerId(value: FormDataEntryValue | null) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function containerErrorCode(error: unknown) {
  if (error instanceof ContainerTrackingError) return error.code;
  return "action-failed";
}

export async function addContainerAction(formData: FormData) {
  const containerNumber = String(formData.get("containerNumber") || "");
  let destination = "/containers";

  try {
    const result = await createTrackedContainer(containerNumber);
    revalidatePath("/containers");
    const params = new URLSearchParams({
      number: result.container.containerNumber,
      [result.created ? "added" : "duplicate"]: "1",
    });
    if (result.refresh && !result.refresh.ok && result.refresh.error !== "not-configured") {
      params.set("tracking", "pending");
    }
    destination = `/containers?${params.toString()}`;
  } catch (error) {
    console.error("Container creation failed", error);
    destination = `/containers?error=${containerErrorCode(error)}`;
  }
  redirect(destination);
}

export async function refreshContainerAction(formData: FormData) {
  const id = parseContainerId(formData.get("containerId"));
  if (!id) redirect("/containers?error=not-found");
  let destination = "/containers";

  try {
    const result = await refreshTrackedContainer(id);
    revalidatePath("/containers");
    destination = result.ok ? "/containers?refreshed=1" : `/containers?error=${result.error}`;
  } catch (error) {
    console.error("Container refresh failed", error);
    destination = `/containers?error=${containerErrorCode(error)}`;
  }
  redirect(destination);
}

export async function refreshAllContainersAction() {
  if (!isContainerTrackingConfigured()) redirect("/containers?error=not-configured");
  let destination = "/containers";

  try {
    const result = await refreshDueContainers({ force: true, limit: 50 });
    revalidatePath("/containers");
    destination = `/containers?checked=${result.checked}&updated=${result.updated}&failed=${result.failed}`;
  } catch (error) {
    console.error("Container bulk refresh failed", error);
    destination = "/containers?error=tracking-failed";
  }
  redirect(destination);
}

export async function deleteContainerAction(formData: FormData) {
  const id = parseContainerId(formData.get("containerId"));
  if (!id) redirect("/containers?error=not-found");
  let destination = "/containers";

  try {
    deleteTrackedContainer(id);
    revalidatePath("/containers");
    destination = "/containers?removed=1";
  } catch (error) {
    console.error("Container deletion failed", error);
    destination = `/containers?error=${containerErrorCode(error)}`;
  }
  redirect(destination);
}
