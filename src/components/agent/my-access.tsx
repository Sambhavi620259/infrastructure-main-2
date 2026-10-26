"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PlusIcon } from "@heroicons/react/24/outline";
import { myAccess, type AccessGrant } from "@/lib/access-management";
import {
  isOpenTicket,
  listAssetCategories,
  listAssetRequests,
  type AssetCategory,
  type AssetRequest,
} from "@/lib/tickets";
import { listDepartments } from "@/lib/users";
import type { Department } from "@/types/user";
import { formatDate } from "@/types/asset";
import { NewTicketForm } from "@/components/tickets/ticket-queue";
import { TicketStatusBadge, ticketNumber } from "@/components/tickets/ticket-actions";

/** The user's access to applications and resources, their access requests, and requests waiting for them as owner. */
export function MyAccess() {
  const [grants, setGrants] = useState<AccessGrant[]>([]);
  const [requests, setRequests] = useState<AssetRequest[]>([]);
  const [toApprove, setToApprove] = useState<AssetRequest[]>([]);
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(() => {
    Promise.all([myAccess(), listAssetRequests({ mine: true, limit: 200 }), listAssetRequests({ awaiting_my_approval: true, limit: 100 })])
      .then(([grantData, ticketData, approvalData]) => {
        setGrants(grantData);
        setRequests(ticketData.filter((t) => t.ticket_type === "ACCESS"));
        setToApprove(approvalData);
        setError("");
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load your access."));
  }, []);

  useEffect(load, [load]);
  useEffect(() => {
    if (!formOpen) return;
    listAssetCategories().then(setCategories).catch(() => undefined);
    listDepartments().then(setDepartments).catch(() => undefined);
  }, [formOpen]);

  const current = grants.filter((g) => g.is_active);
  const ended = grants.filter((g) => !g.is_active);

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <p className="max-w-3xl text-xs text-slate-500">
          Applications, databases, VPN and folders you can use. Requests are approved by your IT team (and the resource owner).
        </p>
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          disabled={formOpen}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          <PlusIcon className="h-4 w-4" aria-hidden="true" /> Request access
        </button>
      </header>

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-800">{error}</div>}
      {notice && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800">{notice}</div>}

      {formOpen && (
        <NewTicketForm
          categories={categories}
          onCategoryCreated={(category) => setCategories((c) => [...c, category])}
          departments={departments}
          users={[]}
          forOthers={false}
          initialType="ACCESS"
          onCancel={() => setFormOpen(false)}
          onCreated={(ticket, fileProblem) => {
            setFormOpen(false);
            setNotice(`Request ${ticketNumber(ticket)} for ${ticket.access_level} access to ${ticket.access_resource_name} submitted.${fileProblem ? ` ${fileProblem}` : ""}`);
            load();
          }}
        />
      )}

      {toApprove.length > 0 && (
        <section className="ui-surface overflow-hidden border-amber-200">
          <div className="border-b border-amber-100 bg-amber-50 px-4 py-3">
            <h2 className="text-sm font-bold text-amber-900">Waiting for your approval ({toApprove.length})</h2>
            <p className="text-xs text-amber-800">You own these resources. Open a request to approve or reject it.</p>
          </div>
          <ul className="divide-y divide-slate-100">
            {toApprove.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-3 text-xs">
                <span>
                  <span className="block font-semibold text-slate-800">
                    {t.requested_by_name}: {t.access_level} access to {t.access_resource_name}
                  </span>
                  <span className="text-slate-500">{t.reason}</span>
                </span>
                <Link href={`/agent/tickets/${t.id}`} className="shrink-0 rounded-lg bg-brand-600 px-3 py-1.5 font-bold text-white">Review</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="ui-surface overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-bold">My access ({current.length})</h2>
        </div>
        {current.length === 0 ? (
          <p className="p-6 text-center text-xs text-slate-500">You have no access recorded yet. Use Request access.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {current.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs">
                <span>
                  <span className="block text-sm font-semibold text-slate-800">{g.resource_name}</span>
                  <span className="text-slate-500">Given {formatDate(g.granted_at)} by {g.granted_by_name}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${g.privileged ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-600"}`}>{g.access_level}</span>
                  <span className="text-slate-500">{g.expires_at ? `until ${formatDate(g.expires_at)}` : "no end date"}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="ui-surface overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-bold">My access requests ({requests.filter((r) => isOpenTicket(r.status)).length} open)</h2>
        </div>
        {requests.length === 0 ? (
          <p className="p-6 text-center text-xs text-slate-500">No access requests yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {requests.map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-3 px-4 py-3 text-xs">
                <Link href={`/agent/tickets/${t.id}`} className="min-w-0 hover:text-brand-700">
                  <span className="block font-semibold text-slate-800">
                    {ticketNumber(t)} · {t.access_level} access to {t.access_resource_name}
                  </span>
                  <span className="block truncate text-slate-500">{t.reason}</span>
                </Link>
                <TicketStatusBadge status={t.status} ticketType={t.ticket_type} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {ended.length > 0 && (
        <section className="ui-surface overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-bold">Ended access</h2>
          </div>
          <ul className="divide-y divide-slate-100">
            {ended.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs text-slate-500">
                <span>
                  {g.resource_name} · {g.access_level}
                </span>
                <span>
                  Ended {formatDate(g.revoked_at)}
                  {g.revoke_reason ? `: ${g.revoke_reason}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
