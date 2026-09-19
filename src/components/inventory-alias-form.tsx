"use client";

import { useFormStatus } from "react-dom";

import { saveInventoryAliasAction } from "@/app/actions/statistics";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-10 rounded-lg border border-sky-300/20 bg-sky-300/10 px-3 py-2 text-xs font-semibold text-sky-100 transition hover:bg-sky-300/15 disabled:cursor-wait disabled:opacity-60"
    >
      {pending ? "Čuvam..." : "Poveži"}
    </button>
  );
}

export function InventoryAliasForm({
  alias,
  date,
  products,
}: {
  alias: string;
  date: string;
  products: Array<{ id: number; name: string }>;
}) {
  return (
    <form action={saveInventoryAliasAction} className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="alias" value={alias} />
      <select
        name="productId"
        required
        defaultValue=""
        className="min-h-10 min-w-0 rounded-lg border border-white/10 bg-[#09090b] px-3 py-2 text-xs text-white outline-none focus:border-sky-300/35"
      >
        <option value="" disabled>Odaberi artikal iz lagera</option>
        {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
      </select>
      <SaveButton />
    </form>
  );
}
