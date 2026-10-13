"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listAssets, getDashboardMetrics } from "@/lib/assets";
import { listSoftware, type Software } from "@/lib/software";
import {
  ASSET_STATUSES,
  assetStatusLabel,
  assetStatusStyle,
  formatDate,
  type Asset,
  type DashboardMetrics, assetLabel } from "@/types/asset";

const PAGE_SIZE = 25;

/** Asset register. "all" lists hardware devices and software titles together; "hardware" lists devices only. */
export function AssetList({ mode }: { mode: "all" | "hardware" }) {
  const [software, setSoftware] = useState<Software[] | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Debounce typing so each keystroke does not fire a request.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query);
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listAssets({
      search: search || undefined,
      status: status === "all" ? undefined : status,
      skip: page * PAGE_SIZE,
      limit: PAGE_SIZE,
    })
      .then((data) => {
        if (cancelled) return;
        setAssets(data);
        setError("");
      })
      .catch((caught) => {
        if (cancelled) return;
        setAssets([]);
        setError(caught instanceof Error ? caught.message : "Unable to load assets.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [search, status, page]);

  useEffect(() => {
    let cancelled = false;
    if (mode === "all") listSoftware().then((data) => !cancelled && setSoftware(data)).catch(() => undefined);
    getDashboardMetrics()
      .then((data) => {
        if (!cancelled) setMetrics(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [mode]);

  const tiles: [string, string, string][] = [
    mode === "all"
      ? [metrics && software ? String(metrics.total_assets + software.length) : "—", "Total assets", "Hardware devices and software titles"]
      : [metrics ? String(metrics.total_assets) : "—", "Hardware devices", "Across your organization"],
    [metrics ? String(metrics.assigned_assets) : "—", "Assigned", "Currently with a user"],
    [metrics ? String(metrics.in_stock_assets) : "—", "In stock", "Ready for deployment"],
    [metrics ? String(metrics.under_maintenance) : "—", "Under maintenance", "Currently in repair"],
  ];

  return (
    <main className="mx-auto max-w-7xl space-y-8">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-medium text-brand-600">Assets</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">{mode === "all" ? "All Assets" : "Hardware Assets"}</h1>
          <p className="mt-2 text-slate-500">
            {mode === "all"
              ? "Every hardware device and software title your organization owns."
              : "One record per device: ownership, location, condition and lifecycle status."}
          </p>
          <nav aria-label="Asset tools" className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
            {[
              ["/assets/status", "Status"],
              ["/assets/lifecycle", "Lifecycle"],
              ["/assets/history", "History"],
              ["/assets/audit", "Physical audit"],
              ["/maintenance?tab=warranty", "Warranty / AMC"],
            ].map(([href, text]) => (
              <Link key={href} href={href} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-600 hover:border-brand-200 hover:text-brand-700">
                {text}
              </Link>
            ))}
          </nav>
        </div>
        <Link
          href="/assets/new"
          className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700"
        >
          + Add new asset
        </Link>
      </header>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800"
        >
          {error}
        </div>
      )}

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map(([value, label, hint]) => (
          <article key={label} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-2xl font-bold tracking-tight text-slate-950">{value}</p>
            <p className="mt-1 text-sm font-medium text-slate-700">{label}</p>
            <p className="mt-2 text-xs text-slate-500">{hint}</p>
          </article>
        ))}
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-100 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-semibold text-slate-900">{mode === "all" ? "Hardware" : "Asset inventory"}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {loading ? "Loading…" : `${assets.length} shown on this page`}
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="relative">
              <span className="sr-only">Search assets</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search name, tag, or serial"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 sm:w-64"
              />
            </label>
            <label>
              <span className="sr-only">Filter by status</span>
              <select
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(0);
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 outline-none focus:border-brand-500 sm:w-40"
              >
                <option value="all">All status</option>
                {ASSET_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {assetStatusLabel(value)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[880px] w-full text-left">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-6 py-3 font-semibold">Asset</th>
                <th className="px-6 py-3 font-semibold">Category</th>
                <th className="px-6 py-3 font-semibold">Assigned to</th>
                <th className="px-6 py-3 font-semibold">Serial</th>
                <th className="px-6 py-3 font-semibold">Status</th>
                <th className="px-6 py-3 font-semibold">Updated</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {assets.map((asset) => (
                <tr key={asset.id} className="transition hover:bg-slate-50">
                  <td className="px-6 py-4">
                    <p className="font-semibold text-slate-800">{asset.name}</p>
                    <p className="mt-0.5 text-sm text-slate-500">
                      {assetLabel(asset)}
                      {asset.model ? ` · ${asset.model}` : ""}
                    </p>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-700">{asset.category}</td>
                  <td className="px-6 py-4 text-sm">
                    {asset.assigned_to_name ? (
                      <>
                        <p className="font-medium text-slate-700">{asset.assigned_to_name}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{asset.assigned_to_email}</p>
                      </>
                    ) : (
                      <span className="text-slate-400">Unassigned</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">{asset.serial_number}</td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${assetStatusStyle(asset.status)}`}
                    >
                      {assetStatusLabel(asset.status)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-500">{formatDate(asset.updated_at)}</td>
                  <td className="px-6 py-4 text-right">
                    <Link
                      href={`/assets/${asset.id}`}
                      className="text-sm font-semibold text-brand-600 hover:text-brand-700"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!loading && assets.length === 0 && !error && (
          <div className="p-10 text-center text-sm text-slate-500">
            {search || status !== "all"
              ? "No assets match your search."
              : "No assets yet. Register your first one to get started."}
          </div>
        )}

        <footer className="flex items-center justify-between border-t border-slate-100 px-6 py-4 text-sm text-slate-500">
          <span>Page {page + 1}</span>
          <div className="space-x-2">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              disabled={page === 0 || loading}
              className="rounded-md border border-slate-200 px-3 py-1.5 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage((current) => current + 1)}
              disabled={assets.length < PAGE_SIZE || loading}
              className="rounded-md border border-slate-200 px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </footer>
      </section>

      {mode === "all" && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 p-5">
            <div>
              <h2 className="font-semibold text-slate-900">Software</h2>
              <p className="mt-1 text-sm text-slate-500">{software ? `${software.length} titles` : "Loading…"}</p>
            </div>
            <Link href="/assets/software" className="text-sm font-semibold text-brand-600 hover:text-brand-700">
              Manage software
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[720px] w-full text-left">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-semibold">Software</th>
                  <th className="px-6 py-3 font-semibold">Publisher</th>
                  <th className="px-6 py-3 font-semibold">Seats used</th>
                  <th className="px-6 py-3 font-semibold">Expiry</th>
                  <th className="px-6 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(software ?? []).map((item) => (
                  <tr key={item.id} className="transition hover:bg-slate-50">
                    <td className="px-6 py-4">
                      <p className="font-semibold text-slate-800">{item.name}</p>
                      {item.version && <p className="mt-0.5 text-sm text-slate-500">Version {item.version}</p>}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-700">{item.vendor ?? "—"}</td>
                    <td className="px-6 py-4 text-sm text-slate-700">{item.used_licenses} / {item.total_licenses}</td>
                    <td className="px-6 py-4 text-sm text-slate-500">{formatDate(item.expiry_date)}</td>
                    <td className="px-6 py-4 text-sm text-slate-700">{item.status.replace(/_/g, " ").toLowerCase()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {software && software.length === 0 && (
            <div className="p-10 text-center text-sm text-slate-500">No software yet. Use Add new asset and choose Software license.</div>
          )}
        </section>
      )}
    </main>
  );
}
