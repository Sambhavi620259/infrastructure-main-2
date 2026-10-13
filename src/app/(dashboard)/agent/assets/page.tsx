"use client";

import { useCallback, useEffect, useState } from "react";
import { listAssets, updateAsset } from "@/lib/assets";
import { createAssetRequest } from "@/lib/tickets";
import {
  ASSET_STATUSES,
  assetStatusLabel,
  assetStatusStyle,
  formatDate,
  type Asset,
  type AssetStatus, assetLabel } from "@/types/asset";

const PAGE_SIZE = 25;

// Only the IT Admin assigns assets or takes them back, so users cannot pick
// Assigned, nor (for an asset someone holds) a status that would release it.
// Mirrors the checks in PUT /api/assets/{id}.
const STATUS_TARGETS = ASSET_STATUSES.filter((value) => value !== "ASSIGNED");
const RELEASING: readonly AssetStatus[] = ["IN_STOCK", "RETURNED", "RETIRED", "DISPOSED"];

export default function AgentAssetsPage() {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<AssetStatus | "">("");
  const [page, setPage] = useState(0);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [panel, setPanel] = useState<{ assetId: string; mode: "status" | "problem" | "return" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listAssets({ search: search || undefined, status: status || undefined, skip: page * PAGE_SIZE, limit: PAGE_SIZE })
      .then((data) => {
        if (cancelled) return;
        setAssets(data);
        setError("");
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load assets.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [search, status, page, refreshKey]);

  const run = useCallback(async (action: () => Promise<Asset>, message: (asset: Asset) => string) => {
    setBusy(true);
    try {
      const asset = await action();
      setNotice(message(asset));
      setError("");
      setPanel(null);
      setRefreshKey((key) => key + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <main className="mx-auto max-w-[1400px] space-y-4">
      <header>
        <p className="text-[11px] font-semibold text-brand-600">User · Assets</p>
        <h1 className="mt-1 text-2xl font-extrabold">My Assets</h1>
        <p className="mt-1 text-xs text-slate-500">
          The assets assigned to you. Keep their status up to date, for example report one as damaged or in repair.
          To get a new asset, raise a ticket; your IT Admin assigns it.
        </p>
      </header>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-800">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      <section className="ui-surface flex flex-col gap-3 p-4 sm:flex-row">
        <label className="flex-1">
          <span className="sr-only">Search assets</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search asset tag, name or serial number..."
            className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-xs outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
        </label>
        <label>
          <span className="sr-only">Filter by status</span>
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as AssetStatus | "");
              setPage(0);
            }}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs sm:w-44"
          >
            <option value="">All statuses</option>
            {ASSET_STATUSES.map((value) => (
              <option key={value} value={value}>
                {assetStatusLabel(value)}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="ui-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-400">
              <tr>
                {["Asset", "Category", "Status", "Updated", ""].map((heading) => (
                  <th key={heading} className="px-4 py-2 font-bold">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {assets.map((asset) => (
                <AssetRow
                  key={asset.id}
                  asset={asset}
                  mode={panel?.assetId === asset.id ? panel.mode : null}
                  busy={busy}
                  onOpen={(mode) => setPanel({ assetId: asset.id, mode })}
                  onClose={() => setPanel(null)}
                  onReturn={(reason) =>
                    run(
                      async () => {
                        await createAssetRequest({ ticket_type: "RETURN", asset_id: asset.id, reason });
                        return asset;
                      },
                      (a) => `Return of ${assetLabel(a)} requested. Your IT Admin will confirm the handover.`,
                    )
                  }
                  onProblem={(description) =>
                    run(
                      async () => {
                        await createAssetRequest({ ticket_type: "ISSUE", asset_id: asset.id, reason: description });
                        return asset;
                      },
                      (a) => `Problem with ${assetLabel(a)} reported. Your IT Admin has been notified; follow it under Tickets.`,
                    )
                  }
                  onStatus={(next, note) =>
                    run(
                      () => updateAsset(asset.id, { status: next, status_remarks: note || undefined }),
                      (a) => `${assetLabel(a)} is now ${assetStatusLabel(a.status)}.`,
                    )
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
        {!loading && assets.length === 0 && !error && (
          <p className="p-8 text-center text-xs text-slate-500">
            {search || status ? "No assets match your search." : "No assets are assigned to you yet. Raise a ticket to request one."}
          </p>
        )}
        <footer className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
          <span>{loading ? "Loading…" : `Page ${page + 1}`}</span>
          <span className="space-x-2">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              disabled={page === 0 || loading}
              className="rounded-md border border-slate-200 px-3 py-1 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage((current) => current + 1)}
              disabled={assets.length < PAGE_SIZE || loading}
              className="rounded-md border border-slate-200 px-3 py-1 disabled:opacity-50"
            >
              Next
            </button>
          </span>
        </footer>
      </section>
    </main>
  );
}

function AssetRow({
  asset,
  mode,
  busy,
  onOpen,
  onClose,
  onStatus,
  onProblem,
  onReturn,
}: {
  asset: Asset;
  mode: "status" | "problem" | "return" | null;
  busy: boolean;
  onOpen: (mode: "status" | "problem" | "return") => void;
  onClose: () => void;
  onStatus: (status: AssetStatus, note: string) => void;
  onProblem: (description: string) => void;
  onReturn: (reason: string) => void;
}) {
  const [returnReason, setReturnReason] = useState("");
  const [next, setNext] = useState<AssetStatus | "">("");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState("");
  const held = Boolean(asset.assigned_to_id);
  const targets = STATUS_TARGETS.filter((value) => value !== asset.status && !(held && RELEASING.includes(value)));

  return (
    <>
      <tr className="hover:bg-slate-50">
        <td className="px-4 py-3">
          <p className="font-semibold text-slate-700">{assetLabel(asset)}</p>
          <p className="text-[11px] text-slate-500">
            {asset.name}
            {asset.model ? ` · ${asset.model}` : ""}
          </p>
        </td>
        <td className="px-4 py-3 text-slate-500">{asset.category}</td>
        <td className="px-4 py-3">
          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${assetStatusStyle(asset.status)}`}>
            {assetStatusLabel(asset.status)}
          </span>
        </td>
        <td className="px-4 py-3 text-slate-500">{formatDate(asset.updated_at)}</td>
        <td className="whitespace-nowrap px-4 py-3 text-right">
          <span className="inline-flex gap-3 font-semibold">
            <button type="button" onClick={() => onOpen("problem")} className="text-orange-700 hover:text-orange-800">
              Report a problem
            </button>
            {asset.status !== "RETURN_REQUESTED" && (
              <button type="button" onClick={() => onOpen("return")} className="text-sky-700 hover:text-sky-800">
                Return
              </button>
            )}
            <button type="button" onClick={() => onOpen("status")} className="text-brand-600 hover:text-brand-700">
              Update status
            </button>
          </span>
        </td>
      </tr>
      {mode === "return" && (
        <tr className="bg-sky-50/40">
          <td colSpan={5} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold text-slate-600">Return {assetLabel(asset)}:</span>
              <label className="min-w-[16rem] flex-1">
                <span className="sr-only">Why are you returning it?</span>
                <input
                  value={returnReason}
                  onChange={(event) => setReturnReason(event.target.value)}
                  maxLength={1000}
                  placeholder="e.g. Leaving the team, no longer needed"
                  className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                />
              </label>
              <button
                type="button"
                disabled={busy || !returnReason.trim()}
                onClick={() => onReturn(returnReason.trim())}
                className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-700 disabled:opacity-50"
              >
                {busy ? "Sending…" : "Request return"}
              </button>
              <button type="button" onClick={onClose} className="px-2 text-xs font-semibold text-slate-600">Cancel</button>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              Keep the device until your IT Admin confirms the handover; it stays on your list until then.
            </p>
          </td>
        </tr>
      )}
      {mode === "problem" && (
        <tr className="bg-orange-50/40">
          <td colSpan={5} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold text-slate-600">Problem with {assetLabel(asset)}:</span>
              <label className="min-w-[16rem] flex-1">
                <span className="sr-only">Describe the problem</span>
                <input
                  value={problem}
                  onChange={(event) => setProblem(event.target.value)}
                  maxLength={1000}
                  placeholder="e.g. Battery drains in an hour, keyboard keys stuck"
                  className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                />
              </label>
              <button
                type="button"
                disabled={busy || !problem.trim()}
                onClick={() => onProblem(problem.trim())}
                className="rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-orange-700 disabled:opacity-50"
              >
                {busy ? "Sending…" : "Raise ticket"}
              </button>
              <button type="button" onClick={onClose} className="px-2 text-xs font-semibold text-slate-600">
                Cancel
              </button>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              Your IT Admin sees this asset&rsquo;s details with your ticket and will resolve it.
            </p>
          </td>
        </tr>
      )}
      {mode === "status" && (
        <tr className="bg-slate-50/70">
          <td colSpan={5} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-slate-600">New status</span>
                <select
                  value={next}
                  onChange={(event) => setNext(event.target.value as AssetStatus | "")}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs"
                >
                  <option value="">Choose…</option>
                  {targets.map((value) => (
                    <option key={value} value={value}>
                      {assetStatusLabel(value)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="sr-only">Note</span>
                <input
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  maxLength={500}
                  placeholder="Note (optional)"
                  className="w-56 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                />
              </label>
              <button
                type="button"
                disabled={busy || !next}
                onClick={() => next && onStatus(next, note.trim())}
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save"}
              </button>
              <button type="button" onClick={onClose} className="px-2 text-xs font-semibold text-slate-600">
                Cancel
              </button>
            </div>
            {held && (
              <p className="mt-2 text-[11px] text-slate-500">
                To return this asset, ask your IT Admin; they take it back.
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
