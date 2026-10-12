"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  PLANS,
  createCompany,
  formatDay,
  listCompanies,
  planLabel,
  updateCompany,
  type Company,
  type Plan,
} from "@/lib/super-admin";

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [confirming, setConfirming] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listCompanies({ search: search || undefined, status: status || undefined })
      .then((data) => {
        if (!cancelled) setCompanies(data);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load companies.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [search, status, refreshKey]);

  const run = async (action: () => Promise<Company>, message: (company: Company) => string) => {
    try {
      const company = await action();
      setNotice(message(company));
      setError("");
      setConfirming("");
      setRenaming(null);
      setRefreshKey((key) => key + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Update failed.");
    }
  };

  const active = companies.filter((company) => company.status === "ACTIVE").length;

  return (
    <main className="mx-auto max-w-[1400px] space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-violet-600">Super Admin · Companies</p>
          <h1 className="mt-1 text-2xl font-extrabold text-slate-950">Company management</h1>
          <p className="mt-1 text-sm text-slate-500">Create organizations, give them their first IT Admin, and suspend or reactivate them.</p>
        </div>
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          disabled={formOpen}
          className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700 disabled:opacity-60"
        >
          + Add company
        </button>
      </header>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {formOpen && (
        <CompanyForm
          onCancel={() => setFormOpen(false)}
          onCreated={(company) => {
            setFormOpen(false);
            setNotice(
              `${company.name} created${company.primary_admin ? ` with IT Admin ${company.primary_admin.email}` : ""}.`,
            );
            setError("");
            setRefreshKey((key) => key + 1);
          }}
        />
      )}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[
          ["Shown", companies.length],
          ["Active", active],
          ["Suspended", companies.length - active],
        ].map(([label, value]) => (
          <article key={String(label)} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xl font-extrabold text-slate-950">{loading ? "—" : value}</p>
            <p className="mt-1 text-xs font-bold text-slate-600">{label}</p>
          </article>
        ))}
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-bold text-slate-900">Organizations</h2>
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search companies"
              placeholder="Search name or code"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm sm:w-60"
            />
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              aria-label="Filter by status"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <option value="">All</option>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-left">
            <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              <tr>
                {["Organization", "IT Admin", "Plan", "Users", "Agents", "Assets", "Pending tickets", "Status", ""].map((h) => (
                  <th key={h} className="px-4 py-2.5">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {companies.map((company) => (
                <tr key={company.id} className="align-top text-sm">
                  <td className="px-4 py-3">
                    {renaming?.id === company.id ? (
                      <span className="flex gap-2">
                        <input
                          value={renaming.name}
                          onChange={(event) => setRenaming({ id: company.id, name: event.target.value })}
                          aria-label="New name"
                          className="w-48 rounded-lg border border-slate-200 px-2 py-1 text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => run(() => updateCompany(company.id, { name: renaming.name.trim() }), (c) => `Renamed to ${c.name}.`)}
                          className="text-xs font-bold text-brand-600"
                        >
                          Save
                        </button>
                        <button type="button" onClick={() => setRenaming(null)} className="text-xs font-semibold text-slate-500">
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <>
                        <p className="font-bold text-slate-800">{company.name}</p>
                        <p className="text-[11px] text-slate-500">
                          <span className="font-mono">{company.code}</span> · since {formatDay(company.created_at)}
                        </p>
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {company.primary_admin ? (
                      <>
                        <p className="font-semibold text-slate-700">{company.primary_admin.full_name}</p>
                        <p>{company.primary_admin.email}</p>
                      </>
                    ) : (
                      <span className="text-slate-400">None yet</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{company.subscription ? planLabel(company.subscription.plan) : "—"}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {company.active_users}
                    {company.subscription ? <span className="text-slate-400"> / {company.subscription.user_limit}</span> : null}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{company.it_agents}</td>
                  <td className="px-4 py-3 text-slate-700">{company.assets}</td>
                  <td className="px-4 py-3 text-slate-700">{company.pending_tickets}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        company.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                      }`}
                    >
                      {company.status === "ACTIVE" ? "Active" : "Suspended"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-xs font-bold">
                    {confirming === company.id ? (
                      <span className="inline-flex items-center gap-3">
                        <span className="font-normal text-slate-500">Lock out all its users?</span>
                        <button
                          type="button"
                          onClick={() => run(() => updateCompany(company.id, { status: "SUSPENDED" }), (c) => `${c.name} suspended.`)}
                          className="text-rose-600"
                        >
                          Suspend
                        </button>
                        <button type="button" onClick={() => setConfirming("")} className="text-slate-500">
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <span className="inline-flex gap-3">
                        <button type="button" onClick={() => setRenaming({ id: company.id, name: company.name })} className="text-slate-600">
                          Rename
                        </button>
                        {company.status === "ACTIVE" ? (
                          <button type="button" onClick={() => setConfirming(company.id)} className="text-rose-600">
                            Suspend
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => run(() => updateCompany(company.id, { status: "ACTIVE" }), (c) => `${c.name} reactivated.`)}
                            className="text-emerald-700"
                          >
                            Activate
                          </button>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && companies.length === 0 && !error && (
          <p className="p-8 text-center text-sm text-slate-500">No organizations match.</p>
        )}
      </section>
    </main>
  );
}

function CompanyForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (company: Company) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? "").trim();
    const name = text("name");
    if (name.length < 2) return setError("Enter the organization name.");
    const adminEmail = text("admin_email");
    const adminName = text("admin_name");
    const adminPassword = String(form.get("admin_password") ?? "");
    if ((adminEmail || adminName || adminPassword) && !(adminEmail && adminName && adminPassword)) {
      return setError("Give the IT Admin's name, email and password, or leave all three empty.");
    }
    if (adminPassword && adminPassword.length < 8) return setError("The IT Admin password needs at least 8 characters.");
    setBusy(true);
    try {
      onCreated(
        await createCompany({
          name,
          code: text("code") || undefined,
          plan: text("plan") as Plan,
          user_limit: Number(form.get("user_limit")) || 500,
          asset_limit: Number(form.get("asset_limit")) || 2000,
          admin_name: adminName || undefined,
          admin_email: adminEmail || undefined,
          admin_password: adminPassword || undefined,
        }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the organization.");
    } finally {
      setBusy(false);
    }
  };

  const inputClass = "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal";

  return (
    <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" noValidate>
      <h2 className="text-sm font-bold text-slate-900">New organization</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-5">
        <label className="block text-xs font-semibold text-slate-600 sm:col-span-2">
          Name
          <input name="name" placeholder="e.g. Orbit Logistics" className={inputClass} />
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Code <span className="font-normal text-slate-400">(optional)</span>
          <input name="code" placeholder="Auto" className={inputClass} />
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Plan
          <select name="plan" defaultValue="ENTERPRISE" className={inputClass}>
            {PLANS.map((plan) => (
              <option key={plan} value={plan}>
                {planLabel(plan)}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs font-semibold text-slate-600">
            Users
            <input name="user_limit" type="number" min={1} defaultValue={500} className={inputClass} />
          </label>
          <label className="block text-xs font-semibold text-slate-600">
            Assets
            <input name="asset_limit" type="number" min={1} defaultValue={2000} className={inputClass} />
          </label>
        </div>
      </div>
      <h3 className="mt-5 text-xs font-bold text-slate-700">
        First IT Admin <span className="font-normal text-slate-400">(optional; they can sign in straight away)</span>
      </h3>
      <div className="mt-2 grid gap-4 sm:grid-cols-3">
        <label className="block text-xs font-semibold text-slate-600">
          Name
          <input name="admin_name" className={inputClass} />
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Email
          <input name="admin_email" type="email" className={inputClass} />
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Temporary password
          <input name="admin_password" type="password" autoComplete="new-password" className={inputClass} />
        </label>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50">
          {busy ? "Creating…" : "Create organization"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">
          Cancel
        </button>
      </div>
    </form>
  );
}
