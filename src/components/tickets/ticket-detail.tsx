"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import {
  PaperClipIcon,
  ChatBubbleLeftRightIcon,
  ClockIcon,
  ShieldCheckIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import {
  PRIORITY_STYLE,
  RETURN_CONDITIONS,
  addComment,
  approveTicket,
  askRequester,
  assignTicket,
  cancelTicket,
  closeTicket,
  confirmReturnTicket,
  confirmTicket,
  downloadAttachment,
  fulfilSoftwareTicket,
  fulfilTicket,
  getTicket,
  grantAccessTicket,
  isOpenTicket,
  listAttachments,
  listComments,
  listTicketTeam,
  ownerDecision,
  priorityLabel,
  rejectTicket,
  releaseTicket,
  reopenTicket,
  resolveTicket,
  reviewTicket,
  sendForApproval,
  startTicket,
  ticketHistory,
  ticketNumber,
  ticketStatusLabel,
  uploadAttachment,
  waitTicket,
  type AssetRequest,
  type TeamMember,
  type TicketAttachment,
  type TicketComment,
  type TicketEvent,
} from "@/lib/tickets";
import { listAssets } from "@/lib/assets";
import { listSoftware, type Software } from "@/lib/software";
import { getProfile, type Profile } from "@/lib/profile";
import { assetLabel, formatDate, type Asset } from "@/types/asset";
import { TicketAssetDetails, TicketProgress, TicketStatusBadge, TicketTypeChip } from "@/components/tickets/ticket-actions";

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "—"
    : parsed.toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** yyyy-mm-dd -> the backend's datetime format. */
const day = (value: string) => (value ? `${value}T00:00:00` : undefined);
const today = () => new Date().toISOString().slice(0, 10);

const EVENT_LABEL: Record<string, string> = {
  CREATED: "Submitted",
  STATUS: "Status changed",
  ASSIGNED: "Assignment",
  REOPENED: "Reopened",
  OWNER_APPROVED: "Approved by the resource owner",
  OWNER_REJECTED: "Rejected by the resource owner",
  ATTACHMENT: "File attached",
};

/**
 * One ticket: details, approvals, the actions allowed now, conversation,
 * files and history. `workspace` decides the links and wording; what each
 * person may do is decided by the API (this only shows what applies).
 */
export function TicketDetail({ ticketId, workspace }: { ticketId: string; workspace: "admin" | "user" }) {
  const [ticket, setTicket] = useState<AssetRequest | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [comments, setComments] = useState<TicketComment[]>([]);
  const [files, setFiles] = useState<TicketAttachment[]>([]);
  const [history, setHistory] = useState<TicketEvent[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState("");

  const load = useCallback(() => {
    getTicket(ticketId)
      .then((data) => {
        setTicket(data);
        setLoadError("");
      })
      .catch((caught) => setLoadError(caught instanceof Error ? caught.message : "Unable to load the ticket."));
    listComments(ticketId).then(setComments).catch(() => undefined);
    listAttachments(ticketId).then(setFiles).catch(() => undefined);
    ticketHistory(ticketId).then(setHistory).catch(() => undefined);
  }, [ticketId]);

  useEffect(() => {
    load();
    getProfile().then(setProfile).catch(() => undefined);
  }, [load]);

  const done = (message: string) => {
    setNotice(message);
    setError("");
    load();
  };

  const backHref = workspace === "admin" ? "/requests" : "/agent/tickets";
  if (loadError) {
    return (
      <main className="mx-auto max-w-6xl space-y-4">
        <Link href={backHref} className="text-sm font-semibold text-brand-600">
          ← Back to tickets
        </Link>
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {loadError}
        </div>
      </main>
    );
  }
  if (!ticket || !profile) return <p className="text-sm text-slate-500">Loading…</p>;

  const staff = profile.role !== "IT_AGENT";
  const isRequester = ticket.requested_by === profile.id;
  const isOwner = !staff && ticket.owner_id === profile.id && !isRequester;
  const open = isOpenTicket(ticket.status);
  const final = ["CLOSED", "REJECTED", "CANCELLED"].includes(ticket.status);
  const subject =
    ticket.ticket_type === "ACCESS"
      ? `${ticket.access_level} access to ${ticket.access_resource_name}`
      : ticket.ticket_type === "SOFTWARE"
        ? ticket.software_name ?? "Software"
        : ticket.ticket_type === "ISSUE" || ticket.ticket_type === "RETURN"
          ? ticket.asset
            ? `${assetLabel(ticket.asset)} · ${ticket.asset.name}`
            : "Asset"
          : ticket.category_name ?? "Hardware";

  return (
    <main className="mx-auto max-w-6xl space-y-5">
      <Link href={backHref} className="inline-flex text-sm font-semibold text-brand-600 hover:text-brand-700">
        ← Back to tickets
      </Link>

      <header className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-mono font-bold text-slate-500">{ticketNumber(ticket)}</span>
              <TicketTypeChip ticketType={ticket.ticket_type} />
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${PRIORITY_STYLE[ticket.priority ?? "MEDIUM"]}`}>
                {priorityLabel(ticket.priority ?? "MEDIUM")} priority
              </span>
              {(ticket.reopen_count ?? 0) > 0 && (
                <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                  Reopened {ticket.reopen_count}×
                </span>
              )}
            </p>
            <h1 className="mt-1.5 text-xl font-extrabold text-slate-950">{subject}</h1>
            <p className="mt-1 text-sm text-slate-600">{ticket.reason}</p>
          </div>
          <TicketProgress status={ticket.status} ticketType={ticket.ticket_type} />
        </div>
        <dl className="mt-4 grid gap-x-6 gap-y-3 border-t border-slate-100 pt-4 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Requester">
            {ticket.requested_by_name ?? ticket.requested_for}
            {ticket.requester_employee_id && <span className="block text-slate-400">ID {ticket.requester_employee_id}</span>}
          </Fact>
          <Fact label="Department">{ticket.department_name ?? "—"}</Fact>
          <Fact label="Submitted">{formatDateTime(ticket.created_at)}</Fact>
          <Fact label="Needed by">{formatDate(ticket.required_date ?? null)}</Fact>
          {staff && <Fact label="Assigned to">{ticket.assignee_name ?? "Unassigned"}</Fact>}
          {ticket.processed_by_name && <Fact label="Last handled by">{ticket.processed_by_name}</Fact>}
          {ticket.resolved_at && <Fact label="Resolved">{formatDateTime(ticket.resolved_at)}</Fact>}
          {ticket.closed_at && <Fact label="Closed">{formatDateTime(ticket.closed_at)}</Fact>}
        </dl>
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

      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-5">
          <Section title="Request details">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              {ticket.ticket_type === "ACCESS" && (
                <>
                  <Fact label="Resource">{ticket.access_resource_name}</Fact>
                  <Fact label="Access level">{ticket.access_level}</Fact>
                  <Fact label="Access until">{ticket.access_until ? formatDate(ticket.access_until) : "No end date"}</Fact>
                  <Fact label="Resource owner">{ticket.owner_name ?? "None"}</Fact>
                </>
              )}
              {ticket.ticket_type === "SOFTWARE" && (
                <Fact label="Software">
                  {ticket.software_name ?? "—"}
                  {!ticket.software_id && <span className="block text-amber-700">Asked for by name: not registered yet</span>}
                </Fact>
              )}
              {ticket.ticket_type === "REQUEST" && <Fact label="Category">{ticket.category_name ?? "—"}</Fact>}
              {ticket.assigned_asset_tag && (
                <Fact label={ticket.status === "FULFILLED" || ticket.status === "CLOSED" ? "Device handed over" : "Device reserved"}>
                  {ticket.assigned_asset_tag}
                </Fact>
              )}
              {ticket.additional_comments && (
                <div className="sm:col-span-2">
                  <Fact label="Additional comments">{ticket.additional_comments}</Fact>
                </div>
              )}
            </dl>
            <TicketAssetDetails ticket={ticket} link={staff} />
            {(ticket.status === "WAITING_INVENTORY" || ticket.status === "WAITING_LICENSE") && (
              <p className="mt-3 flex gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-800">
                <ExclamationTriangleIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  {ticket.status === "WAITING_INVENTORY" ? "No matching device in stock." : "No free license seat."}
                  {ticket.expected_date ? ` Expected ${formatDate(ticket.expected_date)}.` : ""}
                  {ticket.procurement_note ? ` ${ticket.procurement_note}` : ""}
                </span>
              </p>
            )}
            {ticket.resolution_note && <Outcome tone="emerald" label="Resolution">{ticket.resolution_note}</Outcome>}
            {ticket.rejection_reason && <Outcome tone="rose" label="Rejected">{ticket.rejection_reason}</Outcome>}
            {ticket.return_condition && (
              <Outcome tone="sky" label="Returned">in {ticket.return_condition.toLowerCase()} condition</Outcome>
            )}
          </Section>

          <Comments ticket={ticket} comments={comments} staff={staff} canWrite={!final} onAdded={done} onError={setError} />
          <Files ticket={ticket} files={files} canUpload={!final && (staff || isRequester)} onChange={done} onError={setError} />
        </div>

        <div className="space-y-5">
          <Section title="What happens next" icon={<ShieldCheckIcon className="h-4 w-4" aria-hidden="true" />}>
            {staff ? (
              <AdminActions ticket={ticket} onDone={done} onError={setError} />
            ) : (
              <UserActions ticket={ticket} isRequester={isRequester} isOwner={isOwner} onDone={done} onError={setError} />
            )}
            {!open && !staff && !isRequester && <p className="text-xs text-slate-500">Nothing to do on this ticket.</p>}
          </Section>

          {(ticket.approvals?.length || ticket.needs_owner_approval) && (
            <Section title="Approvals">
              <ul className="space-y-2 text-xs">
                {ticket.approvals?.map((approval) => (
                  <li key={approval.id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                    <span className={`font-bold ${approval.decision === "APPROVED" ? "text-emerald-700" : "text-rose-700"}`}>
                      {approval.decision === "APPROVED" ? "Approved" : "Rejected"}
                    </span>{" "}
                    by {approval.approver_name}
                    <span className="text-slate-500"> ({approval.kind === "OWNER" ? "resource owner" : "IT approver"})</span>
                    <span className="block text-slate-400">{formatDateTime(approval.created_at)}</span>
                    {approval.note && <span className="block text-slate-600">{approval.note}</span>}
                  </li>
                ))}
                {ticket.needs_owner_approval && open && (
                  <li className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                    Waiting for {ticket.owner_name ?? "the resource owner"} to approve as resource owner.
                  </li>
                )}
              </ul>
            </Section>
          )}

          <Section title="History" icon={<ClockIcon className="h-4 w-4" aria-hidden="true" />}>
            {history.length === 0 ? (
              <p className="text-xs text-slate-500">No history yet.</p>
            ) : (
              <ol className="space-y-3 border-l border-slate-200 pl-4 text-xs">
                {history.map((event) => (
                  <li key={event.id} className="relative">
                    <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand-500" aria-hidden="true" />
                    <p className="font-semibold text-slate-800">
                      {event.to_status && event.action !== "CREATED"
                        ? `${ticketStatusLabel(event.from_status ?? "")} → ${ticketStatusLabel(event.to_status, ticket.ticket_type)}`
                        : EVENT_LABEL[event.action] ?? event.action}
                      {event.internal && <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] font-bold text-slate-500">internal</span>}
                    </p>
                    {event.note && <p className="text-slate-600">{event.note}</p>}
                    <p className="text-slate-400">
                      {event.actor_name ? `${event.actor_name} · ` : ""}
                      {formatDateTime(event.created_at)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </div>
      </div>
    </main>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-slate-800">{children}</dd>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 flex items-center gap-1.5 text-sm font-bold text-slate-900">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

function Outcome({ tone, label, children }: { tone: "emerald" | "rose" | "sky"; label: string; children: ReactNode }) {
  const style = { emerald: "border-emerald-200 bg-emerald-50 text-emerald-800", rose: "border-rose-200 bg-rose-50 text-rose-800", sky: "border-sky-200 bg-sky-50 text-sky-800" }[tone];
  return (
    <p className={`mt-3 rounded-lg border px-3 py-2 text-xs ${style}`}>
      <span className="font-bold">{label}:</span> {children}
    </p>
  );
}

const button = "rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-50";
const primary = `${button} bg-brand-600 text-white hover:bg-brand-700`;
const secondary = `${button} border border-slate-200 text-slate-700 hover:bg-slate-50`;
const danger = `${button} bg-rose-600 text-white hover:bg-rose-700`;
const field = "mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-normal";

function useRunner(onDone: (message: string) => void, onError: (message: string) => void) {
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await action();
      onDone(message);
      return true;
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "That did not work.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

type Mode =
  | "reject"
  | "ask"
  | "approve"
  | "sendApproval"
  | "handover"
  | "resolve"
  | "wait"
  | "seat"
  | "grant"
  | "return"
  | "reopen"
  | "cancel"
  | null;

/** Actions for the IT team, by ticket type and status (the API re-checks every one). */
function AdminActions({ ticket, onDone, onError }: { ticket: AssetRequest; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [mode, setMode] = useState<Mode>(null);
  const [text, setText] = useState("");
  const [date, setDate] = useState("");
  const [choice, setChoice] = useState("");
  const [deployment, setDeployment] = useState("");
  const [stock, setStock] = useState<Asset[]>([]);
  const [products, setProducts] = useState<Software[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const { busy, run } = useRunner((message) => {
    setMode(null);
    setText("");
    setDate("");
    setChoice("");
    onDone(message);
  }, onError);

  const type = ticket.ticket_type;
  const status = ticket.status;
  const number = ticketNumber(ticket);
  const open = isOpenTicket(status);
  const approved = ticket.approvals?.some((a) => a.kind === "APPROVER" && a.decision === "APPROVED") ?? false;

  useEffect(() => {
    listTicketTeam().then(setTeam).catch(() => undefined);
    if (type === "REQUEST") listAssets({ status: "IN_STOCK", limit: 200 }).then(setStock).catch(() => undefined);
    if (type === "SOFTWARE") listSoftware().then(setProducts).catch(() => undefined);
  }, [type]);

  // Suggest stock in the ticket's category first.
  const category = ticket.category_name?.toLowerCase() ?? "";
  const options = [...stock].sort(
    (a, b) => Number(b.category.toLowerCase() === category) - Number(a.category.toLowerCase() === category),
  );
  const matching = stock.filter((asset) => asset.category.toLowerCase() === category).length;
  const product = products.find((p) => p.id === ticket.software_id);

  const reviewing = ["PENDING", "UNDER_REVIEW", "IN_PROGRESS", "WAITING_USER"].includes(status);
  const actions: [string, () => void, string?][] = [];
  if (status === "PENDING") actions.push(["Start review", () => run(() => reviewTicket(ticket.id), `${number} is under review.`)]);
  if (type === "ISSUE" && ["PENDING", "UNDER_REVIEW"].includes(status))
    actions.push(["Start work", () => run(() => startTicket(ticket.id), `${number} is in progress.`)]);
  if (reviewing && type !== "ISSUE") actions.push(["Approve", () => setMode("approve"), "primary"]);
  if ((reviewing || status === "IN_PROGRESS") && type !== "ISSUE") actions.push(["Send for approval", () => setMode("sendApproval")]);
  if (status === "PENDING_APPROVAL") actions.push(["Approve", () => setMode("approve"), "primary"]);
  if (type === "ISSUE" && open) actions.push(["Resolve", () => setMode("resolve"), "primary"]);
  if (type === "REQUEST" && ["APPROVED", "IN_PROGRESS", "WAITING_INVENTORY", ...(reviewing ? [status] : [])].includes(status))
    actions.push(["Hand over device", () => setMode("handover"), "primary"]);
  if (type === "REQUEST" && ["APPROVED", "IN_PROGRESS"].includes(status) || type === "REQUEST" && reviewing)
    actions.push(["Waiting for inventory", () => setMode("wait")]);
  if (type === "SOFTWARE" && (["APPROVED", "IN_PROGRESS", "WAITING_LICENSE"].includes(status) || (reviewing && product && !product.approval_required)))
    actions.push(["Assign seat", () => setMode("seat"), "primary"]);
  if (type === "SOFTWARE" && ["APPROVED", "IN_PROGRESS", ...(reviewing ? [status] : [])].includes(status))
    actions.push(["Waiting for license", () => setMode("wait")]);
  if (type === "ACCESS" && ["APPROVED", "IN_PROGRESS"].includes(status)) actions.push(["Record access granted", () => setMode("grant"), "primary"]);
  if (type === "RETURN" && status === "APPROVED") actions.push(["Confirm handover", () => setMode("return"), "primary"]);
  if (["APPROVED", "WAITING_INVENTORY", "WAITING_LICENSE"].includes(status) && type !== "ISSUE")
    actions.push(["Start work", () => run(() => startTicket(ticket.id), `${number} is in progress.`)]);
  if (reviewing && status !== "WAITING_USER") actions.push(["Ask the requester", () => setMode("ask")]);
  if (["UNDER_REVIEW", "IN_PROGRESS"].includes(status))
    actions.push(["Release to queue", () => run(() => releaseTicket(ticket.id), `${number} is back in the queue.`)]);
  if (status === "FULFILLED") actions.push(["Close", () => run(() => closeTicket(ticket.id), `${number} closed.`), "primary"]);
  if (status === "FULFILLED" || status === "CLOSED") actions.push(["Reopen", () => setMode("reopen")]);
  if (open && !["APPROVED", "WAITING_INVENTORY", "WAITING_LICENSE"].includes(status) || status === "PENDING_APPROVAL")
    actions.push(["Reject", () => setMode("reject"), "danger"]);
  if (open) actions.push(["Cancel ticket", () => setMode("cancel")]);

  const submitForm = async (event: FormEvent) => {
    event.preventDefault();
    switch (mode) {
      case "reject":
        return run(() => rejectTicket(ticket.id, text.trim()), `${number} rejected.`);
      case "ask":
        return run(() => askRequester(ticket.id, text.trim()), `Question sent to ${ticket.requested_by_name}.`);
      case "sendApproval":
        return run(() => sendForApproval(ticket.id, text.trim() || undefined), `${number} sent for approval.`);
      case "approve":
        return run(() => approveTicket(ticket.id, choice || undefined, text.trim() || undefined),
          choice ? `${number} approved and the device reserved.` : `${number} approved.`);
      case "handover":
        return run(() => fulfilTicket(ticket.id, choice || undefined), `${number} resolved: device handed over.`);
      case "resolve":
        return run(() => resolveTicket(ticket.id, text.trim()), `${number} resolved.`);
      case "wait":
        return run(() => waitTicket(ticket.id, type === "SOFTWARE" ? "WAITING_LICENSE" : "WAITING_INVENTORY", day(date), text.trim() || undefined),
          `${number} is waiting for ${type === "SOFTWARE" ? "a license" : "inventory"}.`);
      case "seat":
        return run(() => fulfilSoftwareTicket(ticket.id, undefined, ticket.software_id ? undefined : choice, deployment || undefined),
          `${number}: seat assigned.`);
      case "grant":
        return run(() => grantAccessTicket(ticket.id, day(date)), `${number}: access recorded as granted.`);
      case "return":
        return run(() => confirmReturnTicket(ticket.id, choice as (typeof RETURN_CONDITIONS)[number]), `${number}: device received.`);
      case "reopen":
        return run(() => reopenTicket(ticket.id, text.trim()), `${number} reopened.`);
      case "cancel":
        return run(() => cancelTicket(ticket.id), `${number} cancelled.`);
    }
  };

  const needsText = mode === "reject" || mode === "ask" || mode === "resolve" || mode === "reopen";
  const formReady =
    (!needsText || text.trim().length > (mode === "reopen" ? 2 : 0)) &&
    (mode !== "wait" || Boolean(date || text.trim())) &&
    (mode !== "handover" || Boolean(choice || ticket.assigned_asset_id)) &&
    (mode !== "seat" || Boolean(ticket.software_id || choice)) &&
    (mode !== "return" || Boolean(choice));

  return (
    <div className="space-y-3">
      {open && (
        <label className="block text-[11px] font-semibold text-slate-600">
          Assigned to
          <select
            value={ticket.assignee_id ?? ""}
            disabled={busy}
            onChange={(event) =>
              run(() => assignTicket(ticket.id, event.target.value || null),
                event.target.value ? `${number} assigned.` : `${number} unassigned.`)
            }
            className={field}
          >
            <option value="">Unassigned</option>
            {team.map((member) => (
              <option key={member.id} value={member.id}>
                {member.full_name}
              </option>
            ))}
          </select>
        </label>
      )}

      {type === "REQUEST" && open && (
        <p className={`rounded-lg px-3 py-2 text-[11px] ${matching ? "bg-emerald-50 text-emerald-800" : "bg-orange-50 text-orange-800"}`}>
          {matching
            ? `${matching} ${ticket.category_name ?? ""} device(s) in stock.`
            : `No ${ticket.category_name ?? "matching"} device in stock${stock.length ? ` (${stock.length} other in stock)` : ""}. Approve and set Waiting for inventory.`}
        </p>
      )}
      {type === "SOFTWARE" && open && (
        <p className={`rounded-lg px-3 py-2 text-[11px] ${product && product.available_licenses > 0 ? "bg-emerald-50 text-emerald-800" : "bg-orange-50 text-orange-800"}`}>
          {!ticket.software_id
            ? "Not registered yet: register it under Software Assets, then assign a seat."
            : product
              ? `${product.available_licenses} of ${product.total_licenses} seats free · ${product.approval_required ? "approval required" : "no approval needed"}.`
              : "Checking licenses…"}
        </p>
      )}
      {type === "ACCESS" && open && !approved && (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
          Access is only recorded after approval{ticket.owner_name ? `, including ${ticket.owner_name} as resource owner` : ""}.
          Give the access in the system itself, then record it here.
        </p>
      )}

      {mode ? (
        <form onSubmit={submitForm} className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          {mode === "approve" && type === "REQUEST" && (
            <label className="block text-[11px] font-semibold text-slate-600">
              Reserve a device (optional)
              <select value={choice} onChange={(e) => setChoice(e.target.value)} className={field}>
                <option value="">Do not reserve yet</option>
                {options.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {assetLabel(asset)} · {asset.name} ({asset.category})
                  </option>
                ))}
              </select>
            </label>
          )}
          {mode === "handover" && (
            <label className="block text-[11px] font-semibold text-slate-600">
              Device to hand over
              <select value={choice} onChange={(e) => setChoice(e.target.value)} className={field}>
                <option value="">{ticket.assigned_asset_id ? `The reserved device (${ticket.assigned_asset_tag ?? "reserved"})` : "Choose an in-stock device…"}</option>
                {options.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {assetLabel(asset)} · {asset.name} ({asset.category})
                  </option>
                ))}
              </select>
            </label>
          )}
          {mode === "seat" && !ticket.software_id && (
            <label className="block text-[11px] font-semibold text-slate-600">
              Registered software to give
              <select value={choice} onChange={(e) => setChoice(e.target.value)} className={field}>
                <option value="">Choose…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.available_licenses} free)
                  </option>
                ))}
              </select>
              <Link href="/assets/software/new" className="mt-1 inline-block font-semibold text-brand-600">
                Register {ticket.software_name}
              </Link>
            </label>
          )}
          {mode === "seat" && (
            <label className="block text-[11px] font-semibold text-slate-600">
              Installation
              <select value={deployment} onChange={(e) => setDeployment(e.target.value)} className={field}>
                <option value="">Not tracked</option>
                <option value="NOT_REQUIRED">Not required (web / SaaS)</option>
                <option value="PENDING">Pending installation</option>
                <option value="INSTALLED">Installed (I confirmed it)</option>
              </select>
            </label>
          )}
          {mode === "return" && (
            <label className="block text-[11px] font-semibold text-slate-600">
              Condition it came back in
              <select value={choice} onChange={(e) => setChoice(e.target.value)} className={field}>
                <option value="">Choose…</option>
                {RETURN_CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {c.charAt(0) + c.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
          )}
          {(mode === "wait" || mode === "grant") && (
            <label className="block text-[11px] font-semibold text-slate-600">
              {mode === "wait" ? "Expected availability" : "Access until"}
              <input type="date" min={today()} value={date} onChange={(e) => setDate(e.target.value)} className={field} />
              {mode === "grant" && (
                <span className="mt-1 block font-normal text-slate-400">
                  Blank keeps {ticket.access_until ? formatDate(ticket.access_until) : "no end date"}.
                </span>
              )}
            </label>
          )}
          {mode !== "handover" && mode !== "seat" && mode !== "grant" && mode !== "return" && mode !== "cancel" && (
            <label className="block text-[11px] font-semibold text-slate-600">
              {
                {
                  reject: "Reason for rejecting",
                  ask: "What do you need from the requester?",
                  resolve: "How was it resolved?",
                  wait: "Procurement notes",
                  reopen: "Why reopen it?",
                  approve: "Note (optional)",
                  sendApproval: "Note for the approver (optional)",
                }[mode]
              }
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000} className={field} />
            </label>
          )}
          {mode === "cancel" && <p className="text-xs font-semibold text-slate-700">Cancel {number}? This cannot be undone.</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={busy || !formReady} className={mode === "reject" || mode === "cancel" ? danger : primary}>
              {busy ? "Saving…" : "Confirm"}
            </button>
            <button type="button" onClick={() => setMode(null)} className={secondary}>
              Back
            </button>
          </div>
        </form>
      ) : actions.length ? (
        <div className="flex flex-wrap gap-2">
          {actions.map(([label, onClick, kind]) => (
            <button key={label} type="button" disabled={busy} onClick={onClick}
              className={kind === "primary" ? primary : kind === "danger" ? danger : secondary}>
              {label}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-500">This ticket is {ticketStatusLabel(status, type).toLowerCase()}.</p>
      )}
    </div>
  );
}

/** The requester: cancel, confirm or reopen. The resource owner: approve or reject access. */
function UserActions({
  ticket,
  isRequester,
  isOwner,
  onDone,
  onError,
}: {
  ticket: AssetRequest;
  isRequester: boolean;
  isOwner: boolean;
  onDone: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [mode, setMode] = useState<"reopen" | "cancel" | "reject" | null>(null);
  const [text, setText] = useState("");
  const { busy, run } = useRunner((message) => {
    setMode(null);
    setText("");
    onDone(message);
  }, onError);
  const number = ticketNumber(ticket);
  const open = isOpenTicket(ticket.status);

  if (isOwner) {
    if (!ticket.needs_owner_approval || !open) return <p className="text-xs text-slate-500">You have decided on this request.</p>;
    return mode === "reject" ? (
      <div className="space-y-2">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Reason for rejecting" className={field} />
        <div className="flex gap-2">
          <button type="button" disabled={busy || !text.trim()} className={danger}
            onClick={() => run(() => ownerDecision(ticket.id, "REJECTED", text.trim()), "You rejected the access request.")}>
            Reject access
          </button>
          <button type="button" onClick={() => setMode(null)} className={secondary}>Back</button>
        </div>
      </div>
    ) : (
      <div className="space-y-2">
        <p className="text-xs text-slate-600">
          You own {ticket.access_resource_name}. {ticket.requested_by_name} asks for {ticket.access_level} access
          {ticket.access_until ? ` until ${formatDate(ticket.access_until)}` : ""}.
        </p>
        <div className="flex gap-2">
          <button type="button" disabled={busy} className={primary}
            onClick={() => run(() => ownerDecision(ticket.id, "APPROVED"), "You approved the access request.")}>
            Approve
          </button>
          <button type="button" onClick={() => setMode("reject")} className={danger}>Reject</button>
        </div>
      </div>
    );
  }
  if (!isRequester) return null;

  if (mode === "reopen") {
    return (
      <div className="space-y-2">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="What is still wrong?" className={field} />
        <div className="flex gap-2">
          <button type="button" disabled={busy || text.trim().length < 3} className={primary}
            onClick={() => run(() => reopenTicket(ticket.id, text.trim()), `${number} reopened.`)}>
            Reopen ticket
          </button>
          <button type="button" onClick={() => setMode(null)} className={secondary}>Back</button>
        </div>
      </div>
    );
  }
  if (mode === "cancel") {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-slate-700">Cancel {number}?</span>
        <button type="button" disabled={busy} className={danger} onClick={() => run(() => cancelTicket(ticket.id), `${number} cancelled.`)}>
          Yes, cancel
        </button>
        <button type="button" onClick={() => setMode(null)} className={secondary}>Back</button>
      </div>
    );
  }
  if (ticket.status === "FULFILLED") {
    return (
      <div className="space-y-2">
        <p className="text-xs text-slate-600">Your IT team marked this as resolved. Did it work out?</p>
        <div className="flex gap-2">
          <button type="button" disabled={busy} className={primary} onClick={() => run(() => confirmTicket(ticket.id), `${number} confirmed and closed.`)}>
            Yes, close it
          </button>
          <button type="button" onClick={() => setMode("reopen")} className={secondary}>No, reopen</button>
        </div>
      </div>
    );
  }
  if (open) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-slate-600">
          {ticket.status === "WAITING_USER"
            ? "Your IT team needs more information: reply in the comments below."
            : `Your ticket is ${ticketStatusLabel(ticket.status, ticket.ticket_type).toLowerCase()}. You are notified at every step.`}
        </p>
        <button type="button" onClick={() => setMode("cancel")} className={secondary}>Cancel ticket</button>
      </div>
    );
  }
  return <p className="text-xs text-slate-500">This ticket is {ticketStatusLabel(ticket.status, ticket.ticket_type).toLowerCase()}.</p>;
}

function Comments({
  ticket,
  comments,
  staff,
  canWrite,
  onAdded,
  onError,
}: {
  ticket: AssetRequest;
  comments: TicketComment[];
  staff: boolean;
  canWrite: boolean;
  onAdded: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const { busy, run } = useRunner(() => {
    setBody("");
    onAdded(internal ? "Internal note added." : "Comment added.");
  }, onError);
  return (
    <Section title={`Conversation (${comments.length})`} icon={<ChatBubbleLeftRightIcon className="h-4 w-4" aria-hidden="true" />}>
      {comments.length === 0 ? (
        <p className="text-xs text-slate-500">No comments yet.</p>
      ) : (
        <ul className="space-y-2">
          {comments.map((comment) => (
            <li
              key={comment.id}
              className={`rounded-lg border px-3 py-2 text-xs ${
                comment.internal ? "border-amber-200 bg-amber-50" : comment.author_is_staff ? "border-blue-100 bg-blue-50/50" : "border-slate-100 bg-slate-50"
              }`}
            >
              <p className="font-semibold text-slate-800">
                {comment.author_name}
                {comment.author_is_staff && <span className="ml-1 text-[10px] font-bold text-blue-700">IT team</span>}
                {comment.internal && <span className="ml-1 text-[10px] font-bold text-amber-700">Internal note</span>}
                <span className="ml-2 font-normal text-slate-400">{formatDateTime(comment.created_at)}</span>
              </p>
              <p className="mt-1 whitespace-pre-line text-slate-700">{comment.body}</p>
            </li>
          ))}
        </ul>
      )}
      {(canWrite || staff) && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (body.trim()) run(() => addComment(ticket.id, body.trim(), internal), "");
          }}
          className="mt-3 space-y-2"
        >
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            maxLength={4000}
            placeholder={staff ? (internal ? "Internal note (IT team only)" : "Reply to the requester") : "Write a comment"}
            aria-label="Comment"
            className={field}
          />
          <div className="flex items-center gap-3">
            <button type="submit" disabled={busy || !body.trim() || (!canWrite && !internal)} className={primary}>
              {busy ? "Sending…" : internal ? "Add internal note" : "Send"}
            </button>
            {staff && (
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
                Internal note
              </label>
            )}
          </div>
        </form>
      )}
    </Section>
  );
}

function Files({
  ticket,
  files,
  canUpload,
  onChange,
  onError,
}: {
  ticket: AssetRequest;
  files: TicketAttachment[];
  canUpload: boolean;
  onChange: (m: string) => void;
  onError: (m: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(list)) await uploadAttachment(ticket.id, file);
      onChange(list.length === 1 ? `${list[0].name} attached.` : `${list.length} files attached.`);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Could not attach the file.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <Section title={`Files (${files.length})`} icon={<PaperClipIcon className="h-4 w-4" aria-hidden="true" />}>
      {files.length === 0 ? (
        <p className="text-xs text-slate-500">No files attached.</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-xs">
          {files.map((file) => (
            <li key={file.id} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <span className="block truncate font-semibold text-slate-800">{file.filename}</span>
                <span className="text-slate-400">
                  {formatSize(file.size)} · {file.uploaded_by_name} · {formatDateTime(file.created_at)}
                </span>
              </span>
              <button
                type="button"
                onClick={() => downloadAttachment(ticket.id, file).catch((caught) => onError(caught instanceof Error ? caught.message : "Download failed."))}
                className="shrink-0 font-semibold text-brand-600 hover:text-brand-700"
              >
                Download
              </button>
            </li>
          ))}
        </ul>
      )}
      {canUpload && (
        <div className="mt-3">
          <input
            ref={input}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
            onChange={(e) => upload(e.target.files)}
            disabled={busy}
            aria-label="Attach files"
            className="text-xs"
          />
          <p className="mt-1 text-[11px] text-slate-400">{busy ? "Uploading…" : "Images or PDFs, up to 2 MB each."}</p>
        </div>
      )}
    </Section>
  );
}

export { TicketStatusBadge };
