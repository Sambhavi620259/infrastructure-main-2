"use client";

import { assetLabel } from "@/types/asset";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ChevronDownIcon, ChevronUpIcon, PlusIcon } from "@heroicons/react/24/outline";
import {
  PRIORITIES,
  PRIORITY_STYLE,
  TICKET_STATUSES,
  TICKET_TYPE_LABEL,
  type Priority,
  type TicketSearch,
  type TicketType,
  createAssetRequest,
  getAssetRequestCounts,
  listAssetCategories,
  addComment,
  deleteTicket,
  isOpenTicket,
  userCanDelete,
  priorityLabel,
  reviewTicket,
  searchTickets,
  ATTACHMENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  ticketStatusLabel,
  uploadAttachment,
  type AssetCategory,
  type AssetRequest,
  type AssetRequestCounts,
} from "@/lib/tickets";
import { listAssets } from "@/lib/assets";
import { listDepartments, type DirectoryEntry } from "@/lib/users";
import type { Asset } from "@/types/asset";
import type { Department } from "@/types/user";
import { CategoryPicker, resolveCategoryId } from "@/components/tickets/category-picker";
import { TicketStatusBadge, TicketTypeChip, ticketHandler, ticketHref, ticketNumber } from "@/components/tickets/ticket-actions";
import { getProfile } from "@/lib/profile";
import { softwareCatalog, type CatalogEntry } from "@/lib/software";
import { accessCatalog, type AccessResource } from "@/lib/access-management";
import { formatDate } from "@/types/asset";

const PAGE_SIZE = 25;

// Quick views over the status filter.
// Every ticket not yet resolved, including those waiting for stock, a license or the user.
const OPEN = "PENDING,UNDER_REVIEW,PENDING_APPROVAL,APPROVED,IN_PROGRESS,WAITING_INVENTORY,WAITING_LICENSE,WAITING_USER";
const VIEWS: [string, string][] = [
  ["PENDING,UNDER_REVIEW,PENDING_APPROVAL,APPROVED,IN_PROGRESS", "Needs action"],
  [OPEN, "All open"],
  ["PENDING", "Submitted"],
  ["PENDING_APPROVAL", "Awaiting approval"],
  ["WAITING_INVENTORY,WAITING_LICENSE", "Awaiting stock / license"],
  ["WAITING_USER", "Waiting for user"],
  ["FULFILLED,CLOSED", "Resolved & closed"],
  ["", "All"],
];

function timeAgo(value: string): string {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (Number.isNaN(minutes)) return "—";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
  return new Date(value).toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

/**
 * The ticket table: search, filters (ticket ID, requester, type, department,
 * priority, status, creation date), sorting and pages; each row opens the
 * ticket. IT Admins see the organization's tickets; users see their own and
 * raise new ones.
 */
export function TicketQueue({
  eyebrow,
  title = "Ticket Queue",
  canHandle = true,
}: {
  eyebrow: string;
  title?: string;
  /** False in the user workspace: users see their own tickets and raise new ones. */
  canHandle?: boolean;
}) {
  const [filters, setFilters] = useState<TicketSearch>({
    status: canHandle ? VIEWS[0][0] : "",
    sort: "created_at",
    order: "desc",
  });
  const [query, setQuery] = useState("");
  const [requester, setRequester] = useState("");
  const [page, setPage] = useState(0);
  const [tickets, setTickets] = useState<AssetRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<AssetRequestCounts | null>(null);
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  // Only IT Admins (not sub-admins or reporting users) delete other people's tickets.
  const [adminDeletes, setAdminDeletes] = useState(false);

  useEffect(() => {
    listAssetCategories().then(setCategories).catch(() => undefined);
    listDepartments().then(setDepartments).catch(() => undefined);
    getProfile()
      .then((p) => setAdminDeletes(p.role === "IT_ADMIN" || p.role === "SUPER_ADMIN"))
      .catch(() => undefined);
  }, []);

  // Typing waits a moment before searching.
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((current) => ({ ...current, q: query.trim() || undefined, requester: requester.trim() || undefined }));
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, requester]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([searchTickets({ ...filters, skip: page * PAGE_SIZE, limit: PAGE_SIZE }), getAssetRequestCounts()])
      .then(([pageData, countData]) => {
        if (cancelled) return;
        setTickets(pageData.items);
        setTotal(pageData.total);
        setCounts(countData);
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
  }, [filters, page, refreshKey]);

  const done = useCallback((message: string) => {
    setNotice(message);
    setError("");
    setRefreshKey((key) => key + 1);
  }, []);

  const set = (patch: Partial<TicketSearch>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(0);
  };
  const sortBy = (sort: NonNullable<TicketSearch["sort"]>) =>
    set({ sort, order: filters.sort === sort && filters.order === "desc" ? "asc" : "desc" });
  const filterClass = "rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs";
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const tiles: [string, number | undefined, string, string][] = canHandle
    ? [
        ["Total tickets", counts?.total, "text-slate-900", ""],
        ["New (submitted)", counts?.submitted, "text-amber-600", "PENDING"],
        ["Under review", counts?.under_review, "text-blue-600", "UNDER_REVIEW"],
        ["Awaiting approval", counts?.pending_approval, "text-fuchsia-600", "PENDING_APPROVAL"],
        ["Awaiting inventory", counts?.waiting_inventory, "text-orange-600", "WAITING_INVENTORY"],
        ["Awaiting license", counts?.waiting_license, "text-orange-600", "WAITING_LICENSE"],
        ["In progress", counts?.in_progress, "text-sky-600", "IN_PROGRESS"],
        ["Resolved / closed", counts ? counts.resolved + counts.closed : undefined, "text-emerald-600", "FULFILLED,CLOSED"],
      ]
    : [
        ["Open", counts?.open, "text-slate-900", "PENDING,UNDER_REVIEW,PENDING_APPROVAL,APPROVED,IN_PROGRESS,WAITING_INVENTORY,WAITING_LICENSE,WAITING_USER"],
        ["Waiting for you", counts?.waiting_user, "text-yellow-700", "WAITING_USER"],
        ["Resolved", counts?.resolved, "text-emerald-600", "FULFILLED"],
        ["Closed", counts?.closed, "text-slate-600", "CLOSED"],
      ];

  return (
    <main className="mx-auto max-w-[1400px] space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold text-brand-600">{eyebrow}</p>
          <h1 className="mt-1 text-2xl font-extrabold">{title}</h1>
          <p className="mt-1 text-xs text-slate-500">
            {canHandle
              ? "Hardware, software and access requests, problems and returns. Open a ticket to review, approve, fulfil and resolve it."
              : "Request hardware, software or access, or report a problem with one of your assets. You are notified at every step."}
          </p>
        </div>
        {/* Users raise tickets; IT Admins only work and resolve them. */}
        {!canHandle && (
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            disabled={formOpen}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            <PlusIcon className="h-4 w-4" /> New request
          </button>
        )}
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

      {formOpen && !canHandle && (
        <NewTicketForm
          categories={categories}
          onCategoryCreated={(category) => setCategories((current) => [...current, category])}
          departments={departments}
          users={[]}
          forOthers={false}
          onCancel={() => setFormOpen(false)}
          onCreated={(ticket, fileProblem) => {
            setFormOpen(false);
            done(`Ticket ${ticketNumber(ticket)} submitted. Track it below.${fileProblem ? ` ${fileProblem}` : ""}`);
          }}
        />
      )}

      <section className={`grid grid-cols-2 gap-3 ${canHandle ? "md:grid-cols-4 xl:grid-cols-8" : "lg:grid-cols-4"}`}>
        {tiles.map(([label, value, color, status]) => (
          <button
            key={label}
            type="button"
            onClick={() => set({ status })}
            aria-pressed={filters.status === status}
            className={`ui-surface p-3 text-left transition hover:border-brand-200 ${filters.status === status ? "ring-2 ring-brand-200" : ""}`}
          >
            <p className="text-[10px] text-slate-500">{label}</p>
            <p className={`mt-1 text-xl font-extrabold ${color}`}>{value ?? "—"}</p>
          </button>
        ))}
      </section>
      {canHandle && counts && counts.high_priority > 0 && (
        <button
          type="button"
          onClick={() => set({ priority: "HIGH,CRITICAL", status: OPEN })}
          className="w-full rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-left text-xs font-semibold text-rose-800"
        >
          {counts.high_priority} open high-priority ticket{counts.high_priority === 1 ? "" : "s"}: show them
        </button>
      )}

      <section className="ui-surface overflow-hidden">
        <div className="space-y-3 border-b border-slate-100 px-4 py-3">
          {canHandle && (
            <div role="tablist" aria-label="Ticket views" className="flex flex-wrap gap-1">
              {VIEWS.map(([value, label]) => (
                <button
                  key={label}
                  type="button"
                  role="tab"
                  aria-selected={filters.status === value}
                  onClick={() => set({ status: value })}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    filters.status === value ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ticket ID (TKT-000012) or text"
              aria-label="Search tickets"
              className={`${filterClass} w-full sm:w-56`}
            />
            {canHandle && (
              <input
                value={requester}
                onChange={(e) => setRequester(e.target.value)}
                placeholder="Requester"
                aria-label="Filter by requester"
                className={`${filterClass} w-full sm:w-40`}
              />
            )}
            <select value={filters.ticket_type ?? ""} onChange={(e) => set({ ticket_type: e.target.value || undefined })} aria-label="Filter by type" className={filterClass}>
              <option value="">All types</option>
              {Object.entries(TICKET_TYPE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select value={filters.priority ?? ""} onChange={(e) => set({ priority: e.target.value || undefined })} aria-label="Filter by priority" className={filterClass}>
              <option value="">All priorities</option>
              <option value="HIGH,CRITICAL">High and critical</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {priorityLabel(p)}
                </option>
              ))}
            </select>
            <select value={filters.status ?? ""} onChange={(e) => set({ status: e.target.value })} aria-label="Filter by status" className={filterClass}>
              <option value="">All statuses</option>
              {VIEWS.slice(0, -1).filter(([v]) => v.includes(",")).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
              {TICKET_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {ticketStatusLabel(st)}
                </option>
              ))}
            </select>
            {canHandle && (
              <select value={filters.department_id ?? ""} onChange={(e) => set({ department_id: e.target.value || undefined })} aria-label="Filter by department" className={filterClass}>
                <option value="">All departments</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            )}
            {canHandle && (
              <select value={filters.assignee_id ?? ""} onChange={(e) => set({ assignee_id: e.target.value || undefined })} aria-label="Filter by assignee" className={filterClass}>
                <option value="">Anyone</option>
                <option value="me">Assigned to me</option>
              </select>
            )}
            <label className="flex items-center gap-1 text-[11px] text-slate-500">
              From
              <input type="date" value={filters.created_from?.slice(0, 10) ?? ""} onChange={(e) => set({ created_from: e.target.value ? `${e.target.value}T00:00:00` : undefined })} className={filterClass} />
            </label>
            <label className="flex items-center gap-1 text-[11px] text-slate-500">
              To
              <input type="date" value={filters.created_to?.slice(0, 10) ?? ""} onChange={(e) => set({ created_to: e.target.value ? `${e.target.value}T00:00:00` : undefined })} className={filterClass} />
            </label>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-400">
              <tr>
                <SortHeader label="Ticket" column="ticket_no" filters={filters} onSort={sortBy} />
                {canHandle && <th className="px-4 py-2 font-bold">Requester</th>}
                <th className="px-4 py-2 font-bold">Request</th>
                <SortHeader label="Priority" column="priority" filters={filters} onSort={sortBy} />
                <SortHeader label="Status" column="status" filters={filters} onSort={sortBy} />
                <SortHeader label="Needed by" column="required_date" filters={filters} onSort={sortBy} />
                <SortHeader label="Created" column="created_at" filters={filters} onSort={sortBy} />
                <th className="px-4 py-2 text-right font-bold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tickets.map((ticket) => (
                <TicketRow key={ticket.id} ticket={ticket} canHandle={canHandle} adminDeletes={adminDeletes} onUpdated={done} onError={setError} />
              ))}
            </tbody>
          </table>
        </div>
        {!loading && tickets.length === 0 && !error && <p className="p-8 text-center text-xs text-slate-500">No tickets match.</p>}
        <footer className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
          <span>
            {loading ? "Loading…" : `${total} ticket${total === 1 ? "" : "s"} · page ${page + 1} of ${pages}`}
          </span>
          <span className="space-x-2">
            <button type="button" disabled={page === 0 || loading} onClick={() => setPage((p) => p - 1)} className="rounded-md border border-slate-200 px-3 py-1.5 disabled:opacity-50">
              Previous
            </button>
            <button type="button" disabled={page + 1 >= pages || loading} onClick={() => setPage((p) => p + 1)} className="rounded-md border border-slate-200 px-3 py-1.5 disabled:opacity-50">
              Next
            </button>
          </span>
        </footer>
      </section>
    </main>
  );
}

function SortHeader({
  label,
  column,
  filters,
  onSort,
}: {
  label: string;
  column: NonNullable<TicketSearch["sort"]>;
  filters: TicketSearch;
  onSort: (column: NonNullable<TicketSearch["sort"]>) => void;
}) {
  const active = filters.sort === column;
  const Icon = active && filters.order === "asc" ? ChevronUpIcon : ChevronDownIcon;
  return (
    <th className="px-4 py-2 font-bold" aria-sort={active ? (filters.order === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => onSort(column)} className={`inline-flex items-center gap-1 uppercase ${active ? "text-slate-700" : ""}`}>
        {label}
        <Icon className={`h-3 w-3 ${active ? "" : "opacity-30"}`} aria-hidden="true" />
      </button>
    </th>
  );
}

function TicketRow({
  ticket,
  canHandle,
  adminDeletes,
  onUpdated,
  onError,
}: {
  ticket: AssetRequest;
  canHandle: boolean;
  adminDeletes: boolean;
  onUpdated: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [updating, setUpdating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const handler = ticketHandler(ticket);
  const canDelete = canHandle ? adminDeletes : userCanDelete(ticket.status);
  const remove = async () => {
    setDeleting(true);
    try {
      await deleteTicket(ticket.id);
      onUpdated(`${ticketNumber(ticket)} deleted.`);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Could not delete the ticket.");
      setDeleting(false);
      setConfirmDelete(false);
    }
  };
  const subject =
    ticket.ticket_type === "ACCESS"
      ? `${ticket.access_level} access · ${ticket.access_resource_name}`
      : ticket.ticket_type === "SOFTWARE"
        ? ticket.software_name ?? "Software"
        : ticket.asset
          ? `${assetLabel(ticket.asset)} · ${ticket.asset.name}`
          : ticket.category_name ?? "—";
  const href = ticketHref(ticket, canHandle);
  return (
    <>
    <tr className="cursor-pointer align-top hover:bg-slate-50" onClick={() => (window.location.href = href)}>
      <td className="px-4 py-3">
        <Link href={href} onClick={(e) => e.stopPropagation()} className="font-mono font-semibold text-brand-700 hover:underline">
          {ticketNumber(ticket)}
        </Link>
        {(ticket.comment_count ?? 0) > 0 && <p className="text-[10px] text-slate-400">{ticket.comment_count} comment(s)</p>}
      </td>
      {canHandle && (
        <td className="px-4 py-3">
          <p className="font-semibold text-slate-700">{ticket.requested_by_name ?? ticket.requested_for}</p>
          {ticket.department_name && <p className="text-[11px] text-slate-400">{ticket.department_name}</p>}
        </td>
      )}
      <td className="max-w-sm px-4 py-3 text-slate-600">
        <p className="flex items-center gap-1.5">
          <TicketTypeChip ticketType={ticket.ticket_type} />
          <span className="truncate font-semibold text-slate-800">{subject}</span>
        </p>
        <p className="mt-1 line-clamp-2">{ticket.reason}</p>
        {handler && <p className="mt-1 text-[11px] text-slate-400">{handler}</p>}
      </td>
      <td className="px-4 py-3">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${PRIORITY_STYLE[ticket.priority ?? "MEDIUM"]}`}>
          {priorityLabel(ticket.priority ?? "MEDIUM")}
        </span>
      </td>
      <td className="px-4 py-3">
        <TicketStatusBadge status={ticket.status} ticketType={ticket.ticket_type} />
        {ticket.needs_owner_approval && <p className="mt-1 text-[10px] text-amber-700">Owner approval pending</p>}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-slate-500">{ticket.required_date ? formatDate(ticket.required_date) : "—"}</td>
      <td className="whitespace-nowrap px-4 py-3 text-slate-500">{timeAgo(ticket.created_at)}</td>
      <td className="whitespace-nowrap px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
        {confirmDelete ? (
          <span className="inline-flex items-center gap-2 text-[11px]">
            <span className="font-semibold text-slate-700">Delete {ticketNumber(ticket)} for good?</span>
            <button type="button" disabled={deleting} onClick={remove} className="rounded-lg bg-rose-600 px-2.5 py-1.5 font-bold text-white hover:bg-rose-700 disabled:opacity-50">
              {deleting ? "Deleting…" : "Yes, delete"}
            </button>
            <button type="button" onClick={() => setConfirmDelete(false)} className="font-semibold text-slate-600">
              No
            </button>
          </span>
        ) : (
          <span className="inline-flex gap-2">
            <Link href={href} className="rounded-lg bg-brand-600 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-brand-700">
              Open
            </Link>
            {canHandle && isOpenTicket(ticket.status) && (
              <button
                type="button"
                onClick={() => setUpdating((v) => !v)}
                aria-expanded={updating}
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
              >
                Update requester
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="rounded-lg border border-rose-200 px-2.5 py-1.5 text-[11px] font-bold text-rose-600 hover:bg-rose-50"
              >
                Delete
              </button>
            )}
          </span>
        )}
      </td>
    </tr>
    {updating && (
      <tr className="bg-slate-50">
        <td colSpan={8} className="px-4 py-3">
          <QuickUpdate
            ticket={ticket}
            onCancel={() => setUpdating(false)}
            onSent={(message) => {
              setUpdating(false);
              onUpdated(message);
            }}
            onError={onError}
          />
        </td>
      </tr>
    )}
    </>
  );
}

/**
 * Tell the requester where their ticket stands without opening it: a short
 * message (sent as a comment, which notifies them). A submitted ticket moves
 * to Under review at the same time.
 */
function QuickUpdate({
  ticket,
  onCancel,
  onSent,
  onError,
}: {
  ticket: AssetRequest;
  onCancel: () => void;
  onSent: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [text, setText] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const number = ticketNumber(ticket);
  const by = date ? new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "";
  const templates = [
    "We have received your request and are reviewing it.",
    by ? `Your request will be resolved by ${by}.` : "Your request will be resolved shortly.",
    "We are waiting for stock / a license. We will update you as soon as it arrives.",
    "Your request is pending approval. We will let you know once it is decided.",
  ];

  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await addComment(ticket.id, text.trim());
      if (ticket.status === "PENDING") await reviewTicket(ticket.id);
      onSent(`${ticket.requested_by_name ?? "The requester"} was updated on ${number}.`);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Could not send the update.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 text-xs">
      <p className="font-semibold text-slate-700">
        Message {ticket.requested_by_name ?? "the requester"} about {number}
        <span className="font-normal text-slate-500"> (they are notified; full actions are on the ticket page)</span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {templates.map((template) => (
          <button
            key={template}
            type="button"
            onClick={() => setText(template)}
            className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600 hover:border-brand-200 hover:text-brand-700"
          >
            {template.length > 48 ? `${template.slice(0, 46)}…` : template}
          </button>
        ))}
        <label className="flex items-center gap-1 text-[11px] text-slate-500">
          Resolve by
          <input
            type="date"
            min={new Date().toISOString().slice(0, 10)}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1"
          />
        </label>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        maxLength={4000}
        placeholder="Write an update for the requester"
        aria-label="Update for the requester"
        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5"
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || !text.trim()}
          onClick={send}
          className="rounded-lg bg-brand-600 px-3 py-1.5 font-bold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? "Sending…" : ticket.status === "PENDING" ? "Send & mark under review" : "Send update"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-700">
          Cancel
        </button>
      </div>
    </div>
  );
}

export function NewTicketForm({
  categories,
  onCategoryCreated,
  departments,
  users,
  forOthers,
  onCancel,
  onCreated,
  initialAssetId,
  initialType,
}: {
  categories: AssetCategory[];
  onCategoryCreated: (category: AssetCategory) => void;
  departments: Department[];
  users: DirectoryEntry[];
  forOthers: boolean;
  onCancel: () => void;
  /** `fileProblem` is set when the ticket was created but a file could not be attached. */
  onCreated: (ticket: AssetRequest, fileProblem?: string) => void;
  /** Open as a problem report for this asset (e.g. from My Assets). */
  initialAssetId?: string;
  /** Open on a given ticket type, e.g. SOFTWARE from My Software. */
  initialType?: TicketType;
}) {
  const [ticketType, setTicketType] = useState<TicketType>(initialType ?? (initialAssetId ? "ISSUE" : "REQUEST"));
  const [assetId, setAssetId] = useState(initialAssetId ?? "");
  const [myAssets, setMyAssets] = useState<Asset[]>([]);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [softwareId, setSoftwareId] = useState("");
  // Software that is not registered yet is requested by name.
  const [softwareName, setSoftwareName] = useState("");
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [selfId, setSelfId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [categoryDraft, setCategoryDraft] = useState<string | null>(null);
  const [departmentId, setDepartmentId] = useState("");
  const [userId, setUserId] = useState("");
  const [reason, setReason] = useState("");
  const [priority, setPriority] = useState<Priority>("MEDIUM");
  const [requiredDate, setRequiredDate] = useState("");
  const [comments, setComments] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [resources, setResources] = useState<AccessResource[]>([]);
  const [resourceId, setResourceId] = useState("");
  const [accessLevel, setAccessLevel] = useState("");
  const [accessUntil, setAccessUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Admins raising a problem for someone need that person's assets; their own id for "Myself".
  useEffect(() => {
    if (forOthers && !selfId) getProfile().then((profile) => setSelfId(profile.id)).catch(() => undefined);
  }, [forOthers, selfId]);

  // A problem ticket is about an asset the requester holds. For users the API
  // already returns only their own assets.
  useEffect(() => {
    if (ticketType !== "ISSUE") return;
    const holder = forOthers ? userId || selfId : undefined;
    if (forOthers && !holder) return;
    listAssets({ assigned_to: holder, limit: 200 })
      .then(setMyAssets)
      .catch(() => setMyAssets([]));
  }, [ticketType, forOthers, userId, selfId]);

  useEffect(() => {
    if (ticketType !== "SOFTWARE" || catalogLoaded) return;
    softwareCatalog()
      .then(setCatalog)
      .catch(() => undefined)
      .finally(() => setCatalogLoaded(true));
  }, [ticketType, catalogLoaded]);

  useEffect(() => {
    if (ticketType === "ACCESS" && resources.length === 0) accessCatalog().then(setResources).catch(() => undefined);
  }, [ticketType, resources.length]);

  // With nothing registered, or "Not in the list" chosen, the user types the name.
  const typingSoftware = softwareId === "OTHER" || (catalogLoaded && catalog.length === 0);
  const resource = resources.find((r) => r.id === resourceId);

  // Fields every request type shares.
  const common = () => ({
    department_id: departmentId || undefined,
    reason: reason.trim(),
    requested_for_user_id: userId || undefined,
    priority,
    required_date: requiredDate ? `${requiredDate}T00:00:00` : undefined,
    additional_comments: comments.trim() || undefined,
  });

  // Create the ticket, then attach the chosen files to it.
  // Check the files before anything is created, so a bad file never leaves a half-submitted ticket.
  const fileError = (): string => {
    const wrongType = files.find((file) => !ATTACHMENT_TYPES.includes(file.type));
    if (wrongType) return `${wrongType.name}: attach images (PNG, JPEG, GIF, WebP) or PDFs only.`;
    const tooBig = files.find((file) => file.size > MAX_ATTACHMENT_BYTES);
    if (tooBig) return `${tooBig.name} is larger than 2 MB.`;
    return "";
  };

  // Create the ticket, then attach the files. Once the ticket exists the form
  // always closes: a file that fails to upload is reported, never retried by
  // submitting again (which would create a second ticket).
  const raise = async (input: Parameters<typeof createAssetRequest>[0]) => {
    const ticket = await createAssetRequest(input);
    const failed: string[] = [];
    for (const file of files) {
      try {
        await uploadAttachment(ticket.id, file);
      } catch {
        failed.push(file.name);
      }
    }
    onCreated(ticket, failed.length ? `Could not attach ${failed.join(", ")}: add it on the ticket's page.` : undefined);
  };

  // A double click must not submit twice.
  const submitting = useRef(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current) return;
    const problem = fileError();
    if (problem) return setError(problem);
    submitting.current = true;
    try {
      await submitRequest();
    } finally {
      submitting.current = false;
    }
  };

  const submitRequest = async () => {
    if (requiredDate && requiredDate < new Date().toISOString().slice(0, 10)) {
      return setError("The required date cannot be in the past.");
    }
    if (ticketType === "ACCESS") {
      if (!resource) return setError("Choose the application or resource.");
      if (!accessLevel) return setError("Choose the access level you need.");
      if (resource.max_days && !accessUntil) return setError(`Give an end date (at most ${resource.max_days} days).`);
      if (!reason.trim()) return setError("Give the business justification.");
      setBusy(true);
      try {
        await raise({
          ticket_type: "ACCESS",
          access_resource_id: resource.id,
          access_level: accessLevel,
          access_until: accessUntil ? `${accessUntil}T00:00:00` : undefined,
          ...common(),
        });
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not raise the ticket.");
      } finally {
        setBusy(false);
      }
      return;
    }
    if (ticketType === "SOFTWARE") {
      if (typingSoftware ? !softwareName.trim() : !softwareId) {
        return setError(typingSoftware ? "Type the name of the software you need." : "Choose the software you need.");
      }
      if (!reason.trim()) return setError("Say what you need it for.");
      setBusy(true);
      try {
        await raise({
          ticket_type: "SOFTWARE",
          ...(typingSoftware ? { requested_software_name: softwareName.trim() } : { software_id: softwareId }),
          ...common(),
        });
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not raise the ticket.");
      } finally {
        setBusy(false);
      }
      return;
    }
    if (ticketType === "ISSUE") {
      if (!assetId) return setError("Choose the asset that has the problem.");
      if (!reason.trim()) return setError("Describe the problem.");
      setBusy(true);
      try {
        await raise({ ticket_type: "ISSUE", asset_id: assetId, ...common() });
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not raise the ticket.");
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!reason.trim()) return setError("Describe what is needed and why.");
    setBusy(true);
    try {
      const assetCategoryId = await resolveCategoryId(categories, categoryId, categoryDraft, onCategoryCreated);
      if (!assetCategoryId) {
        setError("Choose a category, or type a name for a new one.");
        return;
      }
      await raise({ asset_category_id: assetCategoryId, ...common() });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not raise the ticket.");
    } finally {
      setBusy(false);
    }
  };

  const inputClass = "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-normal";

  return (
    <form onSubmit={submit} className="ui-surface space-y-3 p-4">
      <h2 className="text-sm font-bold">New request</h2>
      <div role="radiogroup" aria-label="Ticket type" className="inline-flex flex-wrap rounded-lg border border-slate-200 p-0.5 text-xs font-semibold">
        {(
          [
            ["REQUEST", "Hardware"],
            ["SOFTWARE", "Software"],
            ["ACCESS", "Access"],
            ["ISSUE", "Problem with my asset"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={ticketType === value}
            onClick={() => {
              setTicketType(value);
              setError("");
            }}
            className={`rounded-md px-3 py-1.5 ${ticketType === value ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {/* Without the "For user" picker (users), the reason gets a full row. */}
      <div className={`grid gap-3 sm:grid-cols-2 ${forOthers ? "lg:grid-cols-4" : ""}`}>
        {ticketType === "ACCESS" ? (
          <>
            <label className="block text-[11px] font-semibold text-slate-600">
              Application or resource
              <select
                value={resourceId}
                onChange={(event) => {
                  setResourceId(event.target.value);
                  setAccessLevel("");
                }}
                className={inputClass}
              >
                <option value="">{resources.length ? "Choose…" : "No resources set up yet"}</option>
                {resources.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              {resource?.description && <span className="mt-1 block font-normal text-slate-400">{resource.description}</span>}
            </label>
            <label className="block text-[11px] font-semibold text-slate-600">
              Access level
              <select value={accessLevel} onChange={(event) => setAccessLevel(event.target.value)} className={inputClass} disabled={!resource}>
                <option value="">Choose…</option>
                {resource?.access_levels.map((level) => (
                  <option key={level} value={level}>
                    {level}
                    {resource.privileged_levels.includes(level) ? " (privileged)" : ""}
                  </option>
                ))}
              </select>
              {resource?.owner_name && (
                <span className="mt-1 block font-normal text-slate-400">{resource.owner_name} (owner) also approves.</span>
              )}
            </label>
            <label className="block text-[11px] font-semibold text-slate-600">
              Needed until {resource?.max_days ? `(max ${resource.max_days} days)` : "(optional)"}
              <input
                type="date"
                min={new Date().toISOString().slice(0, 10)}
                value={accessUntil}
                onChange={(event) => setAccessUntil(event.target.value)}
                className={inputClass}
              />
            </label>
          </>
        ) : ticketType === "SOFTWARE" ? (
          <div className="space-y-2">
            {catalog.length > 0 && (
              <label className="block text-[11px] font-semibold text-slate-600">
                Software
                <select value={softwareId} onChange={(event) => setSoftwareId(event.target.value)} className={inputClass}>
                  <option value="">Choose the software…</option>
                  {catalog.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                      {product.version ? ` ${product.version}` : ""}
                    </option>
                  ))}
                  <option value="OTHER">Not in the list: type its name</option>
                </select>
              </label>
            )}
            {typingSoftware && (
              <label className="block text-[11px] font-semibold text-slate-600">
                {catalog.length > 0 ? "Software name" : "Software"}
                <input
                  value={softwareName}
                  onChange={(event) => setSoftwareName(event.target.value)}
                  maxLength={150}
                  placeholder="e.g. Adobe Photoshop"
                  className={inputClass}
                />
                <span className="mt-1 block font-normal text-slate-400">Your IT Admin registers it and assigns you a seat.</span>
              </label>
            )}
          </div>
        ) : ticketType === "ISSUE" ? (
          <label className="block text-[11px] font-semibold text-slate-600">
            Asset
            <select value={assetId} onChange={(event) => setAssetId(event.target.value)} className={inputClass}>
              <option value="">{myAssets.length ? "Choose the asset…" : "No assets assigned"}</option>
              {myAssets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {assetLabel(asset)} · {asset.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
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
        )}
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
        {forOthers && (
          <label className="block text-[11px] font-semibold text-slate-600">
            For user
            <select
              value={userId}
              onChange={(event) => {
                setUserId(event.target.value);
                setAssetId("");
              }}
              className={inputClass}
            >
              <option value="">Myself</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.full_name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className={`block text-[11px] font-semibold text-slate-600 ${forOthers ? "" : "sm:col-span-2"}`}>
          {ticketType === "ISSUE" ? "What is the problem?" : "Business justification"}
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={2000}
            placeholder={
              ticketType === "ISSUE"
                ? "e.g. Battery drains in an hour, screen flickers"
                : ticketType === "ACCESS"
                  ? "e.g. Month-end reporting for the finance team"
                  : "e.g. Laptop for new joiner"
            }
            className={inputClass}
          />
        </label>
        <label className="block text-[11px] font-semibold text-slate-600">
          Priority
          <select value={priority} onChange={(event) => setPriority(event.target.value as Priority)} className={inputClass}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {priorityLabel(p)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[11px] font-semibold text-slate-600">
          Needed by <span className="font-normal text-slate-400">(optional)</span>
          <input
            type="date"
            min={new Date().toISOString().slice(0, 10)}
            value={requiredDate}
            onChange={(event) => setRequiredDate(event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block text-[11px] font-semibold text-slate-600 sm:col-span-2">
          Additional comments <span className="font-normal text-slate-400">(optional)</span>
          <textarea value={comments} onChange={(event) => setComments(event.target.value)} rows={2} maxLength={2000} className={inputClass} />
        </label>
        <label className="block text-[11px] font-semibold text-slate-600 sm:col-span-2">
          Attachments <span className="font-normal text-slate-400">(optional: images or PDFs, up to 2 MB each)</span>
          <input
            type="file"
            multiple
            accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
            onChange={(event) => setFiles(Array.from(event.target.files ?? []).slice(0, 10))}
            className="mt-1 block text-xs font-normal"
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
          {busy ? "Submitting…" : "Submit request"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">
          Cancel
        </button>
      </div>
    </form>
  );
}
