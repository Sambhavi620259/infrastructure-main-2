"use client";

import { useEffect, useState } from "react";
import {
  PLANS,
  SUBSCRIPTION_STATUSES,
  formatDay,
  listCompanies,
  planLabel,
  updateSubscription,
  type Company,
  type Plan,
  type SubscriptionStatus,
} from "@/lib/super-admin";

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700",
  TRIAL: "bg-blue-50 text-blue-700",
  PAST_DUE: "bg-amber-50 text-amber-700",
  CANCELLED: "bg-slate-100 text-slate-600",
};

export default function SubscriptionsPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listCompanies()
      .then((data) => {
        if (!cancelled) setCompanies(data);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load subscriptions.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const byPlan = PLANS.map((plan) => [plan, companies.filter((c) => c.subscription?.plan === plan).length] as const);

  return (
    <main className="mx-auto max-w-[1400px] space-y-5">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-wider text-violet-600">Super Admin · Subscriptions</p>
        <h1 className="mt-1 text-2xl font-extrabold text-slate-950">Subscriptions &amp; plans</h1>
        <p className="mt-1 text-sm text-slate-500">Each organization&rsquo;s plan, user and asset limits, status and renewal date.</p>
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

      <section className="grid gap-3 sm:grid-cols-4">
        {byPlan.map(([plan, count]) => (
          <article key={plan} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xl font-extrabold text-slate-950">{loading ? "—" : count}</p>
            <p className="mt-1 text-xs font-bold text-slate-600">{planLabel(plan)}</p>
          </article>
        ))}
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left">
            <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              <tr>
                {["Organization", "Plan", "User limit", "Asset limit", "Status", "Started", "Ends", ""].map((h) => (
                  <th key={h} className="px-4 py-2.5">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {companies.map((company) =>
                editing === company.id ? (
                  <EditRow
                    key={company.id}
                    company={company}
                    onCancel={() => setEditing(null)}
                    onSaved={(updated) => {
                      setEditing(null);
                      setNotice(`${updated.name}'s subscription saved.`);
                      setError("");
                      setRefreshKey((key) => key + 1);
                    }}
                    onError={setError}
                  />
                ) : (
                  <tr key={company.id} className="text-sm">
                    <td className="px-4 py-3 font-bold text-slate-800">{company.name}</td>
                    <td className="px-4 py-3 text-slate-700">{company.subscription ? planLabel(company.subscription.plan) : "—"}</td>
                    <td className="px-4 py-3 text-slate-700">
                      {company.subscription?.user_limit ?? "—"}
                      <span className="text-xs text-slate-400"> ({company.active_users} used)</span>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {company.subscription?.asset_limit ?? "—"}
                      <span className="text-xs text-slate-400"> ({company.assets} used)</span>
                    </td>
                    <td className="px-4 py-3">
                      {company.subscription && (
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLE[company.subscription.status] ?? STATUS_STYLE.CANCELLED}`}>
                          {company.subscription.status.replace("_", " ")}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatDay(company.subscription?.start_date ?? null)}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDay(company.subscription?.end_date ?? null)}</td>
                    <td className="px-4 py-3 text-right">
                      <button type="button" onClick={() => setEditing(company.id)} className="text-xs font-bold text-brand-600">
                        Edit
                      </button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
        {!loading && companies.length === 0 && !error && (
          <p className="p-8 text-center text-sm text-slate-500">No organizations yet.</p>
        )}
      </section>
    </main>
  );
}

function EditRow({
  company,
  onCancel,
  onSaved,
  onError,
}: {
  company: Company;
  onCancel: () => void;
  onSaved: (company: Company) => void;
  onError: (message: string) => void;
}) {
  const sub = company.subscription;
  const [plan, setPlan] = useState<Plan>((sub?.plan as Plan) ?? "ENTERPRISE");
  const [userLimit, setUserLimit] = useState(String(sub?.user_limit ?? 500));
  const [assetLimit, setAssetLimit] = useState(String(sub?.asset_limit ?? 2000));
  const [status, setStatus] = useState<SubscriptionStatus>((sub?.status as SubscriptionStatus) ?? "ACTIVE");
  const [endDate, setEndDate] = useState(sub?.end_date ? sub.end_date.slice(0, 10) : "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const users = Number.parseInt(userLimit, 10);
    const assets = Number.parseInt(assetLimit, 10);
    if (!(users >= 1) || !(assets >= 1)) return onError("Limits must be whole numbers of at least 1.");
    setBusy(true);
    try {
      onSaved(
        await updateSubscription(company.id, {
          plan,
          user_limit: users,
          asset_limit: assets,
          status,
          end_date: endDate ? `${endDate}T00:00:00` : null,
        }),
      );
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Could not save the subscription.");
    } finally {
      setBusy(false);
    }
  };

  const field = "w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm";

  return (
    <tr className="bg-slate-50/70 text-sm">
      <td className="px-4 py-3 font-bold text-slate-800">{company.name}</td>
      <td className="px-4 py-3">
        <select value={plan} onChange={(e) => setPlan(e.target.value as Plan)} aria-label="Plan" className={field}>
          {PLANS.map((p) => (
            <option key={p} value={p}>
              {planLabel(p)}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-3">
        <input type="number" min={1} value={userLimit} onChange={(e) => setUserLimit(e.target.value)} aria-label="User limit" className={field} />
      </td>
      <td className="px-4 py-3">
        <input type="number" min={1} value={assetLimit} onChange={(e) => setAssetLimit(e.target.value)} aria-label="Asset limit" className={field} />
      </td>
      <td className="px-4 py-3">
        <select value={status} onChange={(e) => setStatus(e.target.value as SubscriptionStatus)} aria-label="Status" className={field}>
          {SUBSCRIPTION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-3 text-slate-600">{formatDay(sub?.start_date ?? null)}</td>
      <td className="px-4 py-3">
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} aria-label="End date" className={field} />
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right text-xs font-bold">
        <button type="button" disabled={busy} onClick={save} className="mr-3 text-brand-600 disabled:opacity-50">
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onCancel} className="text-slate-500">
          Cancel
        </button>
      </td>
    </tr>
  );
}
