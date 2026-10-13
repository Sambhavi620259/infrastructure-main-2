"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { licenseTypeLabel, listLicenses, type SoftwareLicense } from "@/lib/software";
import { formatDate } from "@/types/asset";

const PAGE_SIZE = 25;

type Filter = "all" | "expiring" | "expired" | "full";

/** License entitlements: seats purchased, assigned and available, with expiry and renewal dates. */
export default function SoftwareLicensesPage() {
  const [licenses, setLicenses] = useState<SoftwareLicense[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    listLicenses()
      .then(setLicenses)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load licenses."))
      .finally(() => setLoading(false));
  }, []);

  const now = Date.now();
  const soon = now + 30 * 24 * 60 * 60 * 1000;
  const expiresAt = (l: SoftwareLicense) => (l.expiry_date ? new Date(l.expiry_date).getTime() : null);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return licenses.filter((l) => {
      if (needle && !`${l.software_name ?? ""} ${l.license_number ?? ""}`.toLowerCase().includes(needle)) return false;
      const end = expiresAt(l);
      if (filter === "expiring") return end !== null && end >= now && end <= soon;
      if (filter === "expired") return end !== null && end < now;
      if (filter === "full") return l.status === "ACTIVE" && l.available === 0;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [licenses, query, filter]);

  const active = licenses.filter((l) => l.status === "ACTIVE");
  const seats = active.reduce((sum, l) => sum + l.seats, 0);
  const assigned = active.reduce((sum, l) => sum + l.assigned, 0);
  const expiring = licenses.filter((l) => {
    const end = expiresAt(l);
    return end !== null && end >= now && end <= soon;
  }).length;
  const shown = visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <main className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-brand-600">Inventory · Software Licenses</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">Software Licenses</h1>
          <p className="mt-1 text-sm text-slate-500">
            Every license bought: seats purchased, assigned and available, cost, expiry and renewal. Manage seats under Software Assets.
          </p>
        </div>
        <Link href="/assets/software" className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50">
          Software Assets →
        </Link>
      </header>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Seats purchased", seats, "text-slate-900"],
          ["Seats assigned", assigned, "text-blue-600"],
          ["Seats available", Math.max(seats - assigned, 0), "text-emerald-600"],
          ["Expiring in 30 days", expiring, expiring ? "text-amber-600" : "text-slate-900"],
        ].map(([label, value, color]) => (
          <div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold text-slate-500">{label}</p>
            <p className={`mt-1 text-2xl font-extrabold ${color}`}>{loading ? "—" : value}</p>
          </div>
        ))}
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex-1">
            <span className="sr-only">Search licenses</span>
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
              placeholder="Search product or license number"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-brand-500 sm:max-w-sm"
            />
          </label>
          <div role="tablist" aria-label="Filter licenses" className="flex flex-wrap gap-1">
            {([["all", "All"], ["expiring", "Expiring soon"], ["expired", "Expired"], ["full", "Fully used"]] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={filter === value}
                onClick={() => {
                  setFilter(value);
                  setPage(0);
                }}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${filter === value ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                {["Product", "License number", "Type", "Seats", "Assigned", "Available", "Utilization", "Expiry", "Renewal", "Cost"].map((h) => (
                  <th key={h} className="px-4 py-2.5 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((l) => {
                const pct = l.seats ? Math.round((l.assigned / l.seats) * 100) : 0;
                const end = expiresAt(l);
                return (
                  <tr key={l.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/assets/software?product=${l.software_id}`} className="font-semibold text-slate-800 hover:text-brand-700">
                        {l.software_name}
                      </Link>
                      {l.status !== "ACTIVE" && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">{l.status}</span>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{l.license_number ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{licenseTypeLabel(l.license_type)}</td>
                    <td className="px-4 py-3 font-semibold text-slate-800">{l.seats}</td>
                    <td className="px-4 py-3 text-slate-700">{l.assigned}</td>
                    <td className={`px-4 py-3 font-semibold ${l.available === 0 ? "text-rose-600" : "text-emerald-700"}`}>{l.available}</td>
                    <td className="px-4 py-3">
                      <div className="h-1.5 w-24 rounded-full bg-slate-100">
                        <div className={`h-1.5 rounded-full ${pct >= 90 ? "bg-rose-500" : pct >= 70 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                      </div>
                      <span className="text-[11px] text-slate-500">{pct}%</span>
                    </td>
                    <td className={`px-4 py-3 ${end !== null && end < now ? "font-semibold text-rose-600" : end !== null && end <= soon ? "font-semibold text-amber-700" : "text-slate-600"}`}>
                      {formatDate(l.expiry_date)}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(l.renewal_date)}</td>
                    <td className="px-4 py-3 text-slate-600">{Number(l.cost) ? Number(l.cost).toLocaleString() : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!loading && visible.length === 0 && (
          <p className="p-8 text-center text-sm text-slate-500">
            {licenses.length === 0 ? "No licenses yet. Register software under Assets → Software Assets." : "No licenses match."}
          </p>
        )}
        {visible.length > PAGE_SIZE && (
          <footer className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
            <span>
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, visible.length)} of {visible.length}
            </span>
            <span className="space-x-2">
              <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="rounded-md border border-slate-200 px-3 py-1 disabled:opacity-50">Previous</button>
              <button type="button" disabled={(page + 1) * PAGE_SIZE >= visible.length} onClick={() => setPage((p) => p + 1)} className="rounded-md border border-slate-200 px-3 py-1 disabled:opacity-50">Next</button>
            </span>
          </footer>
        )}
      </section>
    </main>
  );
}
