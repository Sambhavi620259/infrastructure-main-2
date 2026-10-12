"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { listCompanies, planLabel, type Company } from "@/lib/super-admin";

type Health = "Healthy" | "Near limit" | "Over limit" | "Suspended";

const HEALTH_STYLE: Record<Health, string> = {
  Healthy: "bg-emerald-50 text-emerald-700",
  "Near limit": "bg-amber-50 text-amber-700",
  "Over limit": "bg-rose-50 text-rose-700",
  Suspended: "bg-slate-100 text-slate-600",
};

function percent(used: number, limit: number | undefined): number | null {
  return limit ? Math.round((used / limit) * 100) : null;
}

function health(company: Company): Health {
  if (company.status !== "ACTIVE") return "Suspended";
  const usage = [
    percent(company.active_users, company.subscription?.user_limit),
    percent(company.assets, company.subscription?.asset_limit),
  ].filter((value): value is number => value !== null);
  const worst = Math.max(0, ...usage);
  if (worst > 100) return "Over limit";
  if (worst >= 85) return "Near limit";
  return "Healthy";
}

function Usage({ used, limit }: { used: number; limit: number | undefined }) {
  const pct = percent(used, limit);
  return (
    <div className="min-w-[140px]">
      <div className="flex justify-between text-xs">
        <span className="font-semibold text-slate-800">{used}</span>
        <span className="text-slate-400">{limit ? `of ${limit}` : "no limit"}</span>
      </div>
      {pct !== null && (
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100" role="presentation">
          <div
            className={`h-full rounded-full ${pct > 100 ? "bg-rose-500" : pct >= 85 ? "bg-amber-500" : "bg-brand-600"}`}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
      )}
    </div>
  );
}

export default function TenantsPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    listCompanies()
      .then(setCompanies)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load tenants."))
      .finally(() => setLoading(false));
  }, []);

  const rows = useMemo(
    () =>
      companies
        .map((company) => ({ company, health: health(company) }))
        .filter((row) => !onlyAttention || row.health !== "Healthy"),
    [companies, onlyAttention],
  );

  const counts = companies.reduce<Record<Health, number>>(
    (acc, company) => ({ ...acc, [health(company)]: acc[health(company)] + 1 }),
    { Healthy: 0, "Near limit": 0, "Over limit": 0, Suspended: 0 },
  );

  return (
    <main className="mx-auto max-w-[1400px] space-y-5">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-wider text-violet-600">Super Admin · Tenants</p>
        <h1 className="mt-1 text-2xl font-extrabold text-slate-950">Tenant management</h1>
        <p className="mt-1 text-sm text-slate-500">
          Usage against plan limits. &ldquo;Near limit&rdquo; means 85% or more of users or assets.
        </p>
      </header>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-4">
        {(Object.keys(counts) as Health[]).map((label) => (
          <article key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xl font-extrabold text-slate-950">{loading ? "—" : counts[label]}</p>
            <p className="mt-1 text-xs font-bold text-slate-600">{label}</p>
          </article>
        ))}
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 p-4">
          <h2 className="text-sm font-bold">Tenant directory</h2>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={onlyAttention} onChange={(event) => setOnlyAttention(event.target.checked)} />
            Only tenants needing attention
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left">
            <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              <tr>
                {["Tenant", "Plan", "Users", "Assets", "Pending tickets", "Health", ""].map((h) => (
                  <th key={h} className="px-4 py-2.5">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(({ company, health: state }) => (
                <tr key={company.id} className="text-sm">
                  <td className="px-4 py-3">
                    <p className="font-bold text-slate-800">{company.name}</p>
                    <p className="text-[11px] text-slate-500">{company.primary_admin?.email ?? "No IT Admin"}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{company.subscription ? planLabel(company.subscription.plan) : "—"}</td>
                  <td className="px-4 py-3">
                    <Usage used={company.active_users} limit={company.subscription?.user_limit} />
                  </td>
                  <td className="px-4 py-3">
                    <Usage used={company.assets} limit={company.subscription?.asset_limit} />
                  </td>
                  <td className="px-4 py-3 text-slate-700">{company.pending_tickets}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${HEALTH_STYLE[state]}`}>{state}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href="/super-admin/subscriptions" className="text-xs font-bold text-brand-600">
                      Adjust plan →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && rows.length === 0 && !error && (
          <p className="p-8 text-center text-sm text-slate-500">
            {onlyAttention ? "Every tenant is healthy." : "No tenants yet."}
          </p>
        )}
      </section>
    </main>
  );
}
