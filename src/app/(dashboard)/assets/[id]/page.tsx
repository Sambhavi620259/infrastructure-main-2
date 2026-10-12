"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getAsset, listAssetLifecycle, updateAsset } from "@/lib/assets";
import { getProfile } from "@/lib/profile";
import { AssetForm, assetToForm, formToPayload, type AssetFormValues } from "@/components/assets/asset-form";
import { AssetCare } from "@/components/assets/asset-care";
import { useAssetWebSocket } from "@/lib/realtime";
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
  // IT Agents may only change status, condition and location (see AssetCare).
  const [canEdit, setCanEdit] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    getProfile()
      .then((profile) => setCanEdit(profile.role !== "IT_AGENT"))
      .catch(() => setCanEdit(false));
  }, []);

  const saveDetails = async (values: AssetFormValues) => {
    setSaving(true);
    setSaveError("");
    try {
      setAsset(await updateAsset(assetId, formToPayload(values)));
      setLifecycle(await listAssetLifecycle(assetId));
      setEditing(false);
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "Unable to save these details.");
    } finally {
      setSaving(false);
    }
  };

  const fetchAsset = useCallback(async () => {
    if (!assetId) return;
    setLoading(true);
    try {
      const [assetData, lifecycleData] = await Promise.all([
        getAsset(assetId),
        listAssetLifecycle(assetId),
      ]);
      setAsset(assetData);
      setLifecycle(lifecycleData);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load this asset.");
    } finally {
      setLoading(false);
    }
  }, [assetId]);

  useEffect(() => {
    fetchAsset();
  }, [fetchAsset]);

  // Real-time updates via WebSocket
  useAssetWebSocket(asset?.company_id, (message) => {
    if (message.asset.id === assetId) {
      setAsset(message.asset);
      // Refetch lifecycle to get the latest entry
      listAssetLifecycle(assetId).then(setLifecycle);
    }
  });

  if (loading) {
    return (
      <main className="mx-auto max-w-7xl">
        <p className="text-sm text-slate-500">Loading asset…</p>
      </main>
    );
  }

  if (error || !asset) {
    return (
      <main className="mx-auto max-w-7xl space-y-4">
        <Link
          href="/assets"
          className="inline-flex text-sm font-semibold text-brand-600 hover:text-brand-700"
        >
          ← Back to assets
        </Link>
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800"
        >
          {error || "Asset not found."}
        </div>
      </main>
    );
  }

  const details: [string, string][] = [
    ["Category", asset.category],
    ["Type", asset.type ?? "—"],
    ["Manufacturer", asset.brand ?? "—"],
    ["Model", asset.model ?? "—"],
    ["Serial number", asset.serial_number],
    ["Condition", asset.condition],
    ["Assigned to", asset.assigned_to_name ?? "Unassigned"],
    ["Purchase date", formatDate(asset.purchase_date)],
    ["Purchase cost", Number(asset.purchase_price) ? Number(asset.purchase_price).toLocaleString() : "—"],
    ["Warranty starts", formatDate(asset.warranty_start)],
    ["Warranty expires", formatDate(asset.warranty_end)],
    ["Registered", formatDate(asset.created_at)],
  ];

  return (
    <main className="mx-auto max-w-7xl space-y-8">
      <Link href="/assets" className="inline-flex text-sm font-semibold text-brand-600 hover:text-brand-700">
        ← Back to assets
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
              {asset.model ? ` · ${asset.model}` : ""}
            </p>
          </div>
        </div>
        {canEdit && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            Edit details
          </button>
        )}
      </header>

      {editing && (
        <section className="space-y-3">
          {saveError && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
              {saveError}
            </div>
          )}
          <AssetForm
            initial={assetToForm(asset)}
            creating={false}
            busy={saving}
            submitLabel="Save changes"
            onSubmit={saveDetails}
            onCancel={() => {
              setEditing(false);
              setSaveError("");
            }}
          />
        </section>
      )}

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
                    {entry.previous_status ? `${entry.previous_status} → ` : ""}
                    {entry.new_status}
                  </p>
                  {entry.remarks && <p className="mt-1 text-sm text-slate-500">{entry.remarks}</p>}
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      <AssetCare asset={asset} onAssetChanged={fetchAsset} />
    </main>
  );
}
