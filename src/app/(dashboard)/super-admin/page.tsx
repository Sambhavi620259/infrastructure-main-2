"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  BuildingOffice2Icon,
  ComputerDesktopIcon,
  TicketIcon,
  UsersIcon,
} from "@heroicons/react/24/outline";
import {
  PLANS,
  actionLabel,
  formatDateTime,
  getPlatformOverview,
  listPlatformAudit,
  planLabel,
  type PlatformAuditEntry,
  type PlatformOverview,
} from "@/lib/super-admin";

const ROLE_LABELS: [string, string][] = [
  ["IT_ADMIN", "IT Admins"],
  ["IT_AGENT", "Users"],
  ["SUB_ADMIN", "Sub-admins"],
  ["REPORTING_USER", "Reporting users"],
  ["SUPER_ADMIN", "Super Admins"],
];

export default function SuperAdminOverviewPage() {
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [activity, setActivity] = useState<PlatformAuditEntry[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    getPlatformOverview()
      .then(setOverview)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load the platform overview."));
    listPlatformAudit({ limit: 8 })
      .then(setActivity)
      .catch(() => undefined);
  }, []);

  const stats: [string, number | undefined, string, typeof UsersIcon][] = [
    ["Organizations", overview?.companies_total, `${overview?.companies_new_this_month ?? 0} new this month`, BuildingOffice2Icon],
    ["Active users", overview?.users_total, `${overview?.unassigned_agents ?? 0} users awaiting an organization`, UsersIcon],
    ["Assets managed", overview?.assets_total, "Across all organizations", ComputerDesktopIcon],
    ["Pending tickets", overview?.pending_tickets, "Waiting for a decision", TicketIcon],
  ];

  const planTotal = overview ? Object.values(overview.plans).reduce((sum, n) => sum + n, 0) : 0;

  return (
    <main className="mx-auto max-w-[1400px] space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-violet-600">Platform control center</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">Super Admin workspace</h1>
          <p className="mt-1 text-sm text-slate-500">Organizations, subscriptions and activity across the platform.</p>
        </div>
      </header>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map(([label, value, hint, Icon]) => (
          <article key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[11px] font-semibold text-slate-500">{label}</p>
                <p className="mt-1 text-xl font-extrabold tracking-tight text-slate-950">{value ?? "—"}</p>
              </div>
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-blue-50 text-brand-600">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
            </div>
            <p className="mt-3 text-[11px] font-semibold text-slate-500">{hint}</p>
          </article>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
        <article className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Newest organizations</h2>
              <p className="mt-0.5 text-[11px] text-slate-500">Plan, status and usage.</p>
            </div>
            <Link href="/super-admin/companies" className="text-[11px] font-bold text-brand-600">
              View all →
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left">
              <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-2.5">Organization</th>
                  <th className="px-4 py-2.5">Plan</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Users</th>
                  <th className="px-4 py-2.5">Assets</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(overview?.recent_companies ?? []).map((company) => (
                  <tr key={company.id} className="text-xs">
                    <td className="px-4 py-3">
                      <p className="font-bold text-slate-800">{company.name}</p>
                      <p className="text-[11px] text-slate-500">{company.primary_admin?.email ?? "No IT Admin yet"}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{company.subscription ? planLabel(company.subscription.plan) : "—"}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          company.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                        }`}
                      >
                        {company.status === "ACTIVE" ? "Active" : "Suspended"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {company.active_users}
                      {company.subscription ? ` / ${company.subscription.user_limit}` : ""}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{company.assets}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {overview && overview.recent_companies.length === 0 && (
              <p className="p-6 text-center text-xs text-slate-500">No organizations yet.</p>
            )}
          </div>
        </article>

        <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-bold text-slate-900">Plans</h2>
          <p className="mt-0.5 text-[11px] text-slate-500">Organizations on each plan.</p>
          <div className="mt-4 space-y-4">
            {PLANS.map((plan) => {
              const count = overview?.plans[plan] ?? 0;
              const percent = planTotal ? Math.round((count / planTotal) * 100) : 0;
              return (
                <div key={plan}>
                  <div className="flex justify-between text-xs">
                    <span className="font-bold text-slate-800">{planLabel(plan)}</span>
                    <span className="text-slate-500">
                      {count} · {percent}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100" role="presentation">
                    <div className="h-full rounded-full bg-brand-600" style={{ width: `${percent}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <h3 className="mt-6 text-xs font-bold text-slate-900">Users by role</h3>
          <ul className="mt-2 space-y-1.5 text-xs">
            {ROLE_LABELS.map(([key, label]) => (
              <li key={key} className="flex justify-between">
                <span className="text-slate-600">{label}</span>
                <span className="font-bold text-slate-800">{overview?.users_by_role[key] ?? 0}</span>
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5">
          <h2 className="text-sm font-bold text-slate-900">Recent platform activity</h2>
          <Link href="/super-admin/audit" className="text-[11px] font-bold text-brand-600">
            Audit log →
          </Link>
        </div>
        {activity.length === 0 ? (
          <p className="p-6 text-center text-xs text-slate-500">No activity recorded yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {activity.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-1 px-4 py-3 text-xs sm:flex-row sm:items-center sm:justify-between">
                <span>
                  <span className="font-bold text-slate-800">{actionLabel(entry.action)}</span>
                  <span className="text-slate-500">
                    {" "}
                    · {entry.user_name ?? "System"}
                    {entry.company_name ? ` · ${entry.company_name}` : ""}
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
