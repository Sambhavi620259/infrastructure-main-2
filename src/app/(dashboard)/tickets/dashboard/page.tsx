"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowPathIcon, ExclamationTriangleIcon, CheckCircleIcon, ClockIcon } from "@heroicons/react/24/outline";
import { listAssetRequests, getAssetRequestCounts, type AssetRequest, type AssetRequestCounts } from "@/lib/tickets";
import { TicketStatusBadge } from "@/components/tickets/ticket-actions";

export default function TicketDashboardPage() {
  const [counts, setCounts] = useState<AssetRequestCounts | null>(null);
  const [recentTickets, setRecentTickets] = useState<AssetRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    Promise.all([
      listAssetRequests({ limit: 200 }),
      getAssetRequestCounts(),
    ])
      .then(([ticketsData, countsData]) => {
        setCounts(countsData);
        setRecentTickets(ticketsData.slice(0, 5));
        setError("");
      })
      .catch((caught) => {
        setCounts(null);
        setRecentTickets([]);
        setError(caught instanceof Error ? caught.message : "Unable to load dashboard.");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <main className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-brand-600">Tickets · Dashboard</p>
          <h1 className="mt-1 text-2xl font-extrabold">Ticket Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">Monitor service requests and incident response across your organization.</p>
        </div>
        <Link
          href="/requests"
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700"
        >
          Open Requests &amp; Approvals
        </Link>
      </header>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {counts && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-500">Pending</p>
                <p className="mt-1 text-2xl font-extrabold text-amber-600">{counts.pending}</p>
              </div>
              <ExclamationTriangleIcon className="h-8 w-8 text-amber-300" />
            </div>
          </article>
          <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-500">In progress</p>
                <p className="mt-1 text-2xl font-extrabold text-blue-600">{counts.in_progress}</p>
              </div>
              <ArrowPathIcon className="h-8 w-8 text-blue-300" />
            </div>
          </article>
          <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-500">Approved · awaiting stock</p>
                <p className="mt-1 text-2xl font-extrabold text-violet-600">{counts.approved}</p>
              </div>
              <ClockIcon className="h-8 w-8 text-violet-300" />
            </div>
          </article>
          <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-500">My open tickets</p>
                <p className="mt-1 text-2xl font-extrabold text-emerald-600">{counts.my_open}</p>
              </div>
              <CheckCircleIcon className="h-8 w-8 text-emerald-300" />
            </div>
          </article>
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-extrabold text-slate-900">Recent Tickets</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {loading ? "Loading…" : `${recentTickets.length} most recent`}
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/tickets"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              View all tickets
            </Link>
            <button
              onClick={load}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700"
            >
              <ArrowPathIcon className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[760px] w-full text-left">
            <thead className="bg-blue-50/70 text-[11px] font-bold text-slate-600">
              <tr>
                <th className="px-5 py-3">Reason</th>
                <th className="px-5 py-3">Requested For</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Category</th>
                <th className="px-5 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recentTickets.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-500">
                    {loading ? "Loading tickets…" : "No tickets found."}
                  </td>
                </tr>
              ) : (
                recentTickets.map((ticket) => (
                  <tr key={ticket.id} className="text-sm hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <span className="font-medium text-slate-900 truncate block max-w-xs">
                        {ticket.reason}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{ticket.requested_by_name ?? ticket.requested_for}</td>
                    <td className="px-5 py-3">
                      <TicketStatusBadge status={ticket.status} ticketType={ticket.ticket_type} />
                    </td>
                    <td className="px-5 py-3 text-slate-600">{ticket.category_name ?? "—"}</td>
                    <td className="px-5 py-3 text-slate-500">
                      {new Date(ticket.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}