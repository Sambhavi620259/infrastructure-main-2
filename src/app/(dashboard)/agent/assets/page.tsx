"use client";

import { useCallback, useEffect, useState } from "react";
import { assignAsset, listAssets, unassignAsset, updateAsset } from "@/lib/assets";
import { listUserDirectory, type DirectoryEntry } from "@/lib/users";
import {
  ASSET_STATUSES,
  assetStatusLabel,
  assetStatusStyle,
  formatDate,
  type Asset,
  type AssetStatus,
} from "@/types/asset";

const PAGE_SIZE = 25;

// Assignment goes through Assign so the holder is recorded.
const STATUS_TARGETS = ASSET_STATUSES.filter((value) => value !== "ASSIGNED");

type Panel = { assetId: string; mode: "assign" | "status" } | null;

export default function AgentAssetsPage() {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<AssetStatus | "">("");
  const [page, setPage] = useState(0);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [users, setUsers] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [panel, setPanel] = useState<Panel>(null);
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
    listUserDirectory().then(setUsers).catch(() => undefined);
  }, []);

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
        <p className="text-[11px] font-semibold text-brand-600">IT Agent · Assets</p>
        <h1 className="mt-1 text-2xl font-extrabold">Asset Lookup</h1>
        <p className="mt-1 text-xs text-slate-500">
          Find hardware, hand it to users, take it back, and keep its status up to date.
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
          <table className="w-full min-w-[860px] text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-400">
              <tr>
                {["Asset", "Category", "Assigned to", "Status", "Updated", ""].map((heading) => (
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
                  users={users}
                  panel={panel?.assetId === asset.id ? panel.mode : null}
                  busy={busy}
                  onOpen={(mode) => setPanel({ assetId: asset.id, mode })}
                  onClose={() => setPanel(null)}
                  onAssign={(userId) =>
                    run(() => assignAsset(asset.id, userId), (a) => `${a.asset_tag} assigned to ${a.assigned_to_name}.`)
                  }
                  onUnassign={() => run(() => unassignAsset(asset.id), (a) => `${a.asset_tag} is back in stock.`)}
                  onStatus={(next, note) =>
                    run(
                      () => updateAsset(asset.id, { status: next, status_remarks: note || undefined }),
                      (a) => `${a.asset_tag} is now ${assetStatusLabel(a.status)}.`,
                    )
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
        {!loading && assets.length === 0 && !error && (
          <p className="p-8 text-center text-xs text-slate-500">No assets match your search.</p>
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
  users,
  panel,
  busy,
  onOpen,
  onClose,
  onAssign,
  onUnassign,
  onStatus,
}: {
  asset: Asset;
  users: DirectoryEntry[];
  panel: "assign" | "status" | null;
  busy: boolean;
  onOpen: (mode: "assign" | "status") => void;
  onClose: () => void;
  onAssign: (userId: string) => void;
  onUnassign: () => void;
  onStatus: (status: AssetStatus, note: string) => void;
}) {
  const [userId, setUserId] = useState("");
  const [next, setNext] = useState<AssetStatus | "">("");
  const [note, setNote] = useState("");
  const canAssign = asset.status === "IN_STOCK" || asset.status === "REQUESTED";
  const isAssigned = Boolean(asset.assigned_to_id);

  return (
    <>
      <tr className="hover:bg-slate-50">
        <td className="px-4 py-3">
          <p className="font-semibold text-slate-700">{asset.asset_tag}</p>
          <p className="text-[11px] text-slate-500">
            {asset.name}
            {asset.model ? ` · ${asset.model}` : ""}
          </p>
        </td>
        <td className="px-4 py-3 text-slate-500">{asset.category}</td>
        <td className="px-4 py-3 text-slate-600">
          {asset.assigned_to_name ?? <span className="text-slate-400">Unassigned</span>}
        </td>
        <td className="px-4 py-3">
          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${assetStatusStyle(asset.status)}`}>
            {assetStatusLabel(asset.status)}
          </span>
        </td>
        <td className="px-4 py-3 text-slate-500">{formatDate(asset.updated_at)}</td>
        <td className="whitespace-nowrap px-4 py-3 text-right">
          <span className="inline-flex gap-3 font-semibold">
            {canAssign && (
              <button type="button" onClick={() => onOpen("assign")} className="text-brand-600 hover:text-brand-700">
                Assign
              </button>
            )}
            {isAssigned && (
              <button type="button" disabled={busy} onClick={onUnassign} className="text-brand-600 hover:text-brand-700 disabled:opacity-50">
                Unassign
              </button>
            )}
            <button type="button" onClick={() => onOpen("status")} className="text-slate-600 hover:text-slate-900">
              Status
            </button>
          </span>
        </td>
      </tr>
      {panel && (
        <tr className="bg-slate-50/70">
          <td colSpan={6} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              {panel === "assign" ? (
                <label className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-slate-600">Assign {asset.asset_tag} to</span>
                  <select
                    value={userId}
                    onChange={(event) => setUserId(event.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs"
                  >
                    <option value="">Choose a user…</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.full_name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <>
                  <label className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-slate-600">New status</span>
                    <select
                      value={next}
                      onChange={(event) => setNext(event.target.value as AssetStatus | "")}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs"
                    >
                      <option value="">Choose…</option>
                      {STATUS_TARGETS.filter((value) => value !== asset.status).map((value) => (
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
                </>
              )}
              <button
                type="button"
                disabled={busy || (panel === "assign" ? !userId : !next)}
                onClick={() => (panel === "assign" ? onAssign(userId) : next && onStatus(next, note.trim()))}
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save"}
              </button>
              <button type="button" onClick={onClose} className="px-2 text-xs font-semibold text-slate-600">
                Cancel
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
