"use client";

import { useCallback, useEffect, useState } from "react";
import { PlusIcon } from "@heroicons/react/24/outline";
import { DEPLOYMENT_LABEL, licenseTypeLabel, mySoftware, type SoftwareSeat } from "@/lib/software";
import { isOpenTicket, listAssetCategories, listAssetRequests, type AssetCategory, type AssetRequest } from "@/lib/tickets";
import { listDepartments } from "@/lib/users";
import type { Department } from "@/types/user";
import { formatDate } from "@/types/asset";
import { NewTicketForm } from "@/components/tickets/ticket-queue";
import { TicketStatusBadge, ticketNumber } from "@/components/tickets/ticket-actions";

/** The user's software seats and their software requests. License numbers are masked. */
export function MySoftware() {
  const [seats, setSeats] = useState<SoftwareSeat[]>([]);
  const [requests, setRequests] = useState<AssetRequest[]>([]);
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(() => {
    Promise.all([mySoftware(), listAssetRequests({ limit: 100 })])
      .then(([seatData, ticketData]) => {
        setSeats(seatData);
        setRequests(ticketData.filter((t) => t.ticket_type === "SOFTWARE"));
        setError("");
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load your software."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);
  useEffect(() => {
    if (!formOpen) return;
    listAssetCategories().then(setCategories).catch(() => undefined);
    listDepartments().then(setDepartments).catch(() => undefined);
  }, [formOpen]);

  const open = requests.filter((t) => isOpenTicket(t.status));

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <p className="max-w-3xl text-xs text-slate-500">
          Software you have a seat of, and your requests for more. Your IT Admin approves each request.
        </p>
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          disabled={formOpen}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          <PlusIcon className="h-4 w-4" aria-hidden="true" /> Request software
        </button>
      </header>

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-800">{error}</div>}
      {notice && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800">{notice}</div>}

      {formOpen && (
        <NewTicketForm
          categories={categories}
          onCategoryCreated={(category) => setCategories((current) => [...current, category])}
          departments={departments}
          users={[]}
          forOthers={false}
          initialType="SOFTWARE"
          onCancel={() => setFormOpen(false)}
          onCreated={(ticket, fileProblem) => {
            setFormOpen(false);
            setNotice(`Request ${ticketNumber(ticket)} for ${ticket.software_name ?? "software"} sent. You will be notified when it is approved.${fileProblem ? ` ${fileProblem}` : ""}`);
            load();
          }}
        />
      )}

      <section className="ui-surface overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-bold">My software ({seats.length})</h2>
        </div>
        {seats.length === 0 ? (
          <p className="p-6 text-center text-xs text-slate-500">{loading ? "Loading…" : "You have no software seats yet. Use Request software."}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {seats.map((seat) => {
              const expired = seat.expiry_date && new Date(seat.expiry_date) < new Date();
              return (
                <li key={seat.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs">
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-800">{seat.software_name}</span>
                    <span className="block text-slate-500">
                      {seat.license_type ? licenseTypeLabel(seat.license_type) : "License"}
                      {seat.license_number ? ` · ${seat.license_number}` : ""}
                      {seat.asset_label ? ` · on ${seat.asset_label}` : ""} · since {formatDate(seat.assigned_at)}
                    </span>
                    {seat.deployment_status && (
                      <span className={`mt-0.5 block font-semibold ${seat.deployment_status === "FAILED" ? "text-rose-600" : seat.deployment_status === "PENDING" ? "text-amber-700" : "text-emerald-700"}`}>
                        {DEPLOYMENT_LABEL[seat.deployment_status] ?? seat.deployment_status}
                        {seat.deployment_note ? `: ${seat.deployment_note}` : ""}
                      </span>
                    )}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${expired ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
                    {seat.expiry_date ? `${expired ? "Expired" : "Valid until"} ${formatDate(seat.expiry_date)}` : "No expiry"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="ui-surface overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-bold">My software requests ({open.length} open)</h2>
        </div>
        {requests.length === 0 ? (
          <p className="p-6 text-center text-xs text-slate-500">No software requests yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {requests.map((ticket) => (
              <li key={ticket.id} className="flex items-start justify-between gap-3 px-4 py-3 text-xs">
                <span className="min-w-0">
                  <span className="block font-semibold text-slate-800">
                    {ticketNumber(ticket)} · {ticket.software_name ?? "Software"}
                  </span>
                  <span className="block truncate text-slate-500">{ticket.reason}</span>
                  {ticket.rejection_reason && <span className="block text-rose-600">Rejected: {ticket.rejection_reason}</span>}
                </span>
                <TicketStatusBadge status={ticket.status} ticketType={ticket.ticket_type} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
