"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  RESOURCE_TYPES,
  RESOURCE_TYPE_LABEL,
  createAccessResource,
  listAccessGrants,
  listAccessResources,
  revokeAccessGrant,
  updateAccessResource,
  type AccessGrant,
  type AccessResource,
  type ResourceType,
} from "@/lib/access-management";
import { listUsers } from "@/lib/users";
import { formatDate } from "@/types/asset";
import type { AppUser } from "@/types/user";

type Tab = "resources" | "active" | "ended";

/**
 * Access Management: the applications, databases, VPN, folders and mailboxes
 * people request access to, and who has access now. Requests and approvals
 * are tickets (Requests & Approvals); a grant here records that an admin gave
 * the access in the system itself.
 */
export default function AccessManagementPage() {
  const [tab, setTab] = useState<Tab>("resources");
  const [resources, setResources] = useState<AccessResource[]>([]);
  const [grants, setGrants] = useState<AccessGrant[]>([]);
  const [people, setPeople] = useState<AppUser[]>([]);
  const [editing, setEditing] = useState<AccessResource | "new" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    listAccessResources(true).then(setResources).catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load resources."));
    listUsers({ limit: 1000 }).then((data) => setPeople(data.filter((u) => u.status === "ACTIVE"))).catch(() => undefined);
  }, [refreshKey]);

  useEffect(() => {
    if (tab === "resources") return;
    listAccessGrants({ active: tab === "active" })
      .then(setGrants)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load access grants."));
  }, [tab, refreshKey]);

  const done = (message: string) => {
    setNotice(message);
    setError("");
    setEditing(null);
    setRefreshKey((k) => k + 1);
  };

  const active = resources.filter((r) => r.status === "ACTIVE");

  return (
    <main className="mx-auto max-w-[1400px] space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-brand-600">Access Management</p>
          <h1 className="mt-1 text-2xl font-extrabold text-slate-950">Access Management</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Resources people can request access to, and who has access now. Access requests are approved under{" "}
            <Link href="/requests" className="font-semibold text-brand-600">Requests &amp; Approvals</Link>; nothing is granted automatically:
            give the access in the system itself, then record it on the ticket.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setTab("resources");
            setEditing("new");
          }}
          className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700"
        >
          + Add resource
        </button>
      </header>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
      {notice && (
        <div role="status" className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")} aria-label="Dismiss">×</button>
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Resources", active.length],
          ["Privileged levels", active.reduce((n, r) => n + r.privileged_levels.length, 0)],
          ["People with access", active.reduce((n, r) => n + r.active_grants, 0)],
          ["With an owner", active.filter((r) => r.owner_id).length],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold text-slate-500">{label}</p>
            <p className="mt-1 text-2xl font-extrabold text-slate-900">{value}</p>
          </div>
        ))}
      </section>

      <div className="flex w-fit gap-1 rounded-xl border border-slate-200 bg-white p-1 text-sm font-semibold shadow-sm">
        {([["resources", "Resources"], ["active", "Who has access"], ["ended", "Ended & revoked"]] as const).map(([value, text]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            aria-pressed={tab === value}
            className={`rounded-lg px-4 py-2 ${tab === value ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
          >
            {text}
          </button>
        ))}
      </div>

      {editing && (
        <ResourceForm
          key={editing === "new" ? "new" : editing.id}
          resource={editing === "new" ? null : editing}
          people={people}
          onCancel={() => setEditing(null)}
          onSaved={(r) => done(`${r.name} saved.`)}
          onError={setError}
        />
      )}

      {tab === "resources" ? (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>{["Resource", "Type", "Levels", "Owner", "Max", "Access", "Status", ""].map((h) => <th key={h} className="px-4 py-2.5 font-semibold">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {resources.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-800">{r.name}</p>
                      {r.description && <p className="max-w-xs text-xs text-slate-500">{r.description}</p>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{RESOURCE_TYPE_LABEL[r.resource_type] ?? r.resource_type}</td>
                    <td className="px-4 py-3">
                      <span className="flex flex-wrap gap-1">
                        {r.access_levels.map((level) => (
                          <span key={level} className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${r.privileged_levels.includes(level) ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-600"}`}>
                            {level}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{r.owner_name ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{r.max_days ? `${r.max_days} days` : "No limit"}</td>
                    <td className="px-4 py-3 text-slate-600">{r.active_grants}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${r.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                        {r.status === "ACTIVE" ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-xs font-semibold">
                      <button type="button" onClick={() => setEditing(r)} className="text-brand-600 hover:text-brand-700">Edit</button>
                      <button
                        type="button"
                        onClick={() =>
                          updateAccessResource(r.id, { status: r.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" })
                            .then((updated) => done(`${updated.name} ${updated.status === "ACTIVE" ? "reactivated" : "deactivated: no new requests"}.`))
                            .catch((caught) => setError(caught instanceof Error ? caught.message : "Update failed."))
                        }
                        className="ml-3 text-slate-600 hover:text-slate-800"
                      >
                        {r.status === "ACTIVE" ? "Deactivate" : "Activate"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {resources.length === 0 && (
            <p className="p-8 text-center text-sm text-slate-500">No resources yet. Add the applications, databases, VPN or folders people ask access to.</p>
          )}
        </section>
      ) : (
        <GrantTable grants={grants} active={tab === "active"} onRevoked={done} onError={setError} />
      )}
    </main>
  );
}

function ResourceForm({
  resource,
  people,
  onCancel,
  onSaved,
  onError,
}: {
  resource: AccessResource | null;
  people: AppUser[];
  onCancel: () => void;
  onSaved: (r: AccessResource) => void;
  onError: (m: string) => void;
}) {
  const [name, setName] = useState(resource?.name ?? "");
  const [type, setType] = useState<ResourceType>((resource?.resource_type as ResourceType) ?? "APPLICATION");
  const [description, setDescription] = useState(resource?.description ?? "");
  const [ownerId, setOwnerId] = useState(resource?.owner_id ?? "");
  const [levels, setLevels] = useState((resource?.access_levels ?? ["Read", "Write", "Admin"]).join(", "));
  const [privileged, setPrivileged] = useState<string[]>(resource?.privileged_levels ?? ["Admin"]);
  const [maxDays, setMaxDays] = useState(resource?.max_days ? String(resource.max_days) : "");
  const [busy, setBusy] = useState(false);

  const levelList = Array.from(new Set(levels.split(",").map((l) => l.trim()).filter(Boolean)));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (name.trim().length < 2) return onError("Give the resource a name.");
    if (levelList.length === 0) return onError("Give at least one access level.");
    setBusy(true);
    const input = {
      name: name.trim(),
      resource_type: type,
      description: description.trim() || undefined,
      owner_id: ownerId || null,
      access_levels: levelList,
      privileged_levels: privileged.filter((p) => levelList.includes(p)),
      max_days: maxDays ? Number(maxDays) : null,
    };
    try {
      onSaved(resource ? await updateAccessResource(resource.id, input) : await createAccessResource(input));
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Could not save the resource.");
    } finally {
      setBusy(false);
    }
  };

  const field = "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal";
  return (
    <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-extrabold text-slate-900">{resource ? `Edit ${resource.name}` : "Add a resource"}</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block text-xs font-bold text-slate-700">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={150} placeholder="e.g. Finance database" className={field} />
        </label>
        <label className="block text-xs font-bold text-slate-700">
          Type
          <select value={type} onChange={(e) => setType(e.target.value as ResourceType)} className={field}>
            {RESOURCE_TYPES.map((t) => <option key={t} value={t}>{RESOURCE_TYPE_LABEL[t]}</option>)}
          </select>
        </label>
        <label className="block text-xs font-bold text-slate-700">
          Owner <span className="font-normal text-slate-400">(also approves requests)</span>
          <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={field}>
            <option value="">No owner</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </label>
        <label className="block text-xs font-bold text-slate-700 sm:col-span-2">
          Access levels <span className="font-normal text-slate-400">(comma separated, least to most privileged)</span>
          <input value={levels} onChange={(e) => setLevels(e.target.value)} className={field} />
        </label>
        <label className="block text-xs font-bold text-slate-700">
          Longest grant <span className="font-normal text-slate-400">(days, optional)</span>
          <input type="number" min={1} max={3650} value={maxDays} onChange={(e) => setMaxDays(e.target.value)} className={field} />
        </label>
        <fieldset className="sm:col-span-2 lg:col-span-3">
          <legend className="text-xs font-bold text-slate-700">Privileged levels</legend>
          <div className="mt-1 flex flex-wrap gap-4">
            {levelList.map((level) => (
              <label key={level} className="flex items-center gap-1.5 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={privileged.includes(level)}
                  onChange={(e) => setPrivileged((current) => (e.target.checked ? [...current, level] : current.filter((p) => p !== level)))}
                />
                {level}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block text-xs font-bold text-slate-700 sm:col-span-2 lg:col-span-3">
          Description
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={2000} className={field} />
        </label>
      </div>
      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50">
          {busy ? "Saving…" : "Save resource"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">Cancel</button>
      </div>
    </form>
  );
}

function GrantTable({
  grants,
  active,
  onRevoked,
  onError,
}: {
  grants: AccessGrant[];
  active: boolean;
  onRevoked: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [revoking, setRevoking] = useState("");
  const [reason, setReason] = useState("");
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              {["Person", "Resource", "Level", "Granted", active ? "Ends" : "Ended", active ? "" : "Why"].map((h) => (
                <th key={h} className="px-4 py-2.5 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {grants.map((g) => (
              <tr key={g.id} className="align-top">
                <td className="px-4 py-3 font-semibold text-slate-800">{g.user_name}</td>
                <td className="px-4 py-3 text-slate-600">
                  {g.resource_name}
                  {g.ticket_id && (
                    <Link href={`/tickets/${g.ticket_id}`} className="block text-xs font-semibold text-brand-600">From ticket</Link>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${g.privileged ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-600"}`}>
                    {g.access_level}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-slate-600">
                  {formatDate(g.granted_at)}
                  <span className="block text-slate-400">by {g.granted_by_name}</span>
                </td>
                <td className="px-4 py-3 text-xs text-slate-600">
                  {active ? (g.expires_at ? formatDate(g.expires_at) : "No end date") : formatDate(g.revoked_at)}
                  {!active && g.revoked_by_name && <span className="block text-slate-400">by {g.revoked_by_name}</span>}
                </td>
                <td className="px-4 py-3 text-right text-xs">
                  {active ? (
                    revoking === g.id ? (
                      <span className="inline-flex flex-wrap items-center justify-end gap-2">
                        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" className="w-44 rounded-lg border border-slate-200 px-2 py-1" />
                        <button
                          type="button"
                          disabled={reason.trim().length < 3}
                          onClick={() =>
                            revokeAccessGrant(g.id, reason.trim())
                              .then(() => {
                                setRevoking("");
                                setReason("");
                                onRevoked(`${g.user_name}'s ${g.access_level} access to ${g.resource_name} removed.`);
                              })
                              .catch((caught) => onError(caught instanceof Error ? caught.message : "Could not remove the access."))
                          }
                          className="font-semibold text-rose-600 disabled:opacity-50"
                        >
                          Remove access
                        </button>
                        <button type="button" onClick={() => setRevoking("")} className="font-semibold text-slate-500">Cancel</button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => setRevoking(g.id)} className="font-semibold text-rose-600 hover:text-rose-700">Revoke</button>
                    )
                  ) : (
                    <span className="text-slate-600">{g.revoke_reason}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {grants.length === 0 && <p className="p-8 text-center text-sm text-slate-500">{active ? "Nobody has access recorded yet." : "No ended or revoked access."}</p>}
    </section>
  );
}
