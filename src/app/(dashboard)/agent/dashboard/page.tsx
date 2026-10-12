"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArchiveBoxIcon,
  ComputerDesktopIcon,
  DocumentChartBarIcon,
  ExclamationTriangleIcon,
  TicketIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";
import { getAssetCounts, listAssetEvents } from "@/lib/assets";
import { getAssetRequestCounts, listAssetRequests, type AssetRequest, type AssetRequestCounts } from "@/lib/tickets";
import { getInventoryCounts, type InventoryCounts } from "@/lib/inventory";
import { getProfile, type Profile } from "@/lib/profile";
import { assetStatusLabel, type AssetCounts, type AssetEvent } from "@/types/asset";

const QUICK_ACTIONS = [
  ["/agent/tickets", "Work the ticket queue", "Approve or reject asset requests", TicketIcon],
  ["/agent/assets", "Hand over an asset", "Assign, unassign or update status", ComputerDesktopIcon],
  ["/agent/inventory", "Issue stock", "Record consumables in and out", ArchiveBoxIcon],
  ["/agent/reports", "Run a report", "Download a CSV export", DocumentChartBarIcon],
] as const;

const EVENT_LABEL: Record<string, string> = {
  CREATED: "Registered",
  ASSIGNED: "Assigned",
  ASSIGNED_VIA_REQUEST: "Assigned from ticket",
  UNASSIGNED: "Returned to stock",
  STATUS_CHANGE: "Status changed",
};

function timeAgo(value: string): string {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (Number.isNaN(minutes)) return "—";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
  return new Date(value).toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

export default function AgentDashboardPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [assets, setAssets] = useState<AssetCounts | null>(null);
  const [tickets, setTickets] = useState<AssetRequestCounts | null>(null);
  const [inventory, setInventory] = useState<InventoryCounts | null>(null);
  const [pending, setPending] = useState<AssetRequest[]>([]);
  const [events, setEvents] = useState<AssetEvent[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    // Each panel loads on its own so one failing request does not blank the page.
    const fail = (caught: unknown) =>
      setError(caught instanceof Error ? caught.message : "Some dashboard data could not be loaded.");
    getProfile().then(setProfile).catch(fail);
    getAssetCounts().then(setAssets).catch(fail);
    getAssetRequestCounts().then(setTickets).catch(fail);
    getInventoryCounts().then(setInventory).catch(fail);
    listAssetRequests({ status: "PENDING", limit: 5 }).then(setPending).catch(fail);
    listAssetEvents({ limit: 6 }).then(setEvents).catch(fail);
  }, []);

  const metrics: [string, number | undefined, string][] = [
    ["Total assets", assets?.total, "text-slate-950"],
    ["Assigned", assets?.assigned, "text-emerald-600"],
    ["In stock", assets?.in_stock, "text-blue-600"],
    ["In repair", assets?.in_repair, "text-amber-600"],
  ];

  const today = new Date().toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short" });

  return (
    <main className="mx-auto max-w-[1400px] space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold text-brand-600">
            IT Agent{profile?.companyName ? ` · ${profile.companyName}` : ""}
          </p>
          <h1 className="mt-0.5 text-2xl font-extrabold tracking-tight text-slate-950">
            Welcome back{profile ? `, ${profile.name.split(" ")[0]}` : ""}!
          </h1>
          <p className="mt-1 text-xs text-slate-500">Here&apos;s what needs your attention today.</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700">{today}</div>
      </header>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-800">
          {error}
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(([label, value, color]) => (
          <Link key={label} href="/agent/assets" className="ui-surface p-4 transition hover:border-brand-200">
            <p className="text-[10px] text-slate-500">{label}</p>
            <p className={`mt-1 text-2xl font-extrabold ${color}`}>{value ?? "—"}</p>
          </Link>
        ))}
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <Link href="/agent/tickets" className="ui-surface flex items-center gap-3 p-4 transition hover:border-brand-200">
          <TicketIcon className="h-6 w-6 text-amber-500" aria-hidden="true" />
          <div>
            <p className="text-xl font-extrabold">{tickets?.pending ?? "—"}</p>
            <p className="text-[10px] text-slate-500">Tickets waiting for a decision</p>
          </div>
        </Link>
        <Link href="/agent/tickets" className="ui-surface flex items-center gap-3 p-4 transition hover:border-brand-200">
          <WrenchScrewdriverIcon className="h-6 w-6 text-emerald-500" aria-hidden="true" />
          <div>
            <p className="text-xl font-extrabold">{tickets?.my_open ?? "—"}</p>
            <p className="text-[10px] text-slate-500">Open tickets you raised</p>
          </div>
        </Link>
        <Link href="/agent/inventory" className="ui-surface flex items-center gap-3 p-4 transition hover:border-brand-200">
          <ExclamationTriangleIcon className="h-6 w-6 text-rose-500" aria-hidden="true" />
          <div>
            <p className="text-xl font-extrabold">{inventory?.low_stock ?? "—"}</p>
            <p className="text-[10px] text-slate-500">Inventory items low on stock</p>
          </div>
        </Link>
      </section>

      <section className="grid gap-3 xl:grid-cols-[1.3fr_1fr]">
        <article className="ui-surface overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-bold">Pending tickets</h2>
            <Link href="/agent/tickets" className="text-xs font-semibold text-brand-600 hover:text-brand-700">
              Open queue →
            </Link>
          </div>
          {pending.length === 0 ? (
            <p className="p-6 text-center text-xs text-slate-500">No tickets are waiting. Nice work.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {pending.map((ticket) => (
                <li key={ticket.id} className="flex items-start justify-between gap-3 px-4 py-3 text-xs">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-700">
                      {ticket.category_name ?? "Asset request"} · {ticket.requested_by_name ?? ticket.requested_for}
                    </p>
                    <p className="truncate text-slate-500">{ticket.reason}</p>
                  </div>
                  <span className="shrink-0 text-[11px] text-slate-400">{timeAgo(ticket.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="ui-surface overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-bold">Recent asset activity</h2>
          </div>
          {events.length === 0 ? (
            <p className="p-6 text-center text-xs text-slate-500">No asset activity yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {events.map((event) => (
                <li key={event.id} className="px-4 py-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-700">
                      {event.asset_tag} · {EVENT_LABEL[event.action] ?? event.action}
                    </span>
                    <span className="text-[11px] text-slate-400">{timeAgo(event.timestamp)}</span>
                  </div>
                  <p className="text-slate-500">
                    {event.previous_status ? `${assetStatusLabel(event.previous_status)} → ` : ""}
                    {assetStatusLabel(event.new_status)}
                    {event.performed_by_name ? ` · by ${event.performed_by_name}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-bold">Quick actions</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {QUICK_ACTIONS.map(([href, title, text, Icon]) => (
            <Link key={href} href={href} className="ui-surface flex items-start gap-3 p-4 transition hover:border-brand-200">
              <Icon className="h-5 w-5 shrink-0 text-brand-600" aria-hidden="true" />
              <span>
                <span className="block text-xs font-bold text-slate-800">{title}</span>
                <span className="block text-[11px] text-slate-500">{text}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
