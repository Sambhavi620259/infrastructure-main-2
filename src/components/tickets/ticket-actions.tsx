"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  approveTicket,
  cancelTicket,
  fulfilTicket,
  RETURN_CONDITIONS,
  confirmReturnTicket,
  fulfilSoftwareTicket,
  rejectTicket,
  releaseTicket,
  resolveTicket,
  startTicket,
  ticketStatusLabel,
  ticketStatusStyle,
  type AssetRequest,
} from "@/lib/tickets";
import { assetStatusLabel, formatDate, type Asset, type AssetStatus, assetLabel } from "@/types/asset";
import { listSoftware, type Software } from "@/lib/software";

export function ticketNumber(ticket: AssetRequest): string {
  return `#${ticket.id.slice(0, 6).toUpperCase()}`;
}

export function TicketStatusBadge({ status, ticketType }: { status: string; ticketType?: string }) {
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset ${ticketStatusStyle(status)}`}>
      {ticketStatusLabel(status, ticketType)}
    </span>
  );
}

/** "Asset request" or "Problem" chip. */
const TYPE_CHIP: Record<string, [string, string]> = {
  ISSUE: ["Problem", "bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-200"],
  SOFTWARE: ["Software", "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200"],
  RETURN: ["Return", "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200"],
  REQUEST: ["Asset request", "bg-slate-100 text-slate-600"],
};

/** "Asset request", "Problem", "Software" or "Return" chip. */
export function TicketTypeChip({ ticketType }: { ticketType: string }) {
  const [text, style] = TYPE_CHIP[ticketType] ?? TYPE_CHIP.REQUEST;
  return <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-bold ${style}`}>{text}</span>;
}

const REQUEST_STEPS = ["PENDING", "IN_PROGRESS", "APPROVED", "FULFILLED"];
const ISSUE_STEPS = ["PENDING", "IN_PROGRESS", "FULFILLED"];

/** Badge plus a bar showing how far the ticket has got. */
export function TicketProgress({ status, ticketType }: { status: string; ticketType?: string }) {
  const steps = ticketType === "ISSUE" ? ISSUE_STEPS : REQUEST_STEPS;
  const reached = steps.indexOf(status);
  return (
    <div className="space-y-1.5">
      <TicketStatusBadge status={status} ticketType={ticketType} />
      {reached >= 0 && (
        <div className="flex w-28 gap-0.5" aria-hidden="true">
          {steps.map((step, index) => (
            <span
              key={step}
              className={`h-1 flex-1 rounded-full ${
                index > reached ? "bg-slate-200" : status === "FULFILLED" ? "bg-emerald-500" : "bg-brand-500"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Who did what last, e.g. "In progress with Asha" or "Fulfilled by Ravi". */
export function ticketHandler(ticket: AssetRequest): string | null {
  if (!ticket.processed_by_name) return null;
  switch (ticket.status) {
    case "IN_PROGRESS":
      return `Being handled by ${ticket.processed_by_name}`;
    case "APPROVED":
      return `Approved by ${ticket.processed_by_name}`;
    case "FULFILLED":
      return `${
        ticket.ticket_type === "ISSUE" ? "Resolved" : ticket.ticket_type === "RETURN" ? "Received" : "Fulfilled"
      } by ${ticket.processed_by_name}`;
    case "REJECTED":
      return `Rejected by ${ticket.processed_by_name}`;
    case "CANCELLED":
      return `Cancelled by ${ticket.processed_by_name}`;
    default:
      return null;
  }
}

/**
 * The asset a problem ticket is about, with what an admin needs to resolve it.
 * `link` adds a link to the asset page (admins only).
 */
export function TicketAssetDetails({ ticket, link = false }: { ticket: AssetRequest; link?: boolean }) {
  const asset = ticket.asset;
  if (!asset) return null;
  const facts = [
    [asset.brand, asset.model].filter(Boolean).join(" ") || null,
    `S/N ${asset.serial_number}`,
    assetStatusLabel(asset.status as AssetStatus),
    asset.condition ? `Condition ${asset.condition.toLowerCase()}` : null,
    asset.warranty_end ? `Warranty until ${formatDate(asset.warranty_end)}` : "No warranty on record",
  ].filter(Boolean);
  return (
    <div className="mt-1 rounded-md border border-orange-100 bg-orange-50/50 px-2 py-1.5 text-[11px] text-slate-600">
      <p className="font-semibold text-slate-800">
        {link ? (
          <Link href={`/assets/${asset.id}`} className="hover:text-brand-700 hover:underline">
            {assetLabel(asset)} · {asset.name}
          </Link>
        ) : (
          `${assetLabel(asset)} · ${asset.name}`
        )}
      </p>
      <p>{facts.join(" · ")}</p>
    </div>
  );
}

/**
 * The next steps available for a ticket in its current status. Mirrors
 * _NEXT_STATUS in backend/app/routers/asset_requests.py.
 */
export function TicketActions({
  ticket,
  stock,
  onDone,
  onError,
  canHandle = true,
}: {
  ticket: AssetRequest;
  /** In-stock assets to choose from when fulfilling. */
  stock: Asset[];
  /** False for users: they can only cancel their own open ticket; admins work the queue. */
  canHandle?: boolean;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [mode, setMode] = useState<"fulfil" | "reject" | "cancel" | "resolve" | "handover" | null>(null);
  const [note, setNote] = useState("");
  const [condition, setCondition] = useState<(typeof RETURN_CONDITIONS)[number] | "">("");
  const [assetId, setAssetId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const number = ticketNumber(ticket);

  const run = async (action: () => Promise<AssetRequest>, message: (updated: AssetRequest) => string) => {
    setBusy(true);
    try {
      const updated = await action();
      setMode(null);
      onDone(message(updated));
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  };

  const status = ticket.status;
  if (status !== "PENDING" && status !== "IN_PROGRESS" && status !== "APPROVED") return null;

  // Suggest stock in the ticket's category first.
  const category = ticket.category_name?.toLowerCase() ?? "";
  const options = [...stock].sort(
    (a, b) => Number(b.category.toLowerCase() === category) - Number(a.category.toLowerCase() === category),
  );

  const link = "font-semibold disabled:opacity-50";

  if (mode === "cancel") {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
        <span className="font-semibold text-slate-700">Cancel {number}?</span>
        <button
          type="button"
          disabled={busy}
          onClick={() => run(() => cancelTicket(ticket.id), () => `${number} cancelled.`)}
          className="rounded-lg bg-slate-700 px-3 py-1.5 font-bold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Yes, cancel"}
        </button>
        <button type="button" onClick={() => setMode(null)} className="px-1 font-semibold text-slate-600">
          Back
        </button>
      </div>
    );
  }

  if (mode === "handover") {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <label>
          <span className="sr-only">Condition on return</span>
          <select
            value={condition}
            onChange={(event) => setCondition(event.target.value as (typeof RETURN_CONDITIONS)[number])}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs"
          >
            <option value="">Condition it came back in…</option>
            {RETURN_CONDITIONS.map((c) => (
              <option key={c} value={c}>{c.charAt(0) + c.slice(1).toLowerCase()}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={busy || !condition}
          onClick={() =>
            condition &&
            run(
              () => confirmReturnTicket(ticket.id, condition),
              () =>
                `${number}: device received${
                  condition === "POOR" ? " and sent for repair" : condition === "DAMAGED" ? " and filed as damaged" : " and back in stock"
                }.`,
            )
          }
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Confirm handover"}
        </button>
        <button type="button" onClick={() => setMode(null)} className="px-1 text-xs font-semibold text-slate-600">Back</button>
      </div>
    );
  }

  if (mode === "resolve") {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <label>
          <span className="sr-only">How it was resolved</span>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={1000}
            placeholder="What was done, e.g. replaced the battery"
            className="w-64 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
          />
        </label>
        <button
          type="button"
          disabled={busy || !note.trim()}
          onClick={() => run(() => resolveTicket(ticket.id, note.trim()), () => `${number} resolved.`)}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Mark resolved"}
        </button>
        <button type="button" onClick={() => setMode(null)} className="px-1 text-xs font-semibold text-slate-600">
          Back
        </button>
      </div>
    );
  }

  if (mode) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        {mode === "fulfil" ? (
          stock.length === 0 ? (
            <span className="text-xs text-amber-700">No assets in stock. Approve it to wait for stock instead.</span>
          ) : (
            <label>
              <span className="sr-only">Asset to hand over</span>
              <select
                value={assetId}
                onChange={(event) => setAssetId(event.target.value)}
                className="w-56 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs"
              >
                <option value="">Choose an in-stock asset…</option>
                {options.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {assetLabel(asset)} · {asset.name} ({asset.category})
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
              className="w-56 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
            />
          </label>
        )}
        <button
          type="button"
          disabled={busy || (mode === "fulfil" ? !assetId : !reason.trim())}
          onClick={() =>
            mode === "fulfil"
              ? run(
                  () => fulfilTicket(ticket.id, assetId),
                  (updated) => `${number} fulfilled: ${updated.assigned_asset_tag} assigned to ${updated.requested_by_name}.`,
                )
              : run(() => rejectTicket(ticket.id, reason.trim()), () => `${number} rejected.`)
          }
          className={`rounded-lg px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50 ${
            mode === "fulfil" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"
          }`}
        >
          {busy ? "Saving…" : mode === "fulfil" ? "Assign & fulfil" : "Reject ticket"}
        </button>
        <button type="button" onClick={() => setMode(null)} className="px-1 text-xs font-semibold text-slate-600">
          Back
        </button>
      </div>
    );
  }

  if (!canHandle) {
    return (
      <button type="button" disabled={busy} onClick={() => setMode("cancel")} className={`${link} text-xs text-slate-500 hover:text-slate-700`}>
        Cancel ticket
      </button>
    );
  }

  // Software access and device returns: approve first, then fulfil (seat / handover) as its own step.
  if (ticket.ticket_type === "SOFTWARE" || ticket.ticket_type === "RETURN") {
    const isSoftware = ticket.ticket_type === "SOFTWARE";
    return (
      <span className="inline-flex flex-wrap justify-end gap-x-3 gap-y-1 text-xs">
        {status === "PENDING" && (
          <button type="button" disabled={busy} className={`${link} text-blue-700 hover:text-blue-800`}
            onClick={() => run(() => startTicket(ticket.id), () => `${number} is now in progress with you.`)}>
            Start work
          </button>
        )}
        {status !== "APPROVED" && (
          <button type="button" disabled={busy} className={`${link} text-violet-700 hover:text-violet-800`}
            onClick={() => run(() => approveTicket(ticket.id), () => `${number} approved.`)}>
            Approve
          </button>
        )}
        {status === "APPROVED" &&
          (isSoftware ? (
            ticket.software_id ? (
              <button type="button" disabled={busy} className={`${link} text-emerald-700 hover:text-emerald-800`}
                onClick={() => run(() => fulfilSoftwareTicket(ticket.id), () => `${number}: seat of ${ticket.software_name} assigned.`)}>
                Assign seat
              </button>
            ) : (
              <PickSoftware
                requestedName={ticket.software_name ?? "the software"}
                busy={busy}
                onAssign={(softwareId, name) =>
                  run(() => fulfilSoftwareTicket(ticket.id, undefined, softwareId), () => `${number}: seat of ${name} assigned.`)
                }
              />
            )
          ) : (
            <button type="button" disabled={busy} onClick={() => setMode("handover")} className={`${link} text-emerald-700 hover:text-emerald-800`}>
              Confirm handover
            </button>
          ))}
        {status !== "APPROVED" && (
          <button type="button" disabled={busy} onClick={() => setMode("reject")} className={`${link} text-rose-600 hover:text-rose-700`}>
            Reject
          </button>
        )}
        {status === "IN_PROGRESS" && (
          <button type="button" disabled={busy} className={`${link} text-slate-600 hover:text-slate-800`}
            onClick={() => run(() => releaseTicket(ticket.id), () => `${number} is back in the pending queue.`)}>
            Release
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => setMode("cancel")} className={`${link} text-slate-500 hover:text-slate-700`}>
          Cancel ticket
        </button>
      </span>
    );
  }

  if (ticket.ticket_type === "ISSUE") {
    return (
      <span className="inline-flex flex-wrap justify-end gap-x-3 gap-y-1 text-xs">
        {status === "PENDING" && (
          <button type="button" disabled={busy} className={`${link} text-blue-700 hover:text-blue-800`}
            onClick={() => run(() => startTicket(ticket.id), () => `${number} is now in progress with you.`)}>
            Start work
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => setMode("resolve")} className={`${link} text-emerald-700 hover:text-emerald-800`}>
          Resolve
        </button>
        <button type="button" disabled={busy} onClick={() => setMode("reject")} className={`${link} text-rose-600 hover:text-rose-700`}>
          Reject
        </button>
        {status === "IN_PROGRESS" && (
          <button type="button" disabled={busy} className={`${link} text-slate-600 hover:text-slate-800`}
            onClick={() => run(() => releaseTicket(ticket.id), () => `${number} is back in the pending queue.`)}>
            Release
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => setMode("cancel")} className={`${link} text-slate-500 hover:text-slate-700`}>
          Cancel ticket
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap justify-end gap-x-3 gap-y-1 text-xs">
      {status === "PENDING" && (
        <button type="button" disabled={busy} className={`${link} text-blue-700 hover:text-blue-800`}
          onClick={() => run(() => startTicket(ticket.id), () => `${number} is now in progress with you.`)}>
          Start work
        </button>
      )}
      <button type="button" disabled={busy} onClick={() => setMode("fulfil")} className={`${link} text-emerald-700 hover:text-emerald-800`}>
        Assign asset
      </button>
      {status !== "APPROVED" && (
        <button type="button" disabled={busy} className={`${link} text-violet-700 hover:text-violet-800`}
          onClick={() => run(() => approveTicket(ticket.id), () => `${number} approved; it will wait for stock.`)}>
          Approve
        </button>
      )}
      {status !== "APPROVED" && (
        <button type="button" disabled={busy} onClick={() => setMode("reject")} className={`${link} text-rose-600 hover:text-rose-700`}>
          Reject
        </button>
      )}
      {status === "IN_PROGRESS" && (
        <button type="button" disabled={busy} className={`${link} text-slate-600 hover:text-slate-800`}
          onClick={() => run(() => releaseTicket(ticket.id), () => `${number} is back in the pending queue.`)}>
          Release
        </button>
      )}
      <button type="button" disabled={busy} onClick={() => setMode("cancel")} className={`${link} text-slate-500 hover:text-slate-700`}>
        Cancel ticket
      </button>
    </span>
  );
}

/**
 * A software request made by name (the software was not registered yet):
 * the admin chooses the registered product, registering it first if needed.
 */
function PickSoftware({
  requestedName,
  busy,
  onAssign,
}: {
  requestedName: string;
  busy: boolean;
  onAssign: (softwareId: string, name: string) => void;
}) {
  const [products, setProducts] = useState<Software[] | null>(null);
  const [choice, setChoice] = useState("");

  useEffect(() => {
    listSoftware()
      .then((data) => {
        setProducts(data);
        // Preselect a product with the same name, if one was registered since.
        const match = data.find((p) => p.name.trim().toLowerCase() === requestedName.trim().toLowerCase());
        if (match) setChoice(match.id);
      })
      .catch(() => setProducts([]));
  }, [requestedName]);

  const chosen = products?.find((p) => p.id === choice);
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-2">
      <span className="text-[11px] text-amber-700">Asked for by name: {requestedName}</span>
      {products && products.length > 0 && (
        <select
          value={choice}
          onChange={(event) => setChoice(event.target.value)}
          aria-label="Registered software to give"
          className="w-48 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
        >
          <option value="">Choose registered software…</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name} ({product.available_licenses} free)
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        disabled={busy || !chosen}
        onClick={() => chosen && onAssign(chosen.id, chosen.name)}
        className="font-semibold text-emerald-700 hover:text-emerald-800 disabled:opacity-50"
      >
        Assign seat
      </button>
      <Link href="/assets/software/new" className="font-semibold text-brand-600 hover:text-brand-700">
        Register {requestedName}
      </Link>
    </span>
  );
}
