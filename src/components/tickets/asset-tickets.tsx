"use client";

import { useCallback, useEffect, useState } from "react";
import { listAssetRequests, type AssetRequest } from "@/lib/tickets";
import { TicketActions, TicketProgress, ticketHandler, ticketNumber } from "@/components/tickets/ticket-actions";

function when(value: string): string {
  return new Date(value).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Problem tickets raised on one asset, resolvable from the asset page (admins). */
export function AssetTickets({ assetId, onChanged }: { assetId: string; onChanged: () => void }) {
  const [tickets, setTickets] = useState<AssetRequest[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    listAssetRequests({ asset_id: assetId, limit: 50 })
      .then(setTickets)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load tickets."));
  }, [assetId]);

  useEffect(load, [load]);

  const open = tickets.filter((ticket) => ["PENDING", "IN_PROGRESS"].includes(ticket.status)).length;

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-6 py-4">
        <h2 className="font-semibold text-slate-900">
          Tickets on this asset
          {open > 0 && (
            <span className="ml-2 rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-bold text-orange-700">{open} open</span>
          )}
        </h2>
        <p className="mt-1 text-sm text-slate-500">Problems reported by the person holding it. Resolve them here with a note.</p>
      </div>
      {notice && <p className="border-b border-emerald-100 bg-emerald-50 px-6 py-2 text-xs text-emerald-800">{notice}</p>}
      {error && <p className="border-b border-red-100 bg-red-50 px-6 py-2 text-xs text-red-800">{error}</p>}
      {tickets.length === 0 ? (
        <p className="px-6 py-6 text-sm text-slate-500">No problems have been reported for this asset.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {tickets.map((ticket) => {
            const handler = ticketHandler(ticket);
            return (
              <li key={ticket.id} className="flex flex-col gap-3 px-6 py-4 text-sm lg:flex-row lg:items-start lg:justify-between">
                <div className="flex min-w-0 gap-4">
                  <TicketProgress status={ticket.status} ticketType={ticket.ticket_type} />
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800">
                      {ticketNumber(ticket)} · {ticket.requested_by_name ?? ticket.requested_for}
                    </p>
                    <p className="text-slate-600">{ticket.reason}</p>
                    {ticket.resolution_note && (
                      <p className="mt-0.5 text-xs text-emerald-700">Resolution: {ticket.resolution_note}</p>
                    )}
                    {ticket.rejection_reason && <p className="mt-0.5 text-xs text-rose-600">Rejected: {ticket.rejection_reason}</p>}
                    <p className="mt-0.5 text-xs text-slate-400">
                      Reported {when(ticket.created_at)}
                      {handler ? ` · ${handler}` : ""}
                    </p>
                  </div>
                </div>
                <div className="shrink-0">
                  <TicketActions
                    ticket={ticket}
                    stock={[]}
                    onDone={(message) => {
                      setNotice(message);
                      setError("");
                      load();
                      onChanged();
                    }}
                    onError={setError}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
