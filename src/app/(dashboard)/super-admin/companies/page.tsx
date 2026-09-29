"use client";

import { useMemo, useState } from "react";
import { PlusIcon } from "@heroicons/react/24/outline";

type CompanyStatus = "Active" | "Trial" | "Past due" | "Suspended";
type Company = readonly [name: string, domain: string, plan: string, status: CompanyStatus, endpoints: string, activity: string];

const initialCompanies: Company[] = [
  ["Acme Technologies", "acme.example", "Enterprise", "Active", "12,486", "24 Aug 2026"],
  ["Northstar Retail", "northstar.example", "Business", "Active", "4,218", "23 Aug 2026"],
  ["BluePeak Finance", "bluepeak.example", "Enterprise", "Trial", "2,804", "22 Aug 2026"],
  ["Orbit Logistics", "orbit.example", "Starter", "Past due", "684", "20 Aug 2026"],
  ["Greenfield Health", "greenfield.example", "Business", "Active", "1,928", "19 Aug 2026"],
];

const statusStyles: Record<CompanyStatus, string> = {
  Active: "bg-emerald-50 text-emerald-700",
  Trial: "bg-blue-50 text-blue-700",
  "Past due": "bg-amber-50 text-amber-700",
  Suspended: "bg-slate-100 text-slate-600",
};

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>(initialCompanies);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");

  const filtered = useMemo(() => companies.filter((company) => `${company[0]} ${company[1]} ${company[2]} ${company[3]}`.toLowerCase().includes(query.trim().toLowerCase())), [companies, query]);

  const toggleSuspend = (name: string) => {
    setCompanies((current) => current.map((company) => company[0] === name ? [company[0], company[1], company[2], company[3] === "Suspended" ? "Active" : "Suspended", company[4], company[5]] as const : company));
    setNotice(`${name} status changed locally. Persist the tenant status through the Super Admin API and audit service.`);
  };

  return (
    <main className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-[11px] font-bold uppercase tracking-wider text-violet-600">Super Admin · Companies</p><h1 className="mt-1 text-2xl font-extrabold text-slate-950">Company management</h1><p className="mt-1 text-sm text-slate-500">Provision customer organizations and review subscription state.</p></div>
        <button type="button" onClick={() => setNotice("Company provisioning flow is ready for the backend tenant-provisioning API.")} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-brand-700"><PlusIcon className="h-4 w-4" /> Add company</button>
      </header>
      {notice && <div role="status" className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs font-semibold text-blue-800">{notice}</div>}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[["128", "Total companies", "All tenants"], ["116", "Active", "Operational"], ["8", "Trials", "Onboarding"], ["4", "Attention", "Past due or suspended"]].map(([value, label, hint]) => <article key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xl font-extrabold text-slate-950">{value}</p><p className="mt-1 text-xs font-bold text-slate-700">{label}</p><p className="mt-1 text-[10px] text-slate-500">{hint}</p></article>)}
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-sm font-bold text-slate-900">Tenant/company directory</h2><p className="text-[10px] text-slate-500">{filtered.length} of {companies.length} sample records shown.</p></div><input aria-label="Search companies" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search company, domain or plan" className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-brand-500 sm:w-72" /></div>
        <div className="overflow-x-auto"><table className="min-w-[1080px] w-full text-left"><caption className="sr-only">Company management table</caption><thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400"><tr>{["Company", "Domain", "Plan", "Status", "Endpoints", "Last activity", "Actions"].map((heading) => <th key={heading} scope="col" className="px-4 py-2.5 font-bold">{heading}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{filtered.map((row) => <tr key={row[0]} className="text-xs hover:bg-slate-50/70"><td className="px-4 py-3 font-bold text-slate-800">{row[0]}</td><td className="px-4 py-3 text-slate-500">{row[1]}</td><td className="px-4 py-3 font-semibold text-slate-700">{row[2]}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${statusStyles[row[3]]}`}>{row[3]}</span></td><td className="px-4 py-3 font-semibold text-slate-700">{row[4]}</td><td className="px-4 py-3 text-slate-500">{row[5]}</td><td className="px-4 py-3"><button type="button" onClick={() => toggleSuspend(row[0])} className="font-bold text-slate-500 hover:text-slate-700">{row[3] === "Suspended" ? "Activate" : "Suspend"}</button></td></tr>)}</tbody></table></div>
      </section>

      <section className="rounded-xl border border-violet-100 bg-violet-50/60 p-4"><p className="text-xs font-bold text-violet-800">Production authorization rule</p><p className="mt-1 text-[11px] leading-5 text-violet-700">Opening a tenant must establish a server-side tenant context from the authenticated Super Admin session. Never trust the <code className="rounded bg-white/70 px-1">tenant</code> query parameter as an authorization boundary.</p></section>
    </main>
  );
}
