"use client";

import { useState } from "react";

type TenantHealth = "Healthy" | "Setup" | "Attention" | "Suspended";
type TenantRow = readonly [name: string, domain: string, region: string, endpoints: string, health: TenantHealth];

const initialRows: TenantRow[] = [
  ["Acme Technologies", "acme.example", "Mumbai", "12,486", "Healthy"],
  ["Northstar Retail", "northstar.example", "Bengaluru", "4,218", "Healthy"],
  ["BluePeak Finance", "bluepeak.example", "Delhi", "2,804", "Setup"],
  ["Orbit Logistics", "orbit.example", "Pune", "684", "Attention"],
];

const healthStyles: Record<TenantHealth, string> = {
  Healthy: "bg-emerald-50 text-emerald-700",
  Setup: "bg-blue-50 text-blue-700",
  Attention: "bg-amber-50 text-amber-700",
  Suspended: "bg-slate-100 text-slate-600",
};

export default function TenantsPage() {
  const [rows, setRows] = useState<TenantRow[]>(initialRows);

  const toggle = (name: string) => {
    setRows((current) => current.map((row) => {
      if (row[0] !== name) return row;
      const nextHealth: TenantHealth = row[4] === "Suspended" ? "Healthy" : "Suspended";
      return [row[0], row[1], row[2], row[3], nextHealth];
    }));
  };

  return (
    <main className="mx-auto max-w-7xl space-y-5">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-wider text-violet-600">Super Admin · Tenants</p>
        <h1 className="mt-1 text-2xl font-extrabold text-slate-950">Tenant management</h1>
        <p className="mt-1 text-sm text-slate-500">Provision tenant workspaces and control their operational state.</p>
      </header>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-bold">Tenant directory</h2>
            <p className="text-[10px] text-slate-500">Tenant records remain isolated from the platform workspace.</p>
          </div>
          <button type="button" className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white hover:bg-brand-700">+ Provision tenant</button>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[800px] w-full text-left">
            <caption className="sr-only">Tenant directory and operational state</caption>
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
              <tr>
                {['Tenant', 'Domain', 'Region', 'Endpoints', 'Health', 'Action'].map((heading) => <th key={heading} scope="col" className="px-4 py-2.5 font-bold">{heading}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row[0]} className="text-xs hover:bg-slate-50/70">
                  <td className="px-4 py-3 font-bold text-slate-800">{row[0]}</td>
                  <td className="px-4 py-3 text-slate-500">{row[1]}</td>
                  <td className="px-4 py-3 text-slate-600">{row[2]}</td>
                  <td className="px-4 py-3 font-semibold text-slate-700">{row[3]}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${healthStyles[row[4]]}`}>{row[4]}</span></td>
                  <td className="px-4 py-3">
                    <button type="button" onClick={() => toggle(row[0])} className="font-bold text-slate-500 hover:text-slate-700">{row[4] === "Suspended" ? "Activate" : "Suspend"}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
