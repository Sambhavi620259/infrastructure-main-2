"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { listAssets } from "@/lib/assets";
import type { Asset } from "@/types/asset";

type CategoryRow = {
  category: string;
  total: number;
  inStock: number;
  assigned: number;
  repair: number;
  retired: number;
  value: number;
};

// One page of the asset list; enough for a breakdown in most organizations.
const LIMIT = 500;

export default function HardwareInventoryPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    listAssets({ limit: LIMIT })
      .then(setAssets)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load hardware."))
      .finally(() => setLoading(false));
  }, []);

  const rows = useMemo(() => {
    const byCategory = new Map<string, CategoryRow>();
    for (const asset of assets) {
      const key = asset.category || "Uncategorised";
      const row = byCategory.get(key) ?? { category: key, total: 0, inStock: 0, assigned: 0, repair: 0, retired: 0, value: 0 };
      row.total += 1;
      if (asset.status === "IN_STOCK") row.inStock += 1;
      if (asset.status === "ASSIGNED" || asset.status === "IN_USE") row.assigned += 1;
      if (asset.status === "IN_REPAIR" || asset.status === "DAMAGED") row.repair += 1;
      if (asset.status === "RETIRED" || asset.status === "DISPOSED") row.retired += 1;
      row.value += Number(asset.purchase_price) || 0;
      byCategory.set(key, row);
    }
    return [...byCategory.values()].sort((a, b) => b.total - a.total);
  }, [assets]);

  const totals = rows.reduce(
    (sum, row) => ({ total: sum.total + row.total, inStock: sum.inStock + row.inStock, value: sum.value + row.value }),
    { total: 0, inStock: 0, value: 0 },
  );

  return (
    <main className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-brand-600">Inventory · Hardware</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">Hardware Inventory</h1>
          <p className="mt-1 text-sm text-slate-500">Your hardware by category: how much is free, in use, or out of service.</p>
        </div>
        <Link
          href="/assets/new"
          className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700"
        >
          Register asset
        </Link>
      </header>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {[
          ["Hardware assets", totals.total.toLocaleString()],
          ["Free to deploy", totals.inStock.toLocaleString()],
          ["Purchase value", totals.value.toLocaleString(undefined, { maximumFractionDigits: 0 })],
        ].map(([label, value]) => (
          <article key={label} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-2xl font-bold text-slate-950">{loading ? "—" : value}</p>
            <p className="mt-1 text-sm text-slate-600">{label}</p>
          </article>
        ))}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-[760px] w-full text-left">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600">
              <tr>
                {["Category", "Total", "In stock", "Assigned", "Repair / damaged", "Retired", "Value"].map((heading) => (
                  <th key={heading} className="px-5 py-3">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.category} className="text-sm hover:bg-slate-50">
                  <td className="px-5 py-3 font-semibold text-slate-800">{row.category}</td>
                  <td className="px-5 py-3 font-semibold text-slate-800">{row.total}</td>
                  <td className={`px-5 py-3 ${row.inStock === 0 ? "font-semibold text-rose-600" : "text-slate-600"}`}>{row.inStock}</td>
                  <td className="px-5 py-3 text-slate-600">{row.assigned}</td>
                  <td className="px-5 py-3 text-slate-600">{row.repair}</td>
                  <td className="px-5 py-3 text-slate-600">{row.retired}</td>
                  <td className="px-5 py-3 text-slate-600">{row.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && rows.length === 0 && !error && (
          <p className="p-10 text-center text-sm text-slate-500">No hardware registered yet.</p>
        )}
        {assets.length === LIMIT && (
          <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
            Showing the first {LIMIT} assets. Use Reports → Asset inventory for a complete export.
          </p>
        )}
      </section>
    </main>
  );
}
