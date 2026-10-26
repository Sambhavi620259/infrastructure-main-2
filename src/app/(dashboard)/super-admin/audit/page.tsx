"use client";

import { useEffect, useState } from "react";
import {
  actionLabel,
  formatDateTime,
  listAuditActions,
  listPlatformAudit,
  type PlatformAuditEntry,
} from "@/lib/super-admin";

const PAGE_SIZE = 50;
const ROLE_NAMES: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  IT_ADMIN: "IT Admin",
  SUB_ADMIN: "Sub Admin",
  REPORTING_USER: "Reporting user",
  EMPLOYEE: "User",
};

export default function PlatformAuditPage() {
  const [entries, setEntries] = useState<PlatformAuditEntry[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [signIns, setSignIns] = useState(false);
  const [role, setRole] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    listAuditActions().then(setActions).catch(() => undefined);
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
      sign_ins: signIns,
      role: role || undefined,
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
  }, [search, action, signIns, role, page]);

  return (
    <main className="mx-auto max-w-[1400px] space-y-5">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-wider text-violet-600">Super Admin · Audit logs</p>
        <h1 className="mt-1 text-2xl font-extrabold text-slate-950">Platform audit log</h1>
        <p className="mt-1 text-sm text-slate-500">Every recorded action, newest first. The IT Admin sign-ins and User sign-ins tabs show when each group registered or signed in.</p>
      </header>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div role="tablist" className="flex gap-2 border-b border-slate-100 px-4 pt-3">
          {[
            ["All activity", false, ""],
            ["IT Admin sign-ins", true, "IT_ADMIN"],
            ["User sign-ins", true, "EMPLOYEE"],
          ].map(([label, ins, who]) => (
            <button
              key={label as string}
              type="button"
              role="tab"
              aria-selected={signIns === ins && role === who}
              onClick={() => {
                setSignIns(ins as boolean);
                setRole(who as string);
                setAction("");
                setPage(0);
              }}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${
                signIns === ins && role === who ? "border-violet-600 text-violet-700" : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {label as string}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search the audit log"
            placeholder="Search name, email or details"
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
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left">
            <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              <tr>
                {["When", "Who", "Role", "Action", "Details"].map((h) => (
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
                  <td className="px-4 py-3 text-slate-600">{entry.user_role ? ROLE_NAMES[entry.user_role] ?? entry.user_role : "—"}</td>
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
