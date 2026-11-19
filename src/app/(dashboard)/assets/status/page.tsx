"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getAssetCounts, listAssets, updateAsset } from "@/lib/assets";
import {
  ASSET_STATUSES,
  assetStatusLabel,
  assetStatusStyle,
  formatDate,
  type Asset,
  type AssetCounts,
  type AssetStatus,
} from "@/types/asset";

const PAGE_SIZE = 25;

// ASSIGNED is set through the assignment flow, which records who holds the asset.
const EDITABLE_STATUSES = ASSET_STATUSES.filter((value) => value !== "ASSIGNED");

export default function AssetStatusPage() {
  const [counts, setCounts] = useState<AssetCounts | null>(null);
  const [status, setStatus] = useState<AssetStatus | "all">("all");
  const [page, setPage] = useState(0);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const loadCounts = useCallback(() => {
    getAssetCounts()
      .then(setCounts)
      .catch(() => undefined);
  }, []);

  useEffect(loadCounts, [loadCounts, refreshKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listAssets({ status: status === "all" ? undefined : status, skip: page * PAGE_SIZE, limit: PAGE_SIZE })
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
  }, [status, page, refreshKey]);

  const selectStatus = (next: AssetStatus | "all") => {
    setStatus(next);
    setPage(0);
  };

  const handleUpdated = (asset: Asset) => {
    setNotice(`${asset.asset_tag} is now ${assetStatusLabel(asset.status)}.`);
    setRefreshKey((key) => key + 1);
  };

  return (
    <main className="mx-auto max-w-7xl space-y-5">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-wider text-brand-600">Assets · Status</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">Asset Status</h1>
        <p className="mt-1 text-sm text-slate-500">
          Monitor availability, maintenance, and retirement status across inventory.
        </p>
      </header>

      {notice && (
        <div
          role="status"
          className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")} aria-label="Dismiss notification">
            ×
          </button>
        </div>
      )}

      <section aria-label="Assets by status" className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-6">
        <StatusTile
          label="All assets"
          value={counts?.total}
          active={status === "all"}
          onClick={() => selectStatus("all")}
        />
        {ASSET_STATUSES.map((value) => (
          <StatusTile
            key={value}
            label={assetStatusLabel(value)}
            value={counts?.by_status[value]}
            active={status === value}
            onClick={() => selectStatus(value)}
          />
        ))}
      </section>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-extrabold text-slate-900">
            {status === "all" ? "All assets" : assetStatusLabel(status)}
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            {loading ? "Loading…" : `${assets.length} shown on this page`} · To assign an asset, use{" "}
            <Link href="/assets/assignment" className="font-semibold text-brand-600 hover:text-brand-700">
              Assignment
            </Link>
            .
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[900px] w-full text-left">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600">
              <tr>
                <th className="px-5 py-3">Asset</th>
                <th className="px-5 py-3">Assigned to</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Updated</th>
                <th className="px-5 py-3">Change status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {assets.map((asset) => (
                <StatusRow key={asset.id} asset={asset} onUpdated={handleUpdated} />
              ))}
            </tbody>
          </table>
        </div>
        {!loading && assets.length === 0 && !error && (
          <p className="p-10 text-center text-sm text-slate-500">No assets in this status.</p>
        )}
        <footer className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-sm text-slate-500">
          <span>Page {page + 1}</span>
          <div className="space-x-2">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              disabled={page === 0 || loading}
              className="rounded-md border border-slate-200 px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50"
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
    </main>
  );
}

function StatusTile({
  label,
  value,
  active,
  onClick,
}: {
  label: string;
  value: number | undefined;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-xl border p-4 text-left shadow-sm transition ${
        active ? "border-brand-500 bg-brand-50 ring-2 ring-brand-500/20" : "border-slate-200 bg-white hover:bg-slate-50"
      }`}
    >
      <p className="text-2xl font-bold tracking-tight text-slate-950">{value ?? "—"}</p>
      <p className="mt-1 text-xs font-semibold text-slate-600">{label}</p>
    </button>
  );
}

function StatusRow({ asset, onUpdated }: { asset: Asset; onUpdated: (asset: Asset) => void }) {
  const [next, setNext] = useState<AssetStatus | "">("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!next) return;
    setSaving(true);
    try {
      const updated = await updateAsset(asset.id, { status: next, status_remarks: remarks.trim() || undefined });
      setNext("");
      setRemarks("");
      setError("");
      onUpdated(updated);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Update failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <tr className="align-top text-sm hover:bg-slate-50">
      <td className="px-5 py-3">
        <Link href={`/assets/${asset.id}`} className="font-semibold text-slate-800 hover:text-brand-700">
          {asset.name}
        </Link>
        <p className="mt-0.5 text-xs text-slate-500">{asset.asset_tag}</p>
      </td>
      <td className="px-5 py-3 text-slate-600">{asset.assigned_to_name ?? <span className="text-slate-400">Unassigned</span>}</td>
      <td className="px-5 py-3">
        <span
          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${assetStatusStyle(asset.status)}`}
        >
          {assetStatusLabel(asset.status)}
        </span>
      </td>
      <td className="px-5 py-3 text-slate-500">{formatDate(asset.updated_at)}</td>
      <td className="px-5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <label>
            <span className="sr-only">New status for {asset.asset_tag}</span>
            <select
              value={next}
              onChange={(event) => setNext(event.target.value as AssetStatus | "")}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
            >
              <option value="">Select…</option>
              {EDITABLE_STATUSES.filter((value) => value !== asset.status).map((value) => (
                <option key={value} value={value}>
                  {assetStatusLabel(value)}
                </option>
              ))}
            </select>
          </label>
          {next && (
            <>
              <label>
                <span className="sr-only">Note for {asset.asset_tag}</span>
                <input
                  value={remarks}
                  onChange={(event) => setRemarks(event.target.value)}
                  maxLength={500}
                  placeholder="Note (optional)"
                  className="w-40 rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                />
              </label>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </>
          )}
        </div>
        {error && (
          <p role="alert" className="mt-1 text-xs text-red-700">
            {error}
          </p>
        )}
      </td>
    </tr>
  );
}
