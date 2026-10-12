"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { PlusIcon } from "@heroicons/react/24/outline";
import {
  approveAssetRequest,
  createAssetRequest,
  getAssetRequestCounts,
  listAssetCategories,
  listAssetRequests,
  rejectAssetRequest,
  type AssetCategory,
  type AssetRequest,
  type AssetRequestCounts,
} from "@/lib/tickets";
import { listAssets } from "@/lib/assets";
import { listDepartments, listUserDirectory, type DirectoryEntry } from "@/lib/users";
import type { Asset } from "@/types/asset";
import type { Department } from "@/types/user";
import { CategoryPicker, resolveCategoryId } from "@/components/tickets/category-picker";

const TABS = [
  ["PENDING", "Pending"],
  ["APPROVED", "Approved"],
  ["REJECTED", "Rejected"],
  ["", "All"],
] as const;

const STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-700",
  APPROVED: "bg-emerald-50 text-emerald-700",
  REJECTED: "bg-rose-50 text-rose-700",
  CANCELLED: "bg-slate-100 text-slate-600",
};

function ticketNumber(ticket: AssetRequest): string {
  return `#${ticket.id.slice(0, 6).toUpperCase()}`;
}

function timeAgo(value: string): string {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (Number.isNaN(minutes)) return "—";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
  return new Date(value).toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

/**
 * The asset-request queue with approve / reject and new-ticket form. Used by
 * the IT Agent workspace and by the IT Admin's All Tickets and My Tickets.
 */
export function TicketQueue({
  eyebrow,
  title = "Ticket Queue",
  initialMine = false,
}: {
  eyebrow: string;
  title?: string;
  initialMine?: boolean;
}) {
  const [tab, setTab] = useState<string>(initialMine ? "" : "PENDING");
  const [mine, setMine] = useState(initialMine);
  const [tickets, setTickets] = useState<AssetRequest[]>([]);
  const [counts, setCounts] = useState<AssetRequestCounts | null>(null);
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [users, setUsers] = useState<DirectoryEntry[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [stock, setStock] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    listAssetCategories().then(setCategories).catch(() => undefined);
    listUserDirectory().then(setUsers).catch(() => undefined);
    listDepartments().then(setDepartments).catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      listAssetRequests({ status: tab || undefined, mine, limit: 200 }),
      getAssetRequestCounts(),
      listAssets({ status: "IN_STOCK", limit: 200 }),
    ])
      .then(([ticketData, countData, stockData]) => {
        if (cancelled) return;
        setTickets(ticketData);
        setCounts(countData);
        setStock(stockData);
        setError("");
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load tickets.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, mine, refreshKey]);

  const done = useCallback((message: string) => {
    setNotice(message);
    setError("");
    setRefreshKey((key) => key + 1);
  }, []);

  return (
    <main className="mx-auto max-w-[1400px] space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold text-brand-600">{eyebrow}</p>
          <h1 className="mt-1 text-2xl font-extrabold">{title}</h1>
          <p className="mt-1 text-xs text-slate-500">
            Asset requests from your organization. Approving one hands an in-stock asset to the requester.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          disabled={formOpen}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          <PlusIcon className="h-4 w-4" /> New ticket
        </button>
      </header>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-800">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {formOpen && (
        <NewTicketForm
          categories={categories}
          onCategoryCreated={(category) => setCategories((current) => [...current, category])}
          departments={departments}
          users={users}
          onCancel={() => setFormOpen(false)}
          onCreated={(ticket) => {
            setFormOpen(false);
            done(`Ticket ${ticketNumber(ticket)} raised for ${ticket.requested_by_name ?? ticket.requested_for}.`);
          }}
        />
      )}

      <section className="grid gap-3 sm:grid-cols-3">
        {[
          ["Pending", counts?.pending, "text-amber-600"],
          ["Approved", counts?.open, "text-emerald-600"],
          ["Raised by me (open)", counts?.my_open, "text-slate-900"],
        ].map(([label, value, color]) => (
          <div key={String(label)} className="ui-surface p-4">
            <p className="text-[10px] text-slate-500">{label}</p>
            <p className={`mt-1 text-xl font-extrabold ${color}`}>{value ?? "—"}</p>
          </div>
        ))}
      </section>

      <section className="ui-surface overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div role="tablist" aria-label="Ticket status" className="flex gap-1">
            {TABS.map(([value, label]) => (
              <button
                key={label}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  tab === value ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={mine} onChange={(event) => setMine(event.target.checked)} />
            Only tickets raised by me
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-400">
              <tr>
                {["Ticket", "Requester", "Category / dept.", "Reason", "Status", "Raised", ""].map((heading) => (
                  <th key={heading} className="px-4 py-2 font-bold">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tickets.map((ticket) => (
                <TicketRow key={ticket.id} ticket={ticket} stock={stock} onDone={done} onError={setError} />
              ))}
            </tbody>
          </table>
        </div>
        {!loading && tickets.length === 0 && !error && (
          <p className="p-8 text-center text-xs text-slate-500">No tickets here.</p>
        )}
      </section>
    </main>
  );
}

function TicketRow({
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
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [assetId, setAssetId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  // Suggest matching stock first: assets whose category matches the ticket's category name.
  const category = ticket.category_name?.toLowerCase() ?? "";
  const options = [...stock].sort(
    (a, b) => Number(b.category.toLowerCase() === category) - Number(a.category.toLowerCase() === category),
  );

  const act = async () => {
    setBusy(true);
    try {
      if (mode === "approve") {
        const updated = await approveAssetRequest(ticket.id, assetId);
        onDone(`${ticketNumber(ticket)} approved: ${updated.assigned_asset_tag} assigned to ${updated.requested_by_name}.`);
      } else {
        await rejectAssetRequest(ticket.id, reason.trim());
        onDone(`${ticketNumber(ticket)} rejected.`);
      }
      setMode(null);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <tr className="align-top hover:bg-slate-50">
        <td className="px-4 py-3 font-mono font-semibold text-slate-700">{ticketNumber(ticket)}</td>
        <td className="px-4 py-3">
          <p className="font-semibold text-slate-700">{ticket.requested_by_name ?? ticket.requested_for}</p>
          {ticket.raised_by_name && ticket.raised_by_name !== ticket.requested_by_name && (
            <p className="text-[11px] text-slate-500">Raised by {ticket.raised_by_name}</p>
          )}
        </td>
        <td className="px-4 py-3 text-slate-600">
          {ticket.category_name ?? "—"}
          {ticket.department_name && <p className="text-[11px] text-slate-400">{ticket.department_name}</p>}
        </td>
        <td className="max-w-xs px-4 py-3 text-slate-600">
          {ticket.reason}
          {ticket.rejection_reason && <p className="mt-1 text-[11px] text-rose-600">Rejected: {ticket.rejection_reason}</p>}
          {ticket.assigned_asset_tag && <p className="mt-1 text-[11px] text-emerald-700">Assigned {ticket.assigned_asset_tag}</p>}
          {ticket.processed_by_name && (
            <p className="mt-1 text-[11px] text-slate-400">
              {ticket.status === "APPROVED" ? "Approved" : "Processed"} by {ticket.processed_by_name}
            </p>
          )}
        </td>
        <td className="px-4 py-3">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLE[ticket.status] ?? STATUS_STYLE.CANCELLED}`}>
            {ticket.status}
          </span>
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-slate-500">{timeAgo(ticket.created_at)}</td>
        <td className="whitespace-nowrap px-4 py-3 text-right">
          {ticket.status === "PENDING" && !mode && (
            <span className="inline-flex gap-3 font-semibold">
              <button type="button" onClick={() => setMode("approve")} className="text-emerald-700 hover:text-emerald-800">
                Approve
              </button>
              <button type="button" onClick={() => setMode("reject")} className="text-rose-600 hover:text-rose-700">
                Reject
              </button>
            </span>
          )}
        </td>
      </tr>
      {mode && (
        <tr className="bg-slate-50/70">
          <td colSpan={7} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              {mode === "approve" ? (
                stock.length === 0 ? (
                  <span className="text-xs text-amber-700">No assets are in stock to assign. Return or register one first.</span>
                ) : (
                  <label className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-slate-600">Asset to hand over</span>
                    <select
                      value={assetId}
                      onChange={(event) => setAssetId(event.target.value)}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs"
                    >
                      <option value="">Choose an in-stock asset…</option>
                      {options.map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.asset_tag} · {asset.name} ({asset.category})
                        </option>
                      ))}
                    </select>
                  </label>
                )
              ) : (
                <label>
                  <span className="sr-only">Reason for rejecting</span>
                  <input
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Reason for rejecting"
                    className="w-72 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                  />
                </label>
              )}
              <button
                type="button"
                disabled={busy || (mode === "approve" ? !assetId : !reason.trim())}
                onClick={act}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50 ${
                  mode === "approve" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"
                }`}
              >
                {busy ? "Saving…" : mode === "approve" ? "Approve & assign" : "Reject ticket"}
              </button>
              <button type="button" onClick={() => setMode(null)} className="px-2 text-xs font-semibold text-slate-600">
                Cancel
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function NewTicketForm({
  categories,
  onCategoryCreated,
  departments,
  users,
  onCancel,
  onCreated,
}: {
  categories: AssetCategory[];
  onCategoryCreated: (category: AssetCategory) => void;
  departments: Department[];
  users: DirectoryEntry[];
  onCancel: () => void;
  onCreated: (ticket: AssetRequest) => void;
}) {
  const [categoryId, setCategoryId] = useState("");
  const [categoryDraft, setCategoryDraft] = useState<string | null>(null);
  const [departmentId, setDepartmentId] = useState("");
  const [userId, setUserId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!reason.trim()) return setError("Describe what is needed and why.");
    setBusy(true);
    try {
      const assetCategoryId = await resolveCategoryId(categories, categoryId, categoryDraft, onCategoryCreated);
      if (!assetCategoryId) {
        setError("Choose a category, or type a name for a new one.");
        return;
      }
      onCreated(
        await createAssetRequest({
          asset_category_id: assetCategoryId,
          department_id: departmentId || undefined,
          reason: reason.trim(),
          requested_for_user_id: userId || undefined,
        }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not raise the ticket.");
    } finally {
      setBusy(false);
    }
  };

  const inputClass = "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-normal";

  return (
    <form onSubmit={submit} className="ui-surface space-y-3 p-4">
      <h2 className="text-sm font-bold">New ticket</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-[11px] font-semibold text-slate-600">
          Category
          <CategoryPicker
            categories={categories}
            value={categoryId}
            onChange={setCategoryId}
            draft={categoryDraft}
            onDraftChange={setCategoryDraft}
            selectClassName={inputClass}
          />
        </label>
        <label className="block text-[11px] font-semibold text-slate-600">
          Department
          <select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} className={inputClass}>
            <option value="">Not specified</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[11px] font-semibold text-slate-600">
          For user
          <select value={userId} onChange={(event) => setUserId(event.target.value)} className={inputClass}>
            <option value="">Myself</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.full_name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[11px] font-semibold text-slate-600">
          What is needed and why
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. Laptop for new joiner"
            className={inputClass}
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? "Raising…" : "Raise ticket"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">
          Cancel
        </button>
      </div>
    </form>
  );
}
