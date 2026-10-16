"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  PlusIcon,
  TrashIcon,
  ArchiveBoxIcon,
  ComputerDesktopIcon,
  DocumentChartBarIcon,
  TicketIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";
import { getAssetCounts, listAssetEvents } from "@/lib/assets";
import {
  cancelTicket,
  getAssetRequestCounts,
  isOpenTicket,
  listAssetCategories,
  listAssetRequests,
  type AssetCategory,
  type AssetRequest,
  type AssetRequestCounts,
} from "@/lib/tickets";
import { listDepartments } from "@/lib/users";
import type { Department } from "@/types/user";
import { TicketStatusBadge, ticketNumber } from "@/components/tickets/ticket-actions";
import { NewTicketForm } from "@/components/tickets/ticket-queue";
import { listInventoryRequests } from "@/lib/inventory";
import { mySoftware } from "@/lib/software";
import { getProfile, type Profile } from "@/lib/profile";
import { userPageOnPlan } from "@/lib/access";
import { assetStatusLabel, type AssetCounts, type AssetEvent, assetLabel } from "@/types/asset";

const QUICK_ACTIONS = [
  ["/agent/tickets", "Request an asset", "Raise a ticket and follow its status", TicketIcon],
  ["/agent/assets", "Update an asset", "Change status, condition or location", ComputerDesktopIcon],
  ["/agent/inventory", "Request stock", "Ask for cables, mice and other consumables", ArchiveBoxIcon],
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
  const [stockWaiting, setStockWaiting] = useState<number | null>(null);
  const [softwareCount, setSoftwareCount] = useState<number | null>(null);
  const [events, setEvents] = useState<AssetEvent[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    // Each panel loads on its own so one failing request does not blank the page.
    const fail = (caught: unknown) =>
      setError(caught instanceof Error ? caught.message : "Some dashboard data could not be loaded.");
    // Software and stock requests load only when the organization's plan includes them.
    getProfile()
      .then((data) => {
        setProfile(data);
        if (userPageOnPlan("/agent/software", data.planFeatures)) {
          mySoftware().then((seats) => setSoftwareCount(seats.length)).catch(fail);
        }
        if (userPageOnPlan("/agent/inventory", data.planFeatures)) {
          listInventoryRequests("PENDING")
            .then((requests) => setStockWaiting(requests.length))
            .catch(fail);
        }
      })
      .catch(fail);
    getAssetCounts().then(setAssets).catch(fail);
    getAssetRequestCounts().then(setTickets).catch(fail);
    listAssetEvents({ limit: 6 }).then(setEvents).catch(fail);
  }, []);

  const onPlan = (href: string) => profile !== null && userPageOnPlan(href, profile.planFeatures);

  const refreshTicketCounts = useCallback(() => {
    getAssetRequestCounts().then(setTickets).catch(() => undefined);
  }, []);

  // All counts cover only this user's own assets (the API scopes them).
  const byStatus = assets?.by_status;
  const metrics: [string, number | undefined, string][] = [
    ["My assets", assets?.total, "text-slate-950"],
    ...(onPlan("/agent/software") ? [["My software", softwareCount ?? undefined, "text-indigo-600"] as [string, number | undefined, string]] : []),
    ["Working", byStatus ? byStatus.ASSIGNED + byStatus.IN_USE : undefined, "text-emerald-600"],
    ["In repair", assets?.in_repair, "text-amber-600"],
    ["Damaged or lost", byStatus ? byStatus.DAMAGED + byStatus.LOST : undefined, "text-rose-600"],
  ];

  const today = new Date().toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short" });

  return (
    <main className="mx-auto max-w-[1400px] space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold text-brand-600">
            User{profile?.companyName ? ` · ${profile.companyName}` : ""}
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

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {metrics.map(([label, value, color]) => (
          <Link key={label} href={label === "My software" ? "/agent/software" : "/agent/assets"} className="ui-surface p-4 transition hover:border-brand-200">
            <p className="text-[10px] text-slate-500">{label}</p>
            <p className={`mt-1 text-2xl font-extrabold ${color}`}>{value ?? "—"}</p>
          </Link>
        ))}
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Link href="/agent/tickets" className="ui-surface flex items-center gap-3 p-4 transition hover:border-brand-200">
          <TicketIcon className="h-6 w-6 text-amber-500" aria-hidden="true" />
          <div>
            <p className="text-xl font-extrabold">{tickets?.open ?? "—"}</p>
            <p className="text-[10px] text-slate-500">Your open tickets</p>
          </div>
        </Link>
        <Link href="/agent/tickets" className="ui-surface flex items-center gap-3 p-4 transition hover:border-brand-200">
          <WrenchScrewdriverIcon className="h-6 w-6 text-emerald-500" aria-hidden="true" />
          <div>
            <p className="text-xl font-extrabold">
              {tickets ? tickets.approved + (tickets.waiting_inventory ?? 0) + (tickets.waiting_license ?? 0) : "—"}
            </p>
            <p className="text-[10px] text-slate-500">Approved or waiting for stock / license</p>
          </div>
        </Link>
        {onPlan("/agent/inventory") && (
          <Link href="/agent/inventory" className="ui-surface flex items-center gap-3 p-4 transition hover:border-brand-200">
            <ArchiveBoxIcon className="h-6 w-6 text-violet-500" aria-hidden="true" />
            <div>
              <p className="text-xl font-extrabold">{stockWaiting ?? "—"}</p>
              <p className="text-[10px] text-slate-500">Stock requests waiting for approval</p>
            </div>
          </Link>
        )}
      </section>

      <section className="grid gap-3 xl:grid-cols-[1.3fr_1fr]">
        <MyTicketsCard onChanged={refreshTicketCounts} />

        <article className="ui-surface overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-bold">Activity on my assets</h2>
          </div>
          {events.length === 0 ? (
            <p className="p-6 text-center text-xs text-slate-500">No activity on your assets yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {events.map((event) => (
                <li key={event.id} className="px-4 py-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-700">
                      {event.asset_tag ?? "Untagged"} · {EVENT_LABEL[event.action] ?? event.action}
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
          {QUICK_ACTIONS.filter(([href]) => onPlan(href)).map(([href, title, text, Icon]) => (
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

/** The user's open tickets, with "New ticket" and "Remove" (cancel) right on the dashboard. */
function MyTicketsCard({ onChanged }: { onChanged: () => void }) {
  const [tickets, setTickets] = useState<AssetRequest[]>([]);
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    // The API returns only this user's tickets.
    listAssetRequests({ limit: 50 })
      // Open tickets, and resolved ones waiting for the user to confirm.
      .then((data) => setTickets(data.filter((ticket) => isOpenTicket(ticket.status) || ticket.status === "FULFILLED").slice(0, 6)))
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load your tickets."));
  }, [refreshKey]);

  useEffect(() => {
    if (!formOpen || categories.length > 0) return;
    listAssetCategories().then(setCategories).catch(() => undefined);
    listDepartments().then(setDepartments).catch(() => undefined);
  }, [formOpen, categories.length]);

  const changed = (message: string) => {
    setNotice(message);
    setError("");
    setRefreshKey((key) => key + 1);
    onChanged();
  };

  const remove = async (ticket: AssetRequest) => {
    setBusy(true);
    try {
      await cancelTicket(ticket.id);
      setConfirming(null);
      changed(`Ticket ${ticketNumber(ticket)} removed.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not remove the ticket.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="ui-surface overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-bold">My open tickets</h2>
        <div className="flex items-center gap-3">
          <Link href="/agent/tickets" className="text-xs font-semibold text-brand-600 hover:text-brand-700">
            All my tickets →
          </Link>
          <button
            type="button"
            onClick={() => {
              setFormOpen(true);
              setNotice("");
            }}
            disabled={formOpen}
            className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            <PlusIcon className="h-4 w-4" aria-hidden="true" /> New ticket
          </button>
        </div>
      </div>

      {formOpen && (
        <div className="border-b border-slate-100 p-3">
          <NewTicketForm
            categories={categories}
            onCategoryCreated={(category) => setCategories((current) => [...current, category])}
            departments={departments}
            users={[]}
            forOthers={false}
            onCancel={() => setFormOpen(false)}
            onCreated={(ticket) => {
              setFormOpen(false);
              changed(`Ticket ${ticketNumber(ticket)} raised. Your IT Admin has been notified.`);
            }}
          />
        </div>
      )}

      {notice && (
        <p role="status" className="border-b border-emerald-100 bg-emerald-50 px-4 py-2 text-xs text-emerald-800">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-800">
          {error}
        </p>
      )}

      {tickets.length === 0 ? (
        <p className="p-6 text-center text-xs text-slate-500">No open tickets. Need something? Choose New ticket.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {tickets.map((ticket) => (
            <li key={ticket.id} className="flex items-start justify-between gap-3 px-4 py-3 text-xs">
              <div className="min-w-0">
                <Link href={`/agent/tickets/${ticket.id}`} className="block font-semibold text-slate-700 hover:text-brand-700">
                  {ticketNumber(ticket)} ·{" "}
                  {ticket.ticket_type === "ACCESS"
                    ? `${ticket.access_level} access to ${ticket.access_resource_name}`
                    : ticket.ticket_type === "SOFTWARE"
                      ? ticket.software_name ?? "Software"
                      : ticket.asset
                        ? `Problem with ${assetLabel(ticket.asset)}`
                        : (ticket.category_name ?? "Asset request")}
                </Link>
                {ticket.status === "FULFILLED" && (
                  <Link href={`/agent/tickets/${ticket.id}`} className="text-[11px] font-semibold text-emerald-700">
                    Resolved: confirm or reopen
                  </Link>
                )}
                <p className="truncate text-slate-500">{ticket.reason}</p>
                <p className="text-[11px] text-slate-400">{timeAgo(ticket.created_at)}</p>
              </div>
              <span className="flex shrink-0 flex-col items-end gap-1.5">
                <TicketStatusBadge status={ticket.status} ticketType={ticket.ticket_type} />
                {ticket.status === "FULFILLED" ? null : confirming === ticket.id ? (
                  <span className="flex items-center gap-2">
                    <span className="font-semibold text-slate-600">Remove?</span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => remove(ticket)}
                      className="rounded-md bg-rose-600 px-2 py-1 font-bold text-white hover:bg-rose-700 disabled:opacity-60"
                    >
                      {busy ? "…" : "Yes"}
                    </button>
                    <button type="button" onClick={() => setConfirming(null)} className="font-semibold text-slate-500">
                      No
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirming(ticket.id)}
                    className="inline-flex items-center gap-1 font-semibold text-rose-600 hover:text-rose-700"
                  >
                    <TrashIcon className="h-3.5 w-3.5" aria-hidden="true" /> Remove
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
