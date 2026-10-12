"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createInventory, type InventoryCreateInput } from "@/lib/inventory";

export default function NewInventoryPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? "").trim();
    const number = (key: string) => Number(form.get(key) ?? 0);

    setError("");
    setSubmitting(true);
    try {
      const input: InventoryCreateInput = {
        name: text("name"),
        category: text("category"),
        quantity: number("quantity"),
        reorder_level: number("reorder_level"),
        unit_cost: Number(text("unit_cost")) || undefined,
        location: text("location") || undefined,
      };
      await createInventory(input);
      setSuccess(true);
      setTimeout(() => router.push("/inventory"), 1500);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create inventory item.");
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto max-w-4xl space-y-5">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-wider text-brand-600">Inventory · Add Item</p>
        <h1 className="mt-1 text-2xl font-extrabold">Add Inventory Item</h1>
        <p className="mt-1 text-sm text-slate-500">Add a new item to the inventory catalog.</p>
      </header>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
          {error}
        </div>
      )}

      {success && (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
          Item added successfully. Redirecting…
        </div>
      )}

      <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" noValidate>
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="text-xs font-bold text-slate-700">
            Item Name <span className="text-rose-500">*</span>
            <input
              required
              name="name"
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
              placeholder="e.g. MacBook Air M2"
            />
          </label>

          <label className="text-xs font-bold text-slate-700">
            Category <span className="text-rose-500">*</span>
            <input
              required
              name="category"
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
              placeholder="e.g. Laptop"
            />
          </label>

          <label className="text-xs font-bold text-slate-700">
            Quantity <span className="text-rose-500">*</span>
            <input
              required
              type="number"
              name="quantity"
              min="0"
              defaultValue="0"
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
            />
          </label>

          <label className="text-xs font-bold text-slate-700">
            Reorder Level <span className="text-rose-500">*</span>
            <input
              required
              type="number"
              name="reorder_level"
              min="0"
              defaultValue="5"
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
            />
          </label>

          <label className="text-xs font-bold text-slate-700">
            Unit Cost
            <input
              type="number"
              name="unit_cost"
              min="0"
              step="0.01"
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
              placeholder="e.g. 999.99"
            />
          </label>

          <label className="text-xs font-bold text-slate-700">
            Location
            <input
              name="location"
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
              placeholder="e.g. Bengaluru Store"
            />
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <Link
            href="/inventory"
            className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </Link>
          <button type="submit" disabled={submitting} className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60">
            {submitting ? "Adding…" : "Add Item"}
          </button>
        </div>
      </form>
    </main>
  );
}