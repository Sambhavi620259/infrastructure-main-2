"use client";

import { useEffect, useState } from "react";
import {
  formatDateTime,
  listPlatformAssets,
  listPlatformSeats,
  type PlatformAsset,
  type PlatformSeat,
} from "@/lib/super-admin";

const PAGE_SIZE = 50;

export default function PlatformAssetsPage() {
  const [assets, setAssets] = useState<PlatformAsset[]>([]);
  const [seats, setSeats] = useState<PlatformSeat[]>([]);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [assignment, setAssignment] = useState("assigned");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
    listPlatformAssets({
      search: search || undefined,
      assignment: assignment === "all" ? undefined : assignment,
      skip: page * PAGE_SIZE,
      limit: PAGE_SIZE,
    })
      .then((data) => {
        if (cancelled) return;
        setAssets(data);
        setError("");
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load the assets.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [search, assignment, page]);

  // Software seats follow the same search box.
  useEffect(() => {
    listPlatformSeats({ search: search || undefined, limit: 200 })
      .then(setSeats)
      .catch(() => setSeats([]));
  }, [search]);

  return (
    <main className="mx-auto max-w-[1400px] space-y-5">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-wider text-violet-600">
          Super Admin · All assets
        </p>
        <h1 className="mt-1 text-2xl font-extrabold text-slate-950">All assets</h1>
        <p className="mt-1 text-sm text-slate-500">
          Every hardware asset and software seat in the system, who holds it, and which IT Admin assigned it.
          The Asset ID is unique to each device; the asset number can be shared by several.
        </p>
      </header>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </div>
      )}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search assets"
            placeholder="Search Asset ID, asset number, serial, name or person"
            className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
          />
          <select
            value={assignment}
            onChange={(event) => {
              setAssignment(event.target.value);
              setPage(0);
            }}
            aria-label="Filter by assignment"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <option value="assigned">Assigned to a user</option>
            <option value="unassigned">Not assigned</option>
            <option value="all">All assets</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left">
            <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              <tr>
                {["Asset ID", "Asset", "Assigned to", "Assigned by", "Assigned on"].map((h) => (
                  <th key={h} className="px-4 py-2.5">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {assets.map((asset) => (
                <tr key={asset.id} className="align-top text-sm">
                  <td className="whitespace-nowrap px-4 py-3 font-mono font-semibold text-slate-800">
                    {asset.asset_code}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-800">{asset.name}</p>
                    <p className="text-xs text-slate-500">
                      {asset.category}
                      {asset.asset_tag ? ` · Asset number ${asset.asset_tag}` : ""}
                      {asset.serial_number ? ` · S/N ${asset.serial_number}` : ""}
                    </p>
                    {asset.same_number_count > 1 && (
                      <p className="mt-0.5 text-xs font-semibold text-amber-700">
                        {asset.same_number_count} assets share this number. Use the Asset ID to tell them
                        apart.
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {asset.assigned_to_name ? (
                      <>
                        <p className="font-semibold text-slate-800">{asset.assigned_to_name}</p>
                        <p className="text-xs text-slate-500">{asset.assigned_to_email}</p>
                      </>
                    ) : (
                      <span className="text-slate-400">Not assigned</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {asset.assigned_to_name ? (asset.assigned_by_name ?? "—") : ""}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                    {asset.assigned_to_name ? formatDateTime(asset.assigned_at) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && assets.length === 0 && !error && (
          <p className="p-8 text-center text-sm text-slate-500">No assets match these filters.</p>
        )}
        <footer className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
          <span>{loading ? "Loading…" : `Page ${page + 1}`}</span>
          <span className="space-x-2">
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
              className="rounded-md border border-slate-200 px-3 py-1.5 disabled:opacity-50"
            >
              Next
            </button>
          </span>
        </footer>
      </section>

      {assignment !== "unassigned" && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="font-extrabold text-slate-900">Software seats ({seats.length})</h2>
            <p className="text-xs text-slate-500">Software given to users, and the IT Admin who gave it.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                <tr>
                  {["Software", "Assigned to", "Assigned by", "Assigned on"].map((h) => (
                    <th key={h} className="px-4 py-2.5">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {seats.map((seat) => (
                  <tr key={seat.id} className="align-top text-sm">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-800">{seat.software_name}</p>
                      {seat.license_number && (
                        <p className="text-xs text-slate-500">License {seat.license_number}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-800">{seat.assigned_to_name}</p>
                      <p className="text-xs text-slate-500">{seat.assigned_to_email}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{seat.assigned_by_name ?? "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                      {formatDateTime(seat.assigned_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {seats.length === 0 && (
            <p className="p-8 text-center text-sm text-slate-500">No software seats are assigned.</p>
          )}
        </section>
      )}
    </main>
  );
}
