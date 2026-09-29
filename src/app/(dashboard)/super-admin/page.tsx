"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRightIcon, BuildingOffice2Icon, CheckCircleIcon, ChevronRightIcon, CreditCardIcon, ShieldCheckIcon, UsersIcon } from "@heroicons/react/24/outline";

const companies = [
  ["Acme Technologies", "Enterprise", "Active", "12,486", "₹4.8L"],
  ["Northstar Retail", "Business", "Active", "4,218", "₹1.9L"],
  ["BluePeak Finance", "Enterprise", "Trial", "2,804", "₹0"],
  ["Orbit Logistics", "Starter", "Past due", "684", "₹42K"],
] as const;

const stats = [
  ["Active companies", "128", "+8 this month", BuildingOffice2Icon],
  ["Managed endpoints", "48,392", "+6.4%", UsersIcon],
  ["Monthly recurring revenue", "₹38.6L", "+12.8%", CreditCardIcon],
  ["Platform uptime", "99.98%", "30 day SLA", ShieldCheckIcon],
] as const;

export default function SuperAdminPage() {
  const [notice, setNotice] = useState(false);
  return <main className="mx-auto max-w-[1400px] space-y-5">
    <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
      <div><p className="text-[11px] font-bold uppercase tracking-wider text-violet-600">Platform control center</p><h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">Super Admin workspace</h1><p className="mt-1 text-sm text-slate-500">Manage companies, subscriptions, tenants and platform-level administration.</p></div>
      <div className="flex flex-wrap gap-2"><button onClick={() => setNotice(true)} className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">+ Add company</button><Link href="/super-admin/subscriptions" className="rounded-lg bg-brand-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm hover:bg-brand-700">Manage subscriptions</Link></div>
    </header>
    {notice && <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-800"><span>Company provisioning flow is ready for API integration.</span><button onClick={() => setNotice(false)}>Dismiss</button></div>}

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{stats.map(([label, value, change, Icon]) => <article key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between"><div><p className="text-[11px] font-semibold text-slate-500">{label}</p><p className="mt-1 text-xl font-extrabold tracking-tight text-slate-950">{value}</p></div><span className="grid h-9 w-9 place-items-center rounded-lg bg-blue-50 text-brand-600"><Icon className="h-4.5 w-4.5" /></span></div><p className="mt-3 text-[10px] font-bold text-emerald-600">{change}</p></article>)}</section>

    <section className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
      <article className="rounded-xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5"><div><h2 className="text-sm font-bold text-slate-900">Company & tenant overview</h2><p className="mt-0.5 text-[11px] text-slate-500">Cross-tenant subscription and endpoint health.</p></div><Link href="/super-admin/companies" className="text-[11px] font-bold text-brand-600">View all →</Link></div><div className="overflow-x-auto"><table className="w-full text-left"><thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-400"><tr><th className="px-4 py-2.5">Company</th><th className="px-4 py-2.5">Plan</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5">Endpoints</th><th className="px-4 py-2.5">MRR</th><th className="px-4 py-2.5" /></tr></thead><tbody className="divide-y divide-slate-100">{companies.map(([name, plan, status, endpoints, mrr]) => <tr key={name} className="text-xs hover:bg-slate-50/70"><td className="px-4 py-3 font-bold text-slate-800">{name}</td><td className="px-4 py-3 text-slate-600">{plan}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${status === "Active" ? "bg-emerald-50 text-emerald-700" : status === "Trial" ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"}`}>{status}</span></td><td className="px-4 py-3 font-semibold text-slate-700">{endpoints}</td><td className="px-4 py-3 font-semibold text-slate-700">{mrr}</td><td className="px-4 py-3"><Link href="/super-admin/companies" className="text-slate-400 hover:text-brand-600"><ArrowUpRightIcon className="h-4 w-4" /></Link></td></tr>)}</tbody></table></div></article>

      <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><div><h2 className="text-sm font-bold text-slate-900">Subscription health</h2><p className="mt-0.5 text-[11px] text-slate-500">Current plan distribution.</p></div><CreditCardIcon className="h-5 w-5 text-brand-500" /></div><div className="mt-5 space-y-3.5">{[["Enterprise", 38, "12,980 seats"], ["Business", 42, "7,640 seats"], ["Starter", 20, "2,440 seats"]].map(([name, percent, detail]) => <div key={name}><div className="mb-1.5 flex justify-between text-[11px]"><span className="font-semibold text-slate-700">{name}</span><span className="text-slate-400">{percent}% · {detail}</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-500" style={{ width: `${percent}%` }} /></div></div>)}</div><Link href="/super-admin/subscriptions" className="mt-5 inline-flex items-center gap-1 text-[11px] font-bold text-brand-600">Open subscription workspace <ChevronRightIcon className="h-3.5 w-3.5" /></Link></article>
    </section>

    <section className="grid gap-4 lg:grid-cols-3">
      <Link href="/super-admin/tenants" className="group rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-200 hover:shadow"><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-lg bg-blue-50 text-brand-600"><UsersIcon className="h-4.5 w-4.5" /></span><div><p className="text-xs font-bold text-slate-800">Tenant management</p><p className="text-[10px] text-slate-500">Provision, suspend and switch tenants.</p></div></div><span className="mt-4 inline-flex items-center gap-1 text-[10px] font-bold text-brand-600">Open workspace <ChevronRightIcon className="h-3 w-3" /></span></Link>
      <Link href="/super-admin/admins" className="group rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-200 hover:shadow"><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-lg bg-violet-50 text-violet-600"><ShieldCheckIcon className="h-4.5 w-4.5" /></span><div><p className="text-xs font-bold text-slate-800">Platform administrators</p><p className="text-[10px] text-slate-500">Control privileged roles and access.</p></div></div><span className="mt-4 inline-flex items-center gap-1 text-[10px] font-bold text-brand-600">Manage admins <ChevronRightIcon className="h-3 w-3" /></span></Link>
    </section>

    <section className="rounded-xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5"><div><h2 className="text-sm font-bold text-slate-900">Platform activity</h2><p className="mt-0.5 text-[11px] text-slate-500">Recent super-admin actions across all tenants.</p></div><Link href="/super-admin/audit" className="text-[11px] font-bold text-brand-600">View audit log →</Link></div><div className="grid divide-y divide-slate-100 md:grid-cols-3 md:divide-x md:divide-y-0">{[["Northstar Retail", "Plan upgraded to Business", "8 min ago"], ["Acme Technologies", "Tenant admin invited", "31 min ago"], ["Orbit Logistics", "Payment marked past due", "1 hr ago"]].map(([company, event, time]) => <div key={company} className="flex gap-3 p-4"><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand-500" /><div><p className="text-xs font-semibold text-slate-800">{event}</p><p className="mt-1 text-[10px] text-slate-500">{company} · {time}</p></div><CheckCircleIcon className="ml-auto h-4 w-4 text-emerald-500" /></div>)}</div></section>
  </main>;
}
