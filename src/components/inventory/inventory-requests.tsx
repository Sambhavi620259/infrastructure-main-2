"use client";

import { useEffect, useState } from "react";
import { decideInventoryRequest, listInventoryRequests, type InventoryRequest } from "@/lib/inventory";

const STATUS_META: Record<InventoryRequest["status"], { label: string; style: string }> = {
  PENDING: { label: "Waiting for approval", style: "bg-amber-50 text-amber-700 ring-amber-200" },
  APPROVED: { label: "Approved · issued", style: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  REJECTED: { label: "Rejected", style: "bg-rose-50 text-rose-700 ring-rose-200" },
  CANCELLED: { label: "Cancelled", style: "bg-slate-100 text-slate-600 ring-slate-200" },
};

function when(value: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * Stock requests. Admins see the organization's queue and approve (issuing
 * the stock) or reject; users see their own requests and can cancel pending ones.
 */
export function InventoryRequests({
  admin,
  refreshKey,
  onChanged,
}: {
  admin: boolean;
  /** Bumped by the parent after a new request, to reload. */
  refreshKey: number;
  /** Called after a decision so the parent can reload stock levels. */
  onChanged: (message: string) => void;
}) {
  const [requests, setRequests] = useState<InventoryRequest[]>([]);
  const [showAll, setShowAll] = useState(!admin);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listInventoryRequests(showAll ? undefined : "PENDING")
      .then((data) => {
        if (!cancelled) {
          setRequests(data);
          setError("");
        }
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load stock requests.");
      });
    return () => {
      cancelled = true;
    };
  }, [showAll, refreshKey, reload]);

  const done = (message: string) => {
    setReload((key) => key + 1);
    onChanged(message);
  };

  const pending = requests.filter((request) => request.status === "PENDING").length;

  return (
    <section className="ui-surface overflow-hidden">
      <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-bold">
            {admin ? "Stock requests" : "My requests"}
            {pending > 0 && (
              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                {pending} waiting
              </span>
            )}
          </h2>
          <p className="text-[11px] text-slate-500">
            {admin
              ? "Approving issues the stock to the user and lowers the quantity."
              : "Your IT Admin approves each request and issues the stock to you."}
          </p>
        </div>
        {admin && (
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />
            Show approved and rejected too
          </label>
        )}
      </div>
      {error && <p className="px-4 py-3 text-xs text-red-700">{error}</p>}
      {requests.length === 0 && !error ? (
        <p className="p-6 text-center text-xs text-slate-500">
          {admin
            ? showAll
              ? "No stock requests yet."
              : "No requests waiting for approval."
            : "You have not requested anything yet. Pick an item below and choose Request."}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {requests.map((request) => (
            <RequestRow key={request.id} request={request} admin={admin} onDone={done} onError={setError} />
          ))}
        </ul>
      )}
    </section>
  );
}

function RequestRow({
  request,
  admin,
  onDone,
  onError,
}: {
  request: InventoryRequest;
  admin: boolean;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [mode, setMode] = useState<"reject" | "cancel" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const meta = STATUS_META[request.status];
  const short = request.available !== null && request.available < request.quantity;
  const item = request.item_name ?? "item";

  const decide = async (status: "APPROVED" | "REJECTED" | "CANCELLED") => {
    setBusy(true);
    try {
      await decideInventoryRequest(request.id, status, status === "REJECTED" ? reason.trim() : undefined);
      setMode(null);
      onDone(
        status === "APPROVED"
          ? `Issued ${request.quantity} × ${item} to ${request.requested_by_name ?? "the user"}.`
          : status === "REJECTED"
            ? `Request for ${item} rejected.`
            : `Request for ${item} cancelled.`,
      );
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex flex-col gap-2 px-4 py-3 text-xs lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <p className="font-semibold text-slate-800">
          {request.quantity} × {item}
          {admin && <span className="font-normal text-slate-500"> · for {request.requested_by_name ?? "a user"}</span>}
        </p>
        <p className="text-slate-600">{request.reason}</p>
        <p className="mt-0.5 text-[11px] text-slate-400">
          Requested {when(request.created_at)}
          {request.processed_by_name && request.status !== "PENDING"
            ? ` · ${meta.label.split(" ·")[0]} by ${request.processed_by_name} ${when(request.processed_at)}`
            : ""}
        </p>
        {request.rejection_reason && <p className="mt-0.5 text-[11px] text-rose-600">Reason: {request.rejection_reason}</p>}
        {admin && request.status === "PENDING" && request.available !== null && (
          <p className={`mt-0.5 text-[11px] ${short ? "text-rose-600" : "text-slate-500"}`}>
            {request.available} in stock{short ? " — not enough to approve yet" : ""}
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset ${meta.style}`}>{meta.label}</span>
        {request.status === "PENDING" && mode === null && (
          <>
            {admin && (
              <>
                <button
                  type="button"
                  disabled={busy || short}
                  onClick={() => decide("APPROVED")}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Approve & issue"}
                </button>
                <button type="button" disabled={busy} onClick={() => setMode("reject")} className="font-semibold text-rose-600 hover:text-rose-700">
                  Reject
                </button>
              </>
            )}
            {!admin && (
              <button type="button" disabled={busy} onClick={() => setMode("cancel")} className="font-semibold text-slate-500 hover:text-slate-700">
                Cancel request
              </button>
            )}
          </>
        )}
        {mode === "reject" && (
          <>
            <label>
              <span className="sr-only">Reason for rejecting</span>
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={300}
                placeholder="Reason for rejecting"
                className="w-52 rounded-lg border border-slate-200 px-2 py-1.5"
              />
            </label>
            <button
              type="button"
              disabled={busy || !reason.trim()}
              onClick={() => decide("REJECTED")}
              className="rounded-lg bg-rose-600 px-3 py-1.5 font-bold text-white hover:bg-rose-700 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Reject"}
            </button>
            <button type="button" onClick={() => setMode(null)} className="font-semibold text-slate-600">
              Back
            </button>
          </>
        )}
        {mode === "cancel" && (
          <>
            <span className="font-semibold text-slate-700">Cancel this request?</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => decide("CANCELLED")}
              className="rounded-lg bg-slate-700 px-3 py-1.5 font-bold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Yes, cancel"}
            </button>
            <button type="button" onClick={() => setMode(null)} className="font-semibold text-slate-600">
              Back
            </button>
          </>
        )}
      </div>
    </li>
  );
}
