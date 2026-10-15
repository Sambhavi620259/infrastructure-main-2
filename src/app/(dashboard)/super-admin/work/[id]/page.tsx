"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getUserActivity, type UserActivity } from "@/lib/users";
import { actionLabel, formatDateTime } from "@/lib/super-admin";
import { initialsOf, roleBadgeClass, roleLabel, statusBadgeClass } from "@/types/user";

/** Super Admin: one IT Admin's or user's work, read-only. */
export default function PersonWorkPage() {
  const params = useParams<{ id: string }>();
  const userId = typeof params.id === "string" ? params.id : "";
  const [activity, setActivity] = useState<UserActivity | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!userId) return;
    getUserActivity(userId)
      .then(setActivity)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load this person's work."));
  }, [userId]);

  const back = (
    <Link href="/super-admin/work" className="inline-flex text-sm font-semibold text-brand-600 hover:text-brand-700">
      ← Back to team work
    </Link>
  );

  if (!activity) {
    return (
      <main className="mx-auto max-w-7xl space-y-4">
        {back}
        {error ? (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
        ) : (
          <p className="text-sm text-slate-500">Loading…</p>
        )}
      </main>
    );
  }

  const { user, summary } = activity;
  const isUser = user.role === "EMPLOYEE";
  // Users raise tickets and hold assets; admins handle tickets, assets, stock and reports.
  const tiles: [string, number][] = isUser
    ? [
        ["Tickets raised", summary.tickets_raised],
        ["Still open", summary.tickets_raised_pending],
        ["Assets held now", summary.assets_held],
        ["Reports generated", summary.reports_generated],
      ]
    : [
        ["Tickets in progress", summary.tickets_in_progress],
        ["Tickets approved / fulfilled", summary.tickets_approved],
        ["Tickets rejected", summary.tickets_rejected],
        ["Assets assigned", summary.assets_assigned],
        ["Assets returned", summary.assets_unassigned],
        ["Asset updates", summary.asset_status_changes],
        ["Stock adjustments", summary.stock_adjustments],
        ["Reports generated", summary.reports_generated],
      ];

  return (
    <main className="mx-auto max-w-7xl space-y-5">
      {back}

      <header className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-brand-50 text-base font-bold text-brand-700">
            {initialsOf(user.full_name)}
          </span>
          <div>
            <h1 className="text-xl font-extrabold text-slate-950">{user.full_name}</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              {user.email}
              {user.agent_id ? ` · ${user.agent_id}` : ""}
            </p>
            <p className="mt-1 flex flex-wrap gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${roleBadgeClass(user.role)}`}>{roleLabel(user.role)}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statusBadgeClass(user.status)}`}>{user.status}</span>
            </p>
          </div>
        </div>
        <p className="text-sm text-slate-500 sm:text-right">
          Last active <span className="font-semibold text-slate-800">{formatDateTime(activity.last_active_at)}</span>
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold text-slate-500">{label}</p>
            <p className="mt-1 text-2xl font-extrabold text-slate-900">{value}</p>
          </div>
        ))}
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-bold text-slate-900">Recent work</h2>
        </div>
        {activity.recent.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">No recorded work yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {activity.recent.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 text-sm">
                <span className="min-w-0">
                  <span className="block font-semibold text-slate-800">{actionLabel(entry.action)}</span>
                  <span className="block truncate text-xs text-slate-500">{entry.new_value ?? entry.old_value ?? entry.entity}</span>
                </span>
                <span className="text-xs text-slate-400">{formatDateTime(entry.timestamp)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
