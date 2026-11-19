"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listAssetEvents, type AssetEventParams } from "@/lib/assets";
import { assetStatusLabel, type AssetEvent } from "@/types/asset";

const PAGE_SIZE = 50;
const EXPORT_LIMIT = 1000;

const EVENT_TYPES: { value: string; label: string }[] = [
  { value: "", label: "All events" },
  { value: "CREATED", label: "Registered" },
  { value: "ASSIGNED", label: "Assigned" },
  { value: "UNASSIGNED", label: "Returned to stock" },
  { value: "STATUS_CHANGE", label: "Status change" },
];

function eventLabel(action: string): string {
  return EVENT_TYPES.find((type) => type.value === action)?.label ?? action;
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Dates are whole days: "to" includes everything up to the end of that day.
function buildFilters(search: string, action: string, dateFrom: string, dateTo: string): AssetEventParams {
  return {
    search: search || undefined,
    action: action || undefined,
    date_from: dateFrom ? `${dateFrom}T00:00:00` : undefined,
    date_to: dateTo ? `${dateTo}T23:59:59` : undefined,
  };
}

function csvCell(value: string | null | undefined): string {
  const text = value ?? "";
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(events: AssetEvent[]) {
  const header = ["Timestamp", "Asset tag", "Asset", "Event", "From", "To", "By", "Remarks"];
  const rows = events.map((event) => [
    event.timestamp,
    event.asset_tag,
    event.asset_name,
    eventLabel(event.action),
    event.previous_status,
    event.new_status,
    event.performed_by_name,
    event.remarks,
  ]);
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `asset-history-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function AssetHistoryPage() {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(0);
  const [events, setEvents] = useState<AssetEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
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
    listAssetEvents({ ...buildFilters(search, action, dateFrom, dateTo), skip: page * PAGE_SIZE, limit: PAGE_SIZE })
      .then((data) => {
        if (cancelled) return;
        setEvents(data);
        setError("");
      })
      .catch((caught) => {
        if (cancelled) return;
        setEvents([]);
        setError(caught instanceof Error ? caught.message : "Unable to load history.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [search, action, dateFrom, dateTo, page]);

  const handleExport = async () => {
    setExporting(true);
    try {
      downloadCsv(await listAssetEvents({ ...buildFilters(search, action, dateFrom, dateTo), limit: EXPORT_LIMIT }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  const updateFilter = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setPage(0);
  };

  return (
    <main className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-brand-600">Assets · History</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">Asset History</h1>
          <p className="mt-1 text-sm text-slate-500">Review registration, assignment, and lifecycle events.</p>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
        >
          {exporting ? "Exporting…" : "Export history"}
        </button>
      </header>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-5 lg:flex-row lg:items-end">
          <label className="block flex-1 text-xs font-semibold text-slate-600">
            Asset
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name or tag"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-normal"
            />
          </label>
          <label className="block text-xs font-semibold text-slate-600">
            Event
            <select
              value={action}
              onChange={(event) => updateFilter(setAction)(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal lg:w-44"
            >
              {EVENT_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-semibold text-slate-600">
            From
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => updateFilter(setDateFrom)(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal"
            />
          </label>
          <label className="block text-xs font-semibold text-slate-600">
            To
            <input
              type="date"
              value={dateTo}
              onChange={(event) => updateFilter(setDateTo)(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal"
            />
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[960px] w-full text-left">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600">
              <tr>
                <th className="px-5 py-3">When</th>
                <th className="px-5 py-3">Asset</th>
                <th className="px-5 py-3">Event</th>
                <th className="px-5 py-3">Change</th>
                <th className="px-5 py-3">By</th>
                <th className="px-5 py-3">Remarks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {events.map((event) => (
                <tr key={event.id} className="align-top text-sm hover:bg-slate-50">
                  <td className="whitespace-nowrap px-5 py-3 text-slate-600">{formatDateTime(event.timestamp)}</td>
                  <td className="px-5 py-3">
                    <Link href={`/assets/${event.asset_id}`} className="font-semibold text-slate-800 hover:text-brand-700">
                      {event.asset_tag}
                    </Link>
                    <p className="text-xs text-slate-500">{event.asset_name}</p>
                  </td>
                  <td className="px-5 py-3 font-medium text-slate-700">{eventLabel(event.action)}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-slate-600">
                    {event.previous_status ? `${assetStatusLabel(event.previous_status)} → ` : ""}
                    {assetStatusLabel(event.new_status)}
                  </td>
                  <td className="px-5 py-3 text-slate-600">{event.performed_by_name ?? "—"}</td>
                  <td className="px-5 py-3 text-slate-500">{event.remarks ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && events.length === 0 && !error && (
          <p className="p-10 text-center text-sm text-slate-500">No events match these filters.</p>
        )}
        <footer className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-sm text-slate-500">
          <span>{loading ? "Loading…" : `Page ${page + 1}`}</span>
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
              disabled={events.length < PAGE_SIZE || loading}
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
