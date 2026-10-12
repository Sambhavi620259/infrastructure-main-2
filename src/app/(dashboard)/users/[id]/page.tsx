"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getUserActivity, resetUserPassword, type ActivityEntry, type UserActivity } from "@/lib/users";
import { isOpenTicket, listAssetRequests, type AssetRequest } from "@/lib/tickets";
import {
  TicketActions,
  TicketProgress,
  TicketStatusBadge,
  ticketHandler,
  ticketNumber,
} from "@/components/tickets/ticket-actions";
import { listAssets } from "@/lib/assets";
import { assetStatusLabel, assetStatusStyle, formatDate, type Asset } from "@/types/asset";
import { initialsOf, roleBadgeClass, roleLabel, statusBadgeClass } from "@/types/user";

const ACTION_LABEL: Record<string, string> = {
  CREATE_ASSET_REQUEST: "Raised a ticket",
  PROCESS_ASSET_REQUEST: "Processed a ticket",
  ASSIGN_ASSET: "Assigned an asset",
  UNASSIGN_ASSET: "Returned an asset to stock",
  UPDATE_ASSET: "Updated an asset",
  CREATE_ASSET: "Registered an asset",
  ADJUST_INVENTORY_STOCK: "Adjusted stock",
  GENERATE_REPORT: "Generated a report",
  CHANGE_PASSWORD: "Changed their password",
  USER_REGISTER: "Signed up",
};

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function describe(entry: ActivityEntry): string {
  return entry.new_value ?? entry.old_value ?? entry.entity;
}

export default function UserWorkPage() {
  const params = useParams<{ id: string }>();
  const userId = typeof params.id === "string" ? params.id : "";
  const [activity, setActivity] = useState<UserActivity | null>(null);
  const [pending, setPending] = useState<AssetRequest[]>([]);
  const [processed, setProcessed] = useState<AssetRequest[]>([]);
  const [held, setHeld] = useState<Asset[]>([]);
  const [stock, setStock] = useState<Asset[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    Promise.all([
      getUserActivity(userId),
      listAssetRequests({ raised_by: userId, limit: 200 }),
      listAssetRequests({ processed_by: userId, limit: 20 }),
      listAssets({ assigned_to: userId, limit: 100 }),
      listAssets({ status: "IN_STOCK", limit: 200 }),
    ])
      .then(([activityData, pendingData, processedData, heldData, stockData]) => {
        if (cancelled) return;
        setActivity(activityData);
        setPending(pendingData.filter((ticket) => isOpenTicket(ticket.status)));
        setProcessed(processedData);
        setHeld(heldData);
        setStock(stockData);
        setError("");
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load this user's work.");
      });
    return () => {
      cancelled = true;
    };
  }, [userId, refreshKey]);

  const done = useCallback((message: string) => {
    setNotice(message);
    setRefreshKey((key) => key + 1);
  }, []);

  if (error && !activity) {
    return (
      <main className="mx-auto max-w-7xl space-y-4">
        <Link href="/users" className="text-sm font-semibold text-brand-600 hover:text-brand-700">
          ← Back to users
        </Link>
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      </main>
    );
  }

  if (!activity) {
    return (
      <main className="mx-auto max-w-7xl">
        <p className="text-sm text-slate-500">Loading…</p>
      </main>
    );
  }

  const { user, summary } = activity;
  const tiles: [string, number][] = [
    ["Open tickets raised", summary.tickets_raised_pending],
    ["Tickets in progress", summary.tickets_in_progress],
    ["Tickets approved / fulfilled", summary.tickets_approved],
    ["Tickets rejected", summary.tickets_rejected],
    ["Assets assigned", summary.assets_assigned],
    ["Assets returned", summary.assets_unassigned],
    ["Status updates", summary.asset_status_changes],
    ["Stock adjustments", summary.stock_adjustments],
    ["Reports generated", summary.reports_generated],
  ];

  return (
    <main className="mx-auto max-w-7xl space-y-5">
      <Link href="/users" className="inline-flex text-sm font-semibold text-brand-600 hover:text-brand-700">
        ← Back to users
      </Link>

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
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${roleBadgeClass(user.role)}`}>
                {roleLabel(user.role)}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statusBadgeClass(user.status)}`}>
                {user.status}
              </span>
            </p>
          </div>
        </div>
        <div className="space-y-2 text-sm text-slate-500 sm:text-right">
          <p>
            Last active <span className="font-semibold text-slate-800">{formatDateTime(activity.last_active_at)}</span>
          </p>
          <ResetPassword userId={user.id} name={user.full_name} onDone={done} onError={setError} />
        </div>
      </header>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      <section aria-label="Work summary" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map(([label, value]) => (
          <article key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-2xl font-bold text-slate-950">{value}</p>
            <p className="mt-1 text-xs font-medium text-slate-600">{label}</p>
          </article>
        ))}
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold text-slate-900">Open tickets raised by {user.full_name}</h2>
          <p className="mt-1 text-sm text-slate-500">
            Each ticket shows where it is: pending, in progress, or approved and waiting for stock. Move it on from here.
          </p>
        </div>
        {pending.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">No open tickets.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {pending.map((ticket) => (
              <OpenTicket key={ticket.id} ticket={ticket} stock={stock} onDone={done} onError={setError} />
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="font-semibold text-slate-900">Tickets they handled</h2>
          </div>
          {processed.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500">None yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {processed.map((ticket) => (
                <li key={ticket.id} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-800">
                      {ticketNumber(ticket)} · {ticket.category_name ?? "Asset request"}
                    </span>
                    <TicketStatusBadge status={ticket.status} />
                  </div>
                  <p className="text-xs text-slate-500">
                    For {ticket.requested_by_name ?? ticket.requested_for}
                    {ticket.assigned_asset_tag ? ` · ${ticket.assigned_asset_tag}` : ""}
                    {ticket.rejection_reason ? ` · ${ticket.rejection_reason}` : ""} · {formatDateTime(ticket.processed_at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="font-semibold text-slate-900">Assets they hold ({held.length})</h2>
          </div>
          {held.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500">No assets assigned.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {held.map((asset) => (
                <li key={asset.id} className="flex items-center justify-between gap-2 px-5 py-3">
                  <Link href={`/assets/${asset.id}`} className="font-semibold text-slate-800 hover:text-brand-700">
                    {asset.asset_tag} · {asset.name}
                  </Link>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${assetStatusStyle(asset.status)}`}>
                    {assetStatusLabel(asset.status)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold text-slate-900">Recent activity</h2>
          <p className="mt-1 text-sm text-slate-500">Everything this user did, newest first (sign-ins excluded).</p>
        </div>
        {activity.recent.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">No activity recorded yet.</p>
        ) : (
          <ol className="divide-y divide-slate-100 text-sm">
            {activity.recent.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <span>
                  <span className="font-semibold text-slate-800">{ACTION_LABEL[entry.action] ?? entry.action}</span>
                  <span className="text-slate-500"> · {describe(entry)}</span>
                </span>
                <span className="shrink-0 text-xs text-slate-400">{formatDateTime(entry.timestamp)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <p className="text-xs text-slate-400">Member since {formatDate(user.created_at)}</p>
    </main>
  );
}

function OpenTicket({
  ticket,
  stock,
  onDone,
  onError,
}: {
  ticket: AssetRequest;
  stock: Asset[];
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const handler = ticketHandler(ticket);
  return (
    <li className="flex flex-col gap-3 px-5 py-3 text-sm lg:flex-row lg:items-start lg:justify-between">
      <div className="flex gap-4">
        <TicketProgress status={ticket.status} />
        <div>
          <p className="font-semibold text-slate-800">
            {ticketNumber(ticket)} · {ticket.category_name ?? "Asset request"}
            {ticket.department_name ? ` · ${ticket.department_name}` : ""}
          </p>
          <p className="text-slate-500">{ticket.reason}</p>
          <p className="text-xs text-slate-400">
            For {ticket.requested_by_name ?? ticket.requested_for} · raised {formatDateTime(ticket.created_at)}
            {handler ? ` · ${handler}` : ""}
          </p>
        </div>
      </div>
      <div className="shrink-0">
        <TicketActions ticket={ticket} stock={stock} onDone={onDone} onError={onError} />
      </div>
    </li>
  );
}

function ResetPassword({
  userId,
  name,
  onDone,
  onError,
}: {
  userId: string;
  name: string;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs font-semibold text-brand-600 hover:text-brand-700">
        Reset password
      </button>
    );
  }

  const save = async () => {
    if (password.length < 8) return onError("The temporary password needs at least 8 characters.");
    setBusy(true);
    try {
      await resetUserPassword(userId, password);
      setOpen(false);
      setPassword("");
      onDone(`Temporary password set for ${name}. Share it with them directly; they can change it in Settings.`);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Could not reset the password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="flex items-center gap-2 sm:justify-end">
      <label>
        <span className="sr-only">Temporary password</span>
        <input
          type="text"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="off"
          placeholder="Temporary password"
          className="w-44 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
        />
      </label>
      <button type="button" disabled={busy} onClick={save} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
        {busy ? "Saving…" : "Set"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs font-semibold text-slate-500">
        Cancel
      </button>
    </span>
  );
}
