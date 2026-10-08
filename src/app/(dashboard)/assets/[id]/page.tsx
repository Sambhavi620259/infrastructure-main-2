"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getAsset, listAssetLifecycle } from "@/lib/assets";
import {
  assetStatusLabel,
  assetStatusStyle,
  formatDate,
  type Asset,
  type AssetLifecycleEntry,
} from "@/types/asset";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function AssetDetailPage() {
  const params = useParams<{ id: string }>();
  const assetId = typeof params.id === "string" ? params.id : "";

  const [asset, setAsset] = useState<Asset | null>(null);
  const [lifecycle, setLifecycle] = useState<AssetLifecycleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!assetId) return;
    let cancelled = false;
    setLoading(true);

    getAsset(assetId)
      .then((data) => {
        if (!cancelled) {
          setAsset(data);
          setError("");
        }
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load this asset.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    listAssetLifecycle(assetId)
      .then((data) => {
        if (!cancelled) setLifecycle(data);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [assetId]);

  if (loading) {
    return (
      <main className="mx-auto max-w-7xl">
        <p className="text-sm text-slate-500">Loading asset\u2026</p>
      </main>
    );
  }

  if (error || !asset) {
    return (
      <main className="mx-auto max-w-7xl space-y-4">
        <Link href="/assets" className="inline-flex text-sm font-semibold text-brand-600 hover:text-brand-700">
          \u2190 Back to assets
        </Link>
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800">
          {error || "Asset not found."}
        </div>
      </main>
    );
  }

  const details: [string, string][] = [
    ["Category", asset.category],
    ["Type", asset.type ?? "\u2014"],
    ["Manufacturer", asset.brand ?? "\u2014"],
    ["Model", asset.model ?? "\u2014"],
    ["Serial number", asset.serial_number],
    ["Condition", asset.condition],
    ["Purchase date", formatDate(asset.purchase_date)],
    ["Purchase cost", String(asset.purchase_price ?? "\u2014")],
    ["Warranty expires", formatDate(asset.warranty_end)],
    ["Registered", formatDate(asset.created_at)],
  ];

  return (
    <main className="mx-auto max-w-7xl space-y-8">
      <Link href="/assets" className="inline-flex text-sm font-semibold text-brand-600 hover:text-brand-700">
        \u2190 Back to assets
      </Link>

      <header className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm lg:flex-row lg:items-start">
        <div className="flex gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-brand-50 text-xl font-bold text-brand-700">
            {initials(asset.name)}
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-slate-950">{asset.name}</h1>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${assetStatusStyle(asset.status)}`}
              >
                {assetStatusLabel(asset.status)}
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-500">
              Asset tag: <span className="font-semibold text-slate-700">{asset.asset_tag}</span>
              {asset.model ? ` \u00b7 ${asset.model}` : ""}
            </p>
          </div>
        </div>
      </header>

      <section className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-slate-900">Asset details</h2>
          <dl className="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-2">
            {details.map(([label, value]) => (
              <div key={label}>
                <dt className="text-sm text-slate-500">{label}</dt>
                <dd className="mt-1 text-sm font-semibold text-slate-800">{value}</dd>
              </div>
            ))}
          </dl>
          {asset.description && (
            <div className="mt-6 border-t border-slate-100 pt-5">
              <p className="text-sm text-slate-500">Description</p>
              <p className="mt-1 text-sm text-slate-800">{asset.description}</p>
            </div>
          )}
        </article>

        <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-slate-900">Lifecycle history</h2>
          {lifecycle.length === 0 ? (
            <p className="mt-6 text-sm text-slate-500">No lifecycle events recorded for this asset yet.</p>
          ) : (
            <div className="mt-6 space-y-6 border-l border-slate-200 pl-5">
              {lifecycle.map((entry) => (
                <div key={entry.id} className="relative">
                  <span className="absolute -left-[1.65rem] top-1.5 h-3 w-3 rounded-full border-2 border-white bg-brand-500" />
                  <p className="text-xs font-semibold text-slate-400">{formatDate(entry.timestamp)}</p>
                  <p className="mt-1 font-semibold text-slate-800">{entry.action}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {entry.previous_status ? `${entry.previous_status} \u2192 ` : ""}
                    {entry.new_status}
                  </p>
                  {entry.remarks && <p className="mt-1 text-sm text-slate-500">{entry.remarks}</p>}
                </div>
              ))}
            </div>
          )}
        </article>
      </section>
    </main>
  );
}
