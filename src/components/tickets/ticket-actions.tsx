"use client";

import { useState } from "react";
import {
  approveTicket,
  cancelTicket,
  fulfilTicket,
  rejectTicket,
  releaseTicket,
  startTicket,
  ticketStatusLabel,
  ticketStatusStyle,
  type AssetRequest,
} from "@/lib/tickets";
import type { Asset } from "@/types/asset";

export function ticketNumber(ticket: AssetRequest): string {
  return `#${ticket.id.slice(0, 6).toUpperCase()}`;
}

export function TicketStatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset ${ticketStatusStyle(status)}`}>
      {ticketStatusLabel(status)}
    </span>
  );
}

const STEPS = ["PENDING", "IN_PROGRESS", "APPROVED", "FULFILLED"] as const;

/** Badge plus a four-step bar showing how far the ticket has got. */
export function TicketProgress({ status }: { status: string }) {
  const reached = STEPS.indexOf(status as (typeof STEPS)[number]);
  return (
    <div className="space-y-1.5">
      <TicketStatusBadge status={status} />
      {reached >= 0 && (
        <div className="flex w-28 gap-0.5" aria-hidden="true">
          {STEPS.map((step, index) => (
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
      return `Fulfilled by ${ticket.processed_by_name}`;
    case "REJECTED":
      return `Rejected by ${ticket.processed_by_name}`;
    case "CANCELLED":
      return `Cancelled by ${ticket.processed_by_name}`;
    default:
      return null;
  }
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
}: {
  ticket: AssetRequest;
  /** In-stock assets to choose from when fulfilling. */
  stock: Asset[];
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [mode, setMode] = useState<"fulfil" | "reject" | "cancel" | null>(null);
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
