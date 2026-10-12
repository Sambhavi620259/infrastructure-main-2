"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PlusIcon, ArrowPathIcon } from "@heroicons/react/24/outline";
import { listInventory, getInventoryCounts, type InventoryItem } from "@/lib/inventory";

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [counts, setCounts] = useState<{ total: number; low_stock: number } | null>(null);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    Promise.all([
      listInventory({ limit: 200 }),
      getInventoryCounts(),
    ])
      .then(([itemsData, countsData]) => {
        setItems(itemsData);
        setCounts(countsData);
        setError("");
      })
      .catch((caught) => {
        setItems([]);
        setCounts(null);
        setError(caught instanceof Error ? caught.message : "Unable to load inventory.");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const categories = useMemo(() => [...new Set(items.map((i) => i.category).filter(Boolean))], [items]);

  const visibleItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      const matchesCategory = categoryFilter === "all" || item.category === categoryFilter;
      const haystack = `${item.name} ${item.category} ${item.location ?? ""}`.toLowerCase();
      return matchesCategory && haystack.includes(needle);
    });
  }, [items, query, categoryFilter]);

  const statusBadge = (status: string) => {
    const classes: Record<string, string> = {
      IN_STOCK: "bg-emerald-50 text-emerald-700",
      LOW_STOCK: "bg-amber-50 text-amber-700",
      OUT_OF_STOCK: "bg-red-50 text-red-700",
      RESERVED: "bg-blue-50 text-blue-700",
    };
    return classes[status] ?? "bg-slate-50 text-slate-700";
  };

  return (
    <main className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-brand-600">IT Admin · Inventory</p>
          <h1 className="mt-1 text-2xl font-extrabold">Inventory</h1>
          <p className="mt-1 text-sm text-slate-500">Review stock availability and procurement readiness.</p>
        </div>
        <Link
          href="/inventory/new"
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700"
        >
          <PlusIcon className="h-4 w-4" /> Add item
        </Link>
      </header>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {counts && (
        <div className="grid gap-4 sm:grid-cols-3">
          <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold text-slate-500">Total Items</p>
            <p className="mt-1 text-2xl font-extrabold text-slate-900">{counts.total}</p>
          </article>
          <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold text-slate-500">Low Stock</p>
            <p className="mt-1 text-2xl font-extrabold text-amber-600">{counts.low_stock}</p>
          </article>
          <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold text-slate-500">Categories</p>
            <p className="mt-1 text-2xl font-extrabold text-brand-600">{categories.length}</p>
          </article>
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-extrabold text-slate-900">Stock Items</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {loading ? "Loading…" : `${visibleItems.length} of ${items.length} loaded`}
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search inventory"
              placeholder="Search name or category"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-brand-500 sm:w-60"
            />
            <select
              aria-label="Filter by category"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 outline-none focus:border-brand-500"
            >
              <option value="all">All categories</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            <button
              onClick={load}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <ArrowPathIcon className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[760px] w-full text-left">
            <thead className="bg-blue-50/70 text-[11px] font-bold text-slate-600">
              <tr>
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3">Category</th>
                <th className="px-5 py-3">Qty</th>
                <th className="px-5 py-3">Reorder</th>
                <th className="px-5 py-3">Location</th>
                <th className="px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleItems.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-500">
                    {loading ? "Loading inventory…" : "No inventory items found."}
                  </td>
                </tr>
              ) : (
                visibleItems.map((item) => (
                  <tr key={item.id} className="text-sm hover:bg-slate-50">
                    <td className="px-5 py-3 font-medium text-slate-900">{item.name}</td>
                    <td className="px-5 py-3 text-slate-600">{item.category}</td>
                    <td className="px-5 py-3 font-mono text-slate-700">{item.quantity}</td>
                    <td className="px-5 py-3 font-mono text-slate-500">{item.reorder_level}</td>
                    <td className="px-5 py-3 text-slate-600">{item.location ?? "—"}</td>
                    <td className="px-5 py-3">
                      <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${statusBadge(item.status)}`}>
                        {item.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}