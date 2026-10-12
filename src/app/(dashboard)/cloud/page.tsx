"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  CLOUD_PROVIDERS,
  createCloudResource,
  listCloudResources,
  money,
  updateCloudResource,
  type CloudProvider,
  type CloudResource,
  type CloudStatus,
} from "@/lib/operations";

const STATUS_STYLE: Record<CloudStatus, string> = {
  RUNNING: "bg-emerald-50 text-emerald-700",
  STOPPED: "bg-amber-50 text-amber-700",
  TERMINATED: "bg-slate-100 text-slate-600",
};

export default function CloudPage() {
  const [resources, setResources] = useState<CloudResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listCloudResources()
      .then((data) => {
        if (!cancelled) setResources(data);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load cloud resources.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const byProvider = useMemo(() => {
    const totals = new Map<string, number>();
    for (const r of resources) {
      if (r.status === "TERMINATED") continue;
      totals.set(r.provider, (totals.get(r.provider) ?? 0) + Number(r.monthly_cost));
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [resources]);
  const monthly = byProvider.reduce((sum, [, cost]) => sum + cost, 0);

  const setStatus = async (resource: CloudResource, status: CloudStatus) => {
    try {
      await updateCloudResource(resource.id, { status, ...(status === "TERMINATED" ? { monthly_cost: 0 } : {}) });
      setNotice(`${resource.resource_id} marked ${status.toLowerCase()}.`);
      setRefreshKey((key) => key + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Update failed.");
    }
  };

  return (
    <main className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-brand-600">Cloud</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">Cloud resources</h1>
          <p className="mt-1 text-sm text-slate-500">VMs, databases and storage you pay for, with their monthly cost.</p>
        </div>
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          disabled={formOpen}
          className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700 disabled:opacity-60"
        >
          Add resource
        </button>
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

      <section className="grid gap-4 sm:grid-cols-3">
        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-2xl font-bold text-slate-950">{loading ? "—" : money(monthly)}</p>
          <p className="mt-1 text-sm text-slate-600">Monthly cost (active resources)</p>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-2xl font-bold text-slate-950">{loading ? "—" : resources.filter((r) => r.status === "RUNNING").length}</p>
          <p className="mt-1 text-sm text-slate-600">Running</p>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold text-slate-700">By provider</p>
          <ul className="mt-2 space-y-1 text-xs text-slate-600">
            {byProvider.length === 0 ? <li>—</li> : byProvider.map(([provider, cost]) => <li key={provider}>{provider}: {money(cost)}</li>)}
          </ul>
        </article>
      </section>

      {formOpen && (
        <ResourceForm
          onCancel={() => setFormOpen(false)}
          onSaved={(resource) => {
            setFormOpen(false);
            setNotice(`${resource.provider} ${resource.resource_type} ${resource.resource_id} added.`);
            setError("");
            setRefreshKey((key) => key + 1);
          }}
        />
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-[860px] w-full text-left">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600">
              <tr>
                {["Resource", "Provider", "Account", "Region", "Monthly cost", "Status", ""].map((h) => (
                  <th key={h} className="px-5 py-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {resources.map((r) => (
                <tr key={r.id} className="text-sm">
                  <td className="px-5 py-3">
                    <p className="font-mono font-semibold text-slate-800">{r.resource_id}</p>
                    <p className="text-xs text-slate-500">{r.resource_type}</p>
                  </td>
                  <td className="px-5 py-3 text-slate-600">{r.provider}</td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-600">{r.account_id}</td>
                  <td className="px-5 py-3 text-slate-600">{r.region ?? "—"}</td>
                  <td className="px-5 py-3 text-slate-700">{money(r.monthly_cost)}</td>
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLE[r.status]}`}>{r.status}</span>
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-right text-xs font-semibold">
                    {r.status === "RUNNING" && (
                      <button type="button" onClick={() => setStatus(r, "STOPPED")} className="mr-3 text-amber-700">
                        Mark stopped
                      </button>
                    )}
                    {r.status === "STOPPED" && (
                      <button type="button" onClick={() => setStatus(r, "RUNNING")} className="mr-3 text-emerald-700">
                        Mark running
                      </button>
                    )}
                    {r.status !== "TERMINATED" && (
                      <button type="button" onClick={() => setStatus(r, "TERMINATED")} className="text-rose-600">
                        Terminated
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && resources.length === 0 && !error && (
          <p className="p-10 text-center text-sm text-slate-500">No cloud resources tracked yet.</p>
        )}
      </section>
    </main>
  );
}

function ResourceForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: (resource: CloudResource) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? "").trim();
    if (!text("account_id") || !text("resource_id") || !text("resource_type")) {
      return setError("Account, resource ID and type are required.");
    }
    setBusy(true);
    try {
      onSaved(
        await createCloudResource({
          provider: text("provider") as CloudProvider,
          account_id: text("account_id"),
          resource_id: text("resource_id"),
          resource_type: text("resource_type"),
          region: text("region") || undefined,
          monthly_cost: Number(form.get("monthly_cost")) || 0,
        }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add the resource.");
    } finally {
      setBusy(false);
    }
  };

  const inputClass = "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal";

  return (
    <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" noValidate>
      <h2 className="text-base font-extrabold text-slate-900">Add cloud resource</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <label className="block text-xs font-semibold text-slate-600">
          Provider
          <select name="provider" defaultValue="AWS" className={inputClass}>
            {CLOUD_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Account / subscription ID
          <input name="account_id" className={inputClass} />
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Resource ID
          <input name="resource_id" placeholder="e.g. i-0abc123" className={inputClass} />
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Type
          <input name="resource_type" placeholder="e.g. EC2, RDS, Blob storage" className={inputClass} />
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Region
          <input name="region" placeholder="e.g. ap-south-1" className={inputClass} />
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Monthly cost
          <input name="monthly_cost" type="number" min={0} step="0.01" className={inputClass} />
        </label>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50">
          {busy ? "Saving…" : "Save resource"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">
          Cancel
        </button>
      </div>
    </form>
  );
}
