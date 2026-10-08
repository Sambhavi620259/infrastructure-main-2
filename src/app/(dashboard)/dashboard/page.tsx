"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CubeIcon,
  CheckCircleIcon,
  WrenchScrewdriverIcon,
  ComputerDesktopIcon,
  DevicePhoneMobileIcon,
  PrinterIcon,
} from "@heroicons/react/24/outline";
import { listAssets, getDashboardMetrics } from "@/lib/assets";
import { assetStatusLabel, assetStatusStyle, type Asset, type DashboardMetrics } from "@/types/asset";

const categoryIcon: Record<string, typeof CubeIcon> = {
  Laptop: ComputerDesktopIcon,
  Desktop: ComputerDesktopIcon,
  Monitor: ComputerDesktopIcon,
  Mobile: DevicePhoneMobileIcon,
  Printer: PrinterIcon,
};

const RECENT_LIMIT = 10;

export default function DashboardPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setSearch(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listAssets({ search: search || undefined, limit: RECENT_LIMIT })
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
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    getDashboardMetrics()
      .then((data) => {
        if (!cancelled) setMetrics(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const tiles: [string, string, typeof CubeIcon, string][] = [
    [
      "Total assets",
      metrics ? String(metrics.total_assets) : "\u2014",
      CubeIcon,
      "text-brand-600 bg-blue-50",
    ],
    [
      "Assigned",
      metrics ? String(metrics.assigned_assets) : "\u2014",
      CheckCircleIcon,
      "text-emerald-600 bg-emerald-50",
    ],
    [
      "Under maintenance",
      metrics ? String(metrics.under_maintenance) : "\u2014",
      WrenchScrewdriverIcon,
      "text-amber-600 bg-amber-50",
    ],
  ];

  return (
    <main className="mx-auto max-w-[1440px] space-y-5">
      <header className="flex flex-col gap-3 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-600">
            IT Admin \u00b7 Asset management
          </p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-slate-950">All Assets</h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage and track all your organization assets in one place.
          </p>
        </div>
        <Link
          href="/assets/new"
          className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700"
        >
          Add new asset
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

      <section className="grid overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:grid-cols-3">
        {tiles.map(([label, value, Icon, style]) => (
          <article
            key={label}
            className="flex items-center gap-4 border-b border-slate-200 px-5 py-5 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"
          >
            <span className={`grid h-11 w-11 place-items-center rounded-full ${style}`}>
              <Icon className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs font-semibold text-slate-500">{label}</p>
              <p className="mt-0.5 text-2xl font-extrabold text-slate-950">{value}</p>
            </div>
          </article>
        ))}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-extrabold text-slate-950">Assets List</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {loading ? "Loading\u2026" : `Showing the ${assets.length} most recent`}
            </p>
          </div>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search assets"
            placeholder="Search by name, tag or serial"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-brand-500 sm:w-72"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[760px] w-full text-left">
            <thead className="bg-blue-50/70 text-[11px] font-bold text-slate-600">
              <tr>
                {["", "Asset tag", "Asset name", "Category", "Assigned to", "Status"].map(
                  (heading, index) => (
                    <th key={heading || `icon-${index}`} className="px-5 py-3">
                      {heading}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {assets.map((asset) => {
                const Icon = categoryIcon[asset.category] ?? CubeIcon;
                return (
                  <tr key={asset.id} className="text-sm hover:bg-slate-50">
                    <td className="px-5 py-3 text-slate-500">
                      <Icon className="h-4 w-4" />
                    </td>
                    <td className="px-5 py-3 font-bold text-slate-700">
                      <Link href={`/assets/${asset.id}`} className="hover:text-brand-600">
                        {asset.asset_tag}
                      </Link>
                    </td>
                    <td className="px-5 py-3 font-semibold text-slate-900">{asset.name}</td>
                    <td className="px-5 py-3 text-slate-600">{asset.category}</td>
                    <td className="px-5 py-3 text-slate-600">
                      {asset.assigned_to_name ?? <span className="text-slate-400">Unassigned</span>}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${assetStatusStyle(asset.status)}`}
                      >
                        {assetStatusLabel(asset.status)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!loading && assets.length === 0 && !error && (
          <p className="p-10 text-center text-sm text-slate-500">
            {search ? "No assets match your search." : "No assets yet."}
          </p>
        )}

        <footer className="border-t border-slate-200 px-5 py-4 text-sm text-slate-500">
          <Link href="/assets" className="font-bold text-brand-600 hover:text-brand-700">
            View all assets \u2192
          </Link>
        </footer>
      </section>
    </main>
  );
}
