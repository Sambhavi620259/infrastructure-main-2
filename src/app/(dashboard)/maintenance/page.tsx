"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import WarrantyPage from "@/app/(dashboard)/assets/warranty/page";
import { listMaintenance, type MaintenanceRecord, type MaintenanceStatus } from "@/lib/operations";
import { formatDate } from "@/types/asset";

const STATUS_STYLE: Record<MaintenanceStatus, string> = {
  SCHEDULED: "bg-slate-100 text-slate-700",
  IN_PROGRESS: "bg-amber-50 text-amber-700",
  COMPLETED: "bg-emerald-50 text-emerald-700",
  CANCELLED: "bg-slate-100 text-slate-500",
};

/** Repairs across all assets, and warranty / AMC coverage and claims. */
export default function MaintenanceWarrantyPage() {
  const [tab, setTab] = useState<"maintenance" | "warranty">("maintenance");

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tab") === "warranty") setTab("warranty");
  }, []);

  return (
    <div className="space-y-4">
      <div className="mx-auto flex max-w-7xl gap-1 rounded-xl border border-slate-200 bg-white p-1 text-sm font-semibold shadow-sm sm:w-fit">
        {([["maintenance", "Maintenance"], ["warranty", "Warranty / AMC"]] as const).map(([value, text]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            aria-pressed={tab === value}
            className={`flex-1 rounded-lg px-4 py-2 sm:flex-none ${tab === value ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
          >
            {text}
          </button>
        ))}
      </div>
      {tab === "maintenance" ? <MaintenanceList /> : <WarrantyPage />}
    </div>
  );
}

function MaintenanceList() {
  const [records, setRecords] = useState<MaintenanceRecord[]>([]);
  const [status, setStatus] = useState<MaintenanceStatus | "">("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    listMaintenance({ status: status || undefined })
      .then(setRecords)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load maintenance."))
      .finally(() => setLoading(false));
  }, [status]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return records.filter((r) => `${r.asset_tag ?? ""} ${r.asset_name ?? ""} ${r.issue}`.toLowerCase().includes(needle));
  }, [records, query]);

  const open = records.filter((r) => r.status === "SCHEDULED" || r.status === "IN_PROGRESS").length;
  const cost = records.filter((r) => r.status === "COMPLETED").reduce((sum, r) => sum + (Number(r.cost) || 0), 0);

  return (
    <main className="mx-auto max-w-7xl space-y-5">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-wider text-brand-600">Maintenance &amp; Warranty</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">Maintenance</h1>
        <p className="mt-1 text-sm text-slate-500">
          Repairs across all assets. Log a repair from the asset&rsquo;s page; starting one moves the asset to In repair and closing it returns it.
        </p>
      </header>
      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {[
          ["Open repairs", open, open ? "text-amber-600" : "text-slate-900"],
          ["All records", records.length, "text-slate-900"],
          ["Completed repair cost", cost.toLocaleString(), "text-slate-900"],
        ].map(([label, value, color]) => (
          <div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold text-slate-500">{label}</p>
            <p className={`mt-1 text-2xl font-extrabold ${color}`}>{loading ? "—" : value}</p>
          </div>
        ))}
      </section>
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search asset or issue"
            aria-label="Search maintenance"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-brand-500 sm:max-w-sm"
          />
          <select value={status} onChange={(e) => setStatus(e.target.value as MaintenanceStatus | "")} aria-label="Filter by status" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
            <option value="">All statuses</option>
            <option value="SCHEDULED">Scheduled</option>
            <option value="IN_PROGRESS">In progress</option>
            <option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>{["Asset", "Issue", "Vendor", "Cost", "Started", "Completed", "Status"].map((h) => <th key={h} className="px-4 py-2.5 font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/assets/${r.asset_id}`} className="font-semibold text-slate-800 hover:text-brand-700">{r.asset_tag ?? r.asset_name ?? "Asset"}</Link>
                    {r.asset_tag && r.asset_name && <span className="block text-xs text-slate-500">{r.asset_name}</span>}
                  </td>
                  <td className="max-w-xs px-4 py-3 text-slate-600">{r.issue}</td>
                  <td className="px-4 py-3 text-slate-600">{r.vendor_name ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{Number(r.cost) ? Number(r.cost).toLocaleString() : "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(r.start_date)}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(r.completion_date)}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_STYLE[r.status]}`}>{r.status.replace("_", " ").toLowerCase()}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && visible.length === 0 && <p className="p-8 text-center text-sm text-slate-500">No maintenance records{status || query ? " match" : " yet"}.</p>}
      </section>
    </main>
  );
}
