"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArchiveBoxIcon,
  ArrowRightIcon,
  ChartBarIcon,
  CheckCircleIcon,
  CubeIcon,
  ExclamationTriangleIcon,
  InboxStackIcon,
  PlusIcon,
  ShieldExclamationIcon,
  TicketIcon,
  UserPlusIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";
import { getDashboardMetrics } from "@/lib/assets";
import { sectionsFor, type Section } from "@/lib/access";
import { listInventoryRequests, listMovements, type InventoryRequest, type StockMovement } from "@/lib/inventory";
import { getProfile, type Profile } from "@/lib/profile";
import { getAssetRequestCounts, isOpenTicket, listAssetRequests, type AssetRequest, type AssetRequestCounts } from "@/lib/tickets";
import { listUnassignedAgents } from "@/lib/users";
import { listWarrantyCoverage, type WarrantyCoverage } from "@/lib/warranty";
import { assetLabel, formatDate, type DashboardMetrics } from "@/types/asset";
import type { AppUser } from "@/types/user";
import { TicketStatusBadge, TicketTypeChip, ticketNumber } from "@/components/tickets/ticket-actions";

const MOVEMENT_LABEL: Record<string, string> = {
  RECEIPT: "Received",
  REGISTER: "Registered",
  ASSIGN: "Assigned",
  RETURN: "Returned",
  TRANSFER: "Transferred",
  ISSUE: "Issued",
  ADJUSTMENT: "Adjusted",
  REPAIR: "Sent for repair",
  RETIRE: "Retired",
};

function timeAgo(value: string): string {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (Number.isNaN(minutes)) return "—";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
  return new Date(value).toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/**
 * IT workspace overview: what needs the admin's attention (tickets, problems,
 * stock requests, sign-ups, low stock, expiring warranties), asset numbers,
 * recent activity and shortcuts. Panels appear only for the sections the
 * signed-in role can use, and each loads on its own.
 */
export default function DashboardPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [ticketCounts, setTicketCounts] = useState<AssetRequestCounts | null>(null);
  const [openTickets, setOpenTickets] = useState<AssetRequest[] | null>(null);
  const [stockRequests, setStockRequests] = useState<InventoryRequest[] | null>(null);
  const [signups, setSignups] = useState<AppUser[] | null>(null);
  const [expiring, setExpiring] = useState<WarrantyCoverage[] | null>(null);
  const [movements, setMovements] = useState<StockMovement[] | null>(null);

  useEffect(() => {
    getProfile().then(setProfile).catch(() => undefined);
  }, []);

  const sections = useMemo<Set<Section>>(
    () => (profile ? sectionsFor(profile.role, profile.modules) : new Set()),
    [profile],
  );
  const isAdmin = profile?.role === "IT_ADMIN" || profile?.role === "SUPER_ADMIN";

  useEffect(() => {
    if (!profile) return;
    getDashboardMetrics().then(setMetrics).catch(() => undefined);
    if (sections.has("assets")) {
      listMovements({ limit: 8 }).then(setMovements).catch(() => setMovements([]));
      listWarrantyCoverage({ coverage: "EXPIRING", expiring_days: 30 })
        .then(setExpiring)
        .catch(() => setExpiring([]));
    }
    if (sections.has("tickets")) {
      getAssetRequestCounts().then(setTicketCounts).catch(() => undefined);
      listAssetRequests({ limit: 100 })
        .then((data) => setOpenTickets(data.filter((ticket) => isOpenTicket(ticket.status))))
        .catch(() => setOpenTickets([]));
    }
    if (sections.has("inventory")) {
      listInventoryRequests("PENDING").then(setStockRequests).catch(() => setStockRequests([]));
    }
    if (isAdmin) listUnassignedAgents().then(setSignups).catch(() => setSignups([]));
  }, [profile, sections, isAdmin]);

  const problems = openTickets?.filter((ticket) => ticket.ticket_type === "ISSUE").length;
  const firstName = profile?.name.split(" ")[0] ?? "";
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

  const seats = metrics?.license_seats ?? 0;
  const seatsUsed = metrics?.license_seats_assigned ?? 0;
  const kpis: [string, number | string | undefined, string, string][] = [
    ["Hardware assets", metrics?.total_assets, "text-slate-950", "/assets"],
    ["Available", metrics?.in_stock_assets, "text-emerald-600", "/inventory/hardware"],
    ["Assigned", metrics?.assigned_assets, "text-blue-600", "/assets/assignment"],
    ["Under repair", metrics?.under_maintenance, "text-amber-600", "/maintenance"],
    ["Software products", metrics?.software_products, "text-slate-950", "/assets/software"],
    ["License utilization", metrics ? (seats ? `${Math.round((seatsUsed / seats) * 100)}%` : "—") : undefined, "text-indigo-600", "/inventory/software"],
  ];

  const attention: [string, number | undefined, string, typeof TicketIcon, string, boolean][] = [
    ["Pending approvals", metrics?.pending_approvals ?? ticketCounts?.pending, "Tickets, stock and POs", TicketIcon, "/requests", sections.has("tickets")],
    ["Problems to resolve", problems, "Reported on users' assets", WrenchScrewdriverIcon, "/requests", sections.has("tickets")],
    ["Stock requests", stockRequests?.length, "Waiting for approval", InboxStackIcon, "/requests?tab=stock", sections.has("inventory")],
    ["New sign-ups", signups?.length, "Users to add", UserPlusIcon, "/users", isAdmin],
    ["Low stock items", metrics?.low_stock_alerts, "At or below reorder level", ArchiveBoxIcon, "/inventory/movements?tab=consumables", sections.has("inventory")],
    ["Warranties ending", expiring?.length, "In the next 30 days", ShieldExclamationIcon, "/assets/warranty", sections.has("assets")],
  ];

  const quickActions: [string, string, string, typeof CubeIcon, boolean][] = [
    ["/inventory/hardware", "Receive stock", "Record a delivery against an approved PO", CubeIcon, sections.has("inventory") && profile?.role !== "REPORTING_USER"],
    ["/assets/new", "Register an asset", "A device, or a software license", CubeIcon, sections.has("assets") && profile?.role !== "REPORTING_USER"],
    ["/assets/assignment", "Assign an asset", "Hand stock to a user or take it back", CheckCircleIcon, sections.has("assets") && profile?.role !== "REPORTING_USER"],
    ["/users/new", "Create a user", "Set up an account with a password", UserPlusIcon, isAdmin],
    ["/reports", "Run a report", "Download a CSV export", ChartBarIcon, sections.has("reports")],
  ];

  return (
    <main className="mx-auto max-w-[1400px] space-y-5">
      <header className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          {profile?.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a small data URL, not a remote image
            <img src={profile.avatarUrl} alt="" className="hidden h-14 w-14 shrink-0 rounded-2xl object-cover sm:block" />
          ) : (
            <span className="hidden h-14 w-14 shrink-0 place-items-center rounded-2xl bg-brand-50 text-lg font-extrabold text-brand-700 sm:grid">
              {profile ? initials(profile.name) : ""}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-[11px] font-bold uppercase tracking-[0.14em] text-brand-600">
              {profile?.companyName ?? "IT operations"}
              <span className="hidden sm:inline"> · {today}</span>
            </p>
            <h1 className="mt-0.5 text-2xl font-extrabold tracking-tight text-slate-950">
              Welcome back{firstName ? `, ${firstName}` : ""}!
            </h1>
            <p className="text-sm text-slate-500">Here is what needs your attention today.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {sections.has("tickets") && (
            <Link href="/requests" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
              <TicketIcon className="h-4 w-4" aria-hidden="true" /> Requests &amp; Approvals
            </Link>
          )}
          {sections.has("assets") && profile?.role !== "REPORTING_USER" && (
            <Link href="/assets/new" className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-bold text-white shadow-sm hover:bg-brand-700">
              <PlusIcon className="h-4 w-4" aria-hidden="true" /> Add asset
            </Link>
          )}
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" aria-label="Assets and licenses">
        {kpis.map(([label, value, color, href]) => (
          <Link key={label} href={href} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-brand-200">
            <p className="text-xs font-semibold text-slate-500">{label}</p>
            <p className={`mt-1 text-3xl font-extrabold ${color}`}>{value ?? "—"}</p>
            {label === "License utilization" && metrics && (
              <p className="text-[11px] text-slate-500">{seatsUsed} of {seats} seats</p>
            )}
          </Link>
        ))}
      </section>

      <section aria-label="Needs your attention">
        <h2 className="mb-2 text-sm font-bold text-slate-900">Needs your attention</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {attention
            .filter(([, , , , , show]) => show)
            .map(([label, value, hint, Icon, href]) => {
              const hot = (value ?? 0) > 0;
              return (
                <Link
                  key={label}
                  href={href}
                  className={`rounded-xl border p-4 shadow-sm transition hover:border-brand-200 ${hot ? "border-amber-200 bg-amber-50/60" : "border-slate-200 bg-white"}`}
                >
                  <div className="flex items-center justify-between">
                    <Icon className={`h-5 w-5 ${hot ? "text-amber-600" : "text-slate-400"}`} aria-hidden="true" />
                    <span className={`text-2xl font-extrabold ${hot ? "text-amber-700" : "text-slate-900"}`}>{value ?? "—"}</span>
                  </div>
                  <p className="mt-2 text-xs font-bold text-slate-800">{label}</p>
                  <p className="text-[11px] text-slate-500">{hint}</p>
                </Link>
              );
            })}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        {sections.has("tickets") && (
          <Panel title="Open requests" href="/requests" linkLabel="Requests & Approvals" count={openTickets?.length}>
            {openTickets === null ? (
              <Loading />
            ) : openTickets.length === 0 ? (
              <Empty text="No open tickets. All caught up." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {openTickets.slice(0, 7).map((ticket) => (
                  <li key={ticket.id} className="flex items-start justify-between gap-3 px-4 py-3 text-xs">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-1.5 font-semibold text-slate-800">
                        <span className="font-mono">{ticketNumber(ticket)}</span>
                        <TicketTypeChip ticketType={ticket.ticket_type} />
                        <span>{ticket.requested_by_name ?? ticket.requested_for}</span>
                      </p>
                      <p className="mt-0.5 truncate text-slate-500">
                        {ticket.asset ? `${assetLabel(ticket.asset)} · ` : ticket.category_name ? `${ticket.category_name} · ` : ""}
                        {ticket.reason}
                      </p>
                    </div>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <TicketStatusBadge status={ticket.status} ticketType={ticket.ticket_type} />
                      <span className="text-[11px] text-slate-400">{timeAgo(ticket.created_at)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        <div className="space-y-4">
          {sections.has("inventory") && (
            <Panel title="Stock requests waiting" href="/requests?tab=stock" linkLabel="Review" count={stockRequests?.length}>
              {stockRequests === null ? (
                <Loading />
              ) : stockRequests.length === 0 ? (
                <Empty text="No stock requests waiting." />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {stockRequests.slice(0, 4).map((request) => {
                    const short = request.available !== null && request.available < request.quantity;
                    return (
                      <li key={request.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs">
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-800">
                            {request.quantity} × {request.item_name}
                          </p>
                          <p className="truncate text-slate-500">
                            {request.requested_by_name} · {request.reason}
                          </p>
                        </div>
                        <span className={`shrink-0 text-[11px] font-semibold ${short ? "text-rose-600" : "text-slate-500"}`}>
                          {request.available ?? "—"} in stock
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          )}

          {isAdmin && signups !== null && signups.length > 0 && (
            <Panel title="New sign-ups" href="/users" linkLabel="Add to organization" count={signups.length}>
              <ul className="divide-y divide-slate-100">
                {signups.slice(0, 4).map((user) => (
                  <li key={user.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs">
                    <span className="min-w-0">
                      <span className="block font-semibold text-slate-800">{user.full_name}</span>
                      <span className="block truncate text-slate-500">{user.email}</span>
                    </span>
                    <span className="shrink-0 text-[11px] text-slate-400">{timeAgo(user.created_at)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </section>

      {sections.has("assets") && (
        <section className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <Panel title="Recent assignments & stock movements" href="/inventory/movements" linkLabel="All movements">
            {movements === null ? (
              <Loading />
            ) : movements.length === 0 ? (
              <Empty text="No stock movements yet." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {movements.map((m) => (
                  <li key={m.id} className="px-4 py-2.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-800">
                        {MOVEMENT_LABEL[m.movement_type] ?? m.movement_type} · {m.asset_label ?? m.item_name ?? "Hardware"}
                      </span>
                      <span className="shrink-0 text-[11px] text-slate-400">{m.created_at ? timeAgo(m.created_at) : ""}</span>
                    </div>
                    <p className="truncate text-slate-500">
                      {m.reason ?? ""}
                      {m.performed_by_name ? ` · by ${m.performed_by_name}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Warranties ending soon" href="/assets/warranty" linkLabel="Warranty / AMC" count={expiring?.length}>
            {expiring === null ? (
              <Loading />
            ) : expiring.length === 0 ? (
              <Empty text="No warranties end in the next 30 days." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {expiring.slice(0, 6).map((item) => (
                  <li key={item.asset_id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs">
                    <Link href={`/assets/${item.asset_id}`} className="min-w-0 hover:text-brand-700">
                      <span className="block font-semibold text-slate-800">
                        {item.asset_tag ?? "Untagged"} · {item.name}
                      </span>
                      <span className="block text-slate-500">Ends {formatDate(item.warranty_end)}</span>
                    </Link>
                    <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                      <ExclamationTriangleIcon className="h-3 w-3" aria-hidden="true" />
                      {item.days_remaining ?? 0} days
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </section>
      )}

      {quickActions.some(([, , , , show]) => show) && (
        <section>
          <h2 className="mb-2 text-sm font-bold text-slate-900">Quick actions</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {quickActions
              .filter(([, , , , show]) => show)
              .map(([href, title, text, Icon]) => (
                <Link key={href} href={href} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-brand-200">
                  <Icon className="h-5 w-5 shrink-0 text-brand-600" aria-hidden="true" />
                  <span>
                    <span className="block text-xs font-bold text-slate-800">{title}</span>
                    <span className="block text-[11px] text-slate-500">{text}</span>
                  </span>
                </Link>
              ))}
          </div>
        </section>
      )}
    </main>
  );
}

function Panel({
  title,
  href,
  linkLabel,
  count,
  children,
}: {
  title: string;
  href: string;
  linkLabel: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-bold text-slate-900">
          {title}
          {count !== undefined && count > 0 && (
            <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">{count}</span>
          )}
        </h2>
        <Link href={href} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700">
          {linkLabel} <ArrowRightIcon className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
      {children}
    </article>
  );
}

function Loading() {
  return <p className="p-6 text-center text-xs text-slate-400">Loading…</p>;
}

function Empty({ text }: { text: string }) {
  return <p className="p-6 text-center text-xs text-slate-500">{text}</p>;
}
