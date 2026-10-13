"use client";

import { useEffect, useState } from "react";
import { TicketQueue } from "@/components/tickets/ticket-queue";
import { InventoryRequests } from "@/components/inventory/inventory-requests";
import {
  APPROVER_ROLES,
  POLICY_LABEL,
  listApprovalPolicies,
  updateApprovalPolicy,
  type ApprovalPolicy,
} from "@/lib/approvals";
import { getProfile } from "@/lib/profile";

type Tab = "tickets" | "stock" | "rules";

/** One place for everything awaiting a decision, and the rules for who decides. */
export default function RequestsPage() {
  const [tab, setTab] = useState<Tab>("tickets");
  const [stockKey, setStockKey] = useState(0);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("tab");
    if (fromUrl === "stock" || fromUrl === "rules") setTab(fromUrl);
  }, []);

  return (
    <div className="space-y-4">
      <div className="mx-auto flex max-w-[1400px] flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1 text-sm font-semibold shadow-sm sm:w-fit">
        {([["tickets", "Tickets"], ["stock", "Stock requests"], ["rules", "Approval rules"]] as const).map(([value, text]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            aria-pressed={tab === value}
            className={`flex-1 rounded-lg px-4 py-2 sm:flex-none ${tab === value ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
          >
            {text}
          </button>
        ))}
      </div>

      {tab === "tickets" && <TicketQueue eyebrow="Requests & Approvals" title="Requests & Approvals" />}
      {tab === "stock" && (
        <main className="mx-auto max-w-[1400px] space-y-4">
          <header>
            <p className="text-[11px] font-semibold text-brand-600">Requests &amp; Approvals</p>
            <h1 className="mt-1 text-2xl font-extrabold">Stock requests</h1>
            <p className="mt-1 text-xs text-slate-500">Consumables users asked for. Approving issues the stock and records it in the ledger.</p>
          </header>
          {notice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800">{notice}</p>}
          <InventoryRequests admin refreshKey={stockKey} onChanged={(message) => { setNotice(message); setStockKey((k) => k + 1); }} />
        </main>
      )}
      {tab === "rules" && <ApprovalRules />}
    </div>
  );
}

function ApprovalRules() {
  const [policies, setPolicies] = useState<ApprovalPolicy[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    listApprovalPolicies()
      .then(setPolicies)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load approval rules."));
    getProfile()
      .then((p) => setCanEdit(p.role === "IT_ADMIN" || p.role === "SUPER_ADMIN"))
      .catch(() => undefined);
  }, []);

  const save = async (policy: ApprovalPolicy, roles: string[], allowSelf: boolean) => {
    setError("");
    try {
      const updated = await updateApprovalPolicy(policy.request_type, { approver_roles: roles, allow_self_approval: allowSelf });
      setPolicies((current) => current.map((p) => (p.request_type === updated.request_type ? updated : p)));
      setNotice(`Rule for ${POLICY_LABEL[updated.request_type][0].toLowerCase()} saved.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the rule.");
    }
  };

  return (
    <main className="mx-auto max-w-[1400px] space-y-4">
      <header>
        <p className="text-[11px] font-semibold text-brand-600">Requests &amp; Approvals</p>
        <h1 className="mt-1 text-2xl font-extrabold">Approval rules</h1>
        <p className="mt-1 text-xs text-slate-500">
          Who may approve, reject or fulfil each kind of request in your organization. Users never approve. With self-approval off,
          nobody can approve a request made for themselves (or a purchase order they raised).
        </p>
      </header>
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-800">{error}</div>}
      {notice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800">{notice}</p>}
      {!canEdit && policies.length > 0 && <p className="text-xs text-slate-500">Only IT Admins can change these rules.</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {policies.map((policy) => (
          <RuleCard key={policy.request_type} policy={policy} canEdit={canEdit} onSave={save} />
        ))}
      </div>
    </main>
  );
}

function RuleCard({
  policy,
  canEdit,
  onSave,
}: {
  policy: ApprovalPolicy;
  canEdit: boolean;
  onSave: (policy: ApprovalPolicy, roles: string[], allowSelf: boolean) => Promise<void>;
}) {
  const [roles, setRoles] = useState<string[]>(policy.approver_roles);
  const [allowSelf, setAllowSelf] = useState(policy.allow_self_approval);
  const [busy, setBusy] = useState(false);
  const [title, hint] = POLICY_LABEL[policy.request_type];
  const changed =
    allowSelf !== policy.allow_self_approval || [...roles].sort().join() !== [...policy.approver_roles].sort().join();

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-slate-900">{title}</h2>
          <p className="text-xs text-slate-500">{hint}</p>
        </div>
        {!policy.configured && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">Default</span>}
      </div>
      <fieldset className="mt-3" disabled={!canEdit}>
        <legend className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Approvers</legend>
        <div className="mt-1 flex flex-wrap gap-3">
          {APPROVER_ROLES.map(([value, text]) => (
            <label key={value} className="flex items-center gap-1.5 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={roles.includes(value)}
                onChange={(event) =>
                  setRoles((current) => (event.target.checked ? [...current, value] : current.filter((r) => r !== value)))
                }
              />
              {text}
            </label>
          ))}
        </div>
        <label className="mt-3 flex items-center gap-1.5 text-sm text-slate-700">
          <input type="checkbox" checked={allowSelf} onChange={(event) => setAllowSelf(event.target.checked)} />
          Allow self-approval
        </label>
      </fieldset>
      {canEdit && (
        <button
          type="button"
          disabled={!changed || busy || roles.length === 0}
          onClick={async () => {
            setBusy(true);
            await onSave(policy, roles, allowSelf);
            setBusy(false);
          }}
          className="mt-3 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save rule"}
        </button>
      )}
    </article>
  );
}
