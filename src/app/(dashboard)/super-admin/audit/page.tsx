"use client";

import { useEffect, useState } from "react";
import {
  actionLabel,
  formatDateTime,
  listAuditActions,
  listCompanies,
  listPlatformAudit,
  type Company,
  type PlatformAuditEntry,
} from "@/lib/super-admin";

const PAGE_SIZE = 50;

export default function PlatformAuditPage() {
  const [entries, setEntries] = useState<PlatformAuditEntry[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    listAuditActions().then(setActions).catch(() => undefined);
    listCompanies().then(setCompanies).catch(() => undefined);
  }, []);

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
    listPlatformAudit({
      search: search || undefined,
      action: action || undefined,
      company_id: companyId || undefined,
      skip: page * PAGE_SIZE,
      limit: PAGE_SIZE,
    })
      .then((data) => {
        if (cancelled) return;
        setEntries(data);
        setError("");
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load the audit log.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [search, action, companyId, page]);

  return (
    <main className="mx-auto max-w-[1400px] space-y-5">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-wider text-violet-600">Super Admin · Audit logs</p>
        <h1 className="mt-1 text-2xl font-extrabold text-slate-950">Platform audit log</h1>
        <p className="mt-1 text-sm text-slate-500">Every recorded action across all organizations, newest first.</p>
      </header>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search the audit log"
            placeholder="Search user, organization or details"
            className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
          />
          <select
            value={action}
            onChange={(event) => {
              setAction(event.target.value);
              setPage(0);
            }}
            aria-label="Filter by action"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <option value="">All actions</option>
            {actions.map((value) => (
              <option key={value} value={value}>
                {actionLabel(value)}
              </option>
            ))}
          </select>
          <select
            value={companyId}
            onChange={(event) => {
              setCompanyId(event.target.value);
              setPage(0);
            }}
            aria-label="Filter by organization"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <option value="">All organizations</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left">
            <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              <tr>
                {["When", "Who", "Organization", "Action", "Details"].map((h) => (
                  <th key={h} className="px-4 py-2.5">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map((entry) => (
                <tr key={entry.id} className="align-top text-sm">
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDateTime(entry.timestamp)}</td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-800">{entry.user_name ?? "System"}</p>
                    {entry.user_email && <p className="text-xs text-slate-500">{entry.user_email}</p>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{entry.company_name ?? "Platform"}</td>
                  <td className="px-4 py-3 font-semibold text-slate-700">{actionLabel(entry.action)}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {entry.old_value && entry.new_value ? `${entry.old_value} → ${entry.new_value}` : entry.new_value ?? entry.old_value ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && entries.length === 0 && !error && (
          <p className="p-8 text-center text-sm text-slate-500">No events match these filters.</p>
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
              disabled={entries.length < PAGE_SIZE || loading}
              className="rounded-md border border-slate-200 px-3 py-1.5 disabled:opacity-50"
            >
              Next
            </button>
          </span>
        </footer>
      </section>
    </main>
  );
}
