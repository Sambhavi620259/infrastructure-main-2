"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createAsset } from "@/lib/assets";

export default function NewAssetPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? "").trim();

    setError("");
    setSubmitting(true);
    try {
      const created = await createAsset({
        name: text("name"),
        asset_tag: text("asset_tag"),
        serial_number: text("serial_number"),
        category: text("category"),
        type: text("type") || undefined,
        brand: text("brand") || undefined,
        model: text("model") || undefined,
        description: text("description") || undefined,
      });
      router.push(`/assets/${created.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to register this asset.");
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto max-w-6xl space-y-5">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-wider text-brand-600">
          Assets \u00b7 Register
        </p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">Add a new asset</h1>
        <p className="mt-1 text-sm text-slate-500">
          Register a new hardware or software asset in the system.
        </p>
      </header>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800"
        >
          {error}
        </div>
      )}

      <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-lg font-extrabold">Asset information</h2>
          <p className="mt-1 text-xs text-slate-500">
            Complete the required fields to create the asset record.
          </p>
        </div>

        <div className="grid gap-5 p-5 md:grid-cols-2">
          <label className="text-xs font-bold text-slate-700">
            Asset name <span className="text-rose-500">*</span>
            <input
              required
              name="name"
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
              placeholder="e.g. MacBook Pro 16"
            />
          </label>

          <label className="text-xs font-bold text-slate-700">
            Model
            <input
              name="model"
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
              placeholder="e.g. Apple M3 Pro"
            />
          </label>

          <label className="text-xs font-bold text-slate-700">
            Brand / manufacturer
            <input
              name="brand"
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
              placeholder="e.g. Apple"
            />
          </label>

          <label className="text-xs font-bold text-slate-700">
            Serial number <span className="text-rose-500">*</span>
            <input
              required
              name="serial_number"
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
              placeholder="Manufacturer serial number"
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
            Asset tag / ID <span className="text-rose-500">*</span>
            <input
              required
              name="asset_tag"
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
              placeholder="e.g. AST-10483"
            />
          </label>

          <label className="text-xs font-bold text-slate-700">
            Asset type
            <select
              name="type"
              defaultValue=""
              className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-500"
            >
              <option value="">Select type</option>
              <option>Hardware</option>
              <option>Software</option>
              <option>Accessory</option>
            </select>
          </label>

          <label className="text-xs font-bold text-slate-700 md:col-span-2">
            Description
            <textarea
              name="description"
              rows={4}
              className="mt-1.5 w-full resize-y rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
              placeholder="Add notes about this asset"
            />
          </label>
        </div>

        <div className="flex flex-wrap justify-end gap-3 border-t border-slate-100 px-5 py-4">
          <Link
            href="/assets"
            className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Registering\u2026" : "Register asset"}
          </button>
        </div>
      </form>
    </main>
  );
}
