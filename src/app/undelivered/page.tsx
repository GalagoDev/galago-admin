import { redirect } from "next/navigation";

export default async function UndeliveredPage() {
  redirect("/in-transit");
}
