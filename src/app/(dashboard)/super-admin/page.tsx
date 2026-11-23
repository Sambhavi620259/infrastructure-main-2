"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRightIcon,
} from "@heroicons/react/24/outline";
import { getProfile } from "@/lib/profile";
import { addToOrganization, listUnassignedAgents } from "@/lib/users";
import type { AppUser } from "@/types/user";
import {
  actionLabel,
  formatDateTime,
  getPlatformOverview,
  listCompanies,
  listPlatformAudit,
  type PlatformAuditEntry,
  type Company,
  type PlatformOverview,
} from "@/lib/super-admin";

/** Super Admin's own dashboard: the company at a glance, his team, and a way into the IT Admin's workspace. */
export default function SuperAdminDashboardPage() {
  const [company, setCompany] = useState("");
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [activity, setActivity] = useState<PlatformAuditEntry[] | null>(null);
  const [error, setError] = useState("");
  // People who signed up on their own. Only the Super Admin sees and places them.
  const [signups, setSignups] = useState<AppUser[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyChoice, setCompanyChoice] = useState("");
  const [placingId, setPlacingId] = useState("");
  const [notice, setNotice] = useState("");

  const loadSignups = () => {
    listUnassignedAgents().then(setSignups).catch(() => setSignups([]));
  };

  const place = async (user: AppUser) => {
    setPlacingId(user.id);
    setError("");
    try {
      await addToOrganization(user.id, companyChoice || undefined);
      setNotice(`${user.full_name} was added to the organization. They can now use their dashboard.`);
      loadSignups();
      getPlatformOverview().then(setOverview).catch(() => undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add this user.");
    } finally {
      setPlacingId("");
    }
  };

  useEffect(() => {
    loadSignups();
    listCompanies()
      .then((rows) => {
        const active = rows.filter((company) => company.status === "ACTIVE");
        setCompanies(active);
        setCompanyChoice(active.length === 1 ? active[0].id : "");
      })
      .catch(() => setCompanies([]));
    getProfile().then((profile) => setCompany(profile.companyName ?? "")).catch(() => undefined);
    getPlatformOverview()
      .then(setOverview)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load the overview."));
    listPlatformAudit({ limit: 8 }).then(setActivity).catch(() => setActivity([]));
  }, []);

  const roles = overview?.users_by_role ?? {};
  const admins = (roles.IT_ADMIN ?? 0) + (roles.SUB_ADMIN ?? 0) + (roles.REPORTING_USER ?? 0);
  const tiles: [string, number | undefined, string, string][] = [
    ["IT Admins", overview ? admins : undefined, "text-blue-600", "/super-admin/work"],
    ["Users", overview ? (roles.IT_AGENT ?? 0) : undefined, "text-teal-600", "/super-admin/work"],
    ["Assets", overview?.assets_total, "text-slate-950", ""],
    ["Open tickets", overview?.pending_tickets, "text-amber-600", ""],
    ["New sign-ups", overview?.unassigned_agents, "text-violet-600", ""],
  ];

  return (
    <main className="mx-auto max-w-[1400px] space-y-5">
      <header className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-violet-600">Super Admin</p>
          <h1 className="mt-0.5 text-2xl font-extrabold tracking-tight text-slate-950">{company || "Your company"}</h1>
          <p className="text-sm text-slate-500">Your team and their work.</p>
        </div>
      </header>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" aria-label="Company at a glance">
        {tiles.map(([label, value, color, href]) => {
          const body = (
            <>
              <p className="text-xs font-semibold text-slate-500">{label}</p>
              <p className={`mt-1 text-3xl font-extrabold ${color}`}>{value ?? "—"}</p>
            </>
          );
          const box = "rounded-xl border border-slate-200 bg-white p-4 shadow-sm";
          // Only the people tiles lead anywhere (to Team work, where each person's work is viewed).
          return href ? (
            <Link key={label} href={href} className={`${box} transition hover:border-violet-200`}>
              {body}
            </Link>
          ) : (
            <div key={label} className={box}>
              {body}
            </div>
          );
        })}
      </section>

      {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>}

      {signups.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-amber-200 bg-white shadow-sm" aria-label="New sign-ups">
          <div className="flex flex-col gap-2 border-b border-amber-100 bg-amber-50/60 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900">New sign-ups ({signups.length})</h2>
              <p className="text-xs text-slate-600">These people registered on their own and are not in an organization yet.</p>
            </div>
            {companies.length > 1 && (
              <label className="text-xs font-semibold text-slate-700">
                Organization
                <select
                  value={companyChoice}
                  onChange={(event) => setCompanyChoice(event.target.value)}
                  className="ml-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-normal"
                >
                  <option value="">Choose…</option>
                  {companies.map((company) => (
                    <option key={company.id} value={company.id}>{company.name}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <ul className="divide-y divide-slate-100">
            {signups.map((user) => (
              <li key={user.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-xs">
                <span className="min-w-0">
                  <span className="block font-semibold text-slate-800">{user.full_name}</span>
                  <span className="block truncate text-slate-500">{user.email}</span>
                </span>
                <button
                  type="button"
                  disabled={placingId === user.id || (companies.length > 1 && !companyChoice)}
                  onClick={() => place(user)}
                  className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-50"
                >
                  {placingId === user.id ? "Adding…" : "Add to organization"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5">
          <h2 className="text-sm font-bold text-slate-900">Recent activity</h2>
          <Link href="/super-admin/audit" className="inline-flex items-center gap-1 text-xs font-semibold text-violet-600 hover:text-violet-700">
            Audit log <ArrowRightIcon className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
        {activity === null ? (
          <p className="p-5 text-xs text-slate-500">Loading…</p>
        ) : activity.length === 0 ? (
          <p className="p-5 text-xs text-slate-500">No activity yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {activity.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-2.5 text-xs">
                <span className="min-w-0">
                  <span className="block font-semibold text-slate-800">{actionLabel(entry.action)}</span>
                  <span className="block truncate text-slate-500">
                    {entry.user_name ?? "System"}
                    {entry.new_value ? ` · ${entry.new_value}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] text-slate-400">{formatDateTime(entry.timestamp)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
