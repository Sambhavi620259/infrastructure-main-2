"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { getAssetCounts, listAssetEvents, listAssets, updateAsset } from "@/lib/assets";
import {
  assetStatusLabel,
  assetStatusStyle,
  type Asset,
  type AssetCounts,
  type AssetEvent,
  type AssetStatus, assetLabel } from "@/types/asset";

/** Lifecycle stages, each grouping the statuses an asset can hold in it. */
const STAGES: { label: string; hint: string; statuses: AssetStatus[] }[] = [
  { label: "In stock", hint: "Received and awaiting deployment", statuses: ["IN_STOCK", "REQUESTED"] },
  { label: "Deployed", hint: "With an employee", statuses: ["ASSIGNED", "IN_USE"] },
  { label: "Returning", hint: "Coming back from a user", statuses: ["RETURN_REQUESTED", "RETURNED"] },
  { label: "Maintenance", hint: "Repair or damage review", statuses: ["IN_REPAIR", "DAMAGED"] },
  { label: "Lost", hint: "Missing or unaccounted for", statuses: ["LOST"] },
  { label: "End of life", hint: "Retired or disposed", statuses: ["RETIRED", "DISPOSED"] },
];

// ASSIGNED goes through the assignment flow; everything else can be set here.
const TARGET_STATUSES: AssetStatus[] = [
  "IN_STOCK",
  "IN_USE",
  "RETURNED",
  "IN_REPAIR",
  "DAMAGED",
  "LOST",
  "RETIRED",
  "DISPOSED",
];

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function AssetLifecyclePage() {
  const [counts, setCounts] = useState<AssetCounts | null>(null);
  const [events, setEvents] = useState<AssetEvent[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getAssetCounts(), listAssetEvents({ action: "STATUS_CHANGE", limit: 15 })])
      .then(([countData, eventData]) => {
        if (cancelled) return;
        setCounts(countData);
        setEvents(eventData);
        setError("");
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load lifecycle data.");
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const stageCount = (statuses: AssetStatus[]) =>
    counts ? statuses.reduce((sum, value) => sum + (counts.by_status[value] ?? 0), 0) : undefined;

  return (
    <main className="mx-auto max-w-7xl space-y-5">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-wider text-brand-600">Assets · Lifecycle</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">Asset Lifecycle</h1>
        <p className="mt-1 text-sm text-slate-500">Follow assets from procurement through retirement and disposal.</p>
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
      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <section aria-label="Lifecycle stages" className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {STAGES.map((stage) => (
          <article key={stage.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-2xl font-bold tracking-tight text-slate-950">{stageCount(stage.statuses) ?? "—"}</p>
            <p className="mt-1 text-sm font-semibold text-slate-700">{stage.label}</p>
            <p className="mt-1 text-xs text-slate-500">{stage.hint}</p>
            <p className="mt-2 flex flex-wrap gap-1">
              {stage.statuses.map((value) => (
                <span key={value} className="text-[11px] text-slate-500">
                  {assetStatusLabel(value)} {counts?.by_status[value] ?? 0}
                </span>
              ))}
            </p>
          </article>
        ))}
      </section>

      <section className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <TransitionForm
          onDone={(asset) => {
            setNotice(`${assetLabel(asset)} moved to ${assetStatusLabel(asset.status)}.`);
            setRefreshKey((key) => key + 1);
          }}
        />

        <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="text-base font-extrabold text-slate-900">Recent transitions</h2>
              <p className="mt-1 text-xs text-slate-500">Latest status changes across all assets.</p>
            </div>
            <Link href="/assets/history" className="text-sm font-semibold text-brand-600 hover:text-brand-700">
              Full history
            </Link>
          </div>
          {events.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-500">No status changes recorded yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {events.map((event) => (
                <li key={event.id} className="px-5 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/assets/${event.asset_id}`} className="font-semibold text-slate-800 hover:text-brand-700">
                      {event.asset_tag ?? "Untagged"} · {event.asset_name}
                    </Link>
                    <span className="text-xs text-slate-500">{formatDateTime(event.timestamp)}</span>
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                    {event.previous_status && (
                      <>
                        <StatusBadge status={event.previous_status} />
                        <span aria-hidden="true">→</span>
                      </>
                    )}
                    <StatusBadge status={event.new_status} />
                    {event.performed_by_name && <span className="text-slate-500">by {event.performed_by_name}</span>}
                  </p>
                  {event.remarks && <p className="mt-1 text-xs text-slate-500">{event.remarks}</p>}
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 font-semibold ring-1 ring-inset ${assetStatusStyle(status)}`}>
      {assetStatusLabel(status)}
    </span>
  );
}

function TransitionForm({ onDone }: { onDone: (asset: Asset) => void }) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Asset[]>([]);
  const [asset, setAsset] = useState<Asset | null>(null);
  const [target, setTarget] = useState<AssetStatus | "">("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Debounced asset search by name, tag or serial.
  useEffect(() => {
    if (asset || query.trim().length < 2) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      listAssets({ search: query.trim(), limit: 8 })
        .then((data) => {
          if (!cancelled) setMatches(data);
        })
        .catch(() => undefined);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, asset]);

  const reset = () => {
    setQuery("");
    setAsset(null);
    setTarget("");
    setRemarks("");
    setError("");
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!asset || !target) {
      setError("Choose an asset and the stage to move it to.");
      return;
    }
    setSaving(true);
    try {
      const updated = await updateAsset(asset.id, { status: target, status_remarks: remarks.trim() || undefined });
      reset();
      onDone(updated);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Update failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-base font-extrabold text-slate-900">Update lifecycle</h2>
        <p className="mt-1 text-xs text-slate-500">Move an asset to its next stage. The change is recorded in its history.</p>
      </div>

      {asset ? (
        <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
          <div>
            <p className="font-semibold text-slate-800">{asset.name}</p>
            <p className="text-xs text-slate-500">
              {assetLabel(asset)} · currently {assetStatusLabel(asset.status)}
            </p>
          </div>
          <button type="button" onClick={reset} className="text-xs font-semibold text-brand-600 hover:text-brand-700">
            Change
          </button>
        </div>
      ) : (
        <div className="relative">
          <label className="block text-sm">
            <span className="font-semibold text-slate-700">Asset</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name, tag, or serial"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
          </label>
          {matches.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
              {matches.map((match) => (
                <li key={match.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setAsset(match);
                      setMatches([]);
                    }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                  >
                    <span className="font-semibold text-slate-800">{assetLabel(match)}</span>{" "}
                    <span className="text-slate-600">{match.name}</span>{" "}
                    <span className="text-xs text-slate-400">({assetStatusLabel(match.status)})</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <label className="block text-sm">
        <span className="font-semibold text-slate-700">Move to</span>
        <select
          value={target}
          onChange={(event) => setTarget(event.target.value as AssetStatus | "")}
          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
        >
          <option value="">Select a stage…</option>
          {TARGET_STATUSES.filter((value) => value !== asset?.status).map((value) => (
            <option key={value} value={value}>
              {assetStatusLabel(value)}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm">
        <span className="font-semibold text-slate-700">
          Note <span className="font-normal text-slate-400">(optional)</span>
        </span>
        <textarea
          value={remarks}
          onChange={(event) => setRemarks(event.target.value)}
          maxLength={500}
          rows={2}
          placeholder="e.g. Battery failure, approved for disposal"
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
        />
      </label>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={saving}
        className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Update lifecycle"}
      </button>
    </form>
  );
}
