"use client";

import { useState } from "react";

const reportTypes = [
  ["Asset inventory", "Complete hardware inventory by model, owner, and location.", "12,486 assets"],
  ["License compliance", "Entitlements, deployments, and compliance exceptions.", "486 products"],
  ["Depreciation schedule", "Asset book value and expense forecast by financial period.", "FY 2026–27"],
  ["Warranty & lifecycle", "Coverage gaps, warranty expirations, and retirement plans.", "38 expiring"],
] as const;

const scheduled = [
  ["Monthly asset inventory", "Asset inventory", "1st of every month", "Email · CSV", "Active"],
  ["Quarterly license audit", "License compliance", "1 Oct 2026", "Email · PDF", "Active"],
  ["Warranty expiry watchlist", "Warranty & lifecycle", "Every Monday", "Email · CSV", "Active"],
] as const;

const exports = [
  ["License compliance · Aug 2026", "PDF", "Today, 09:24", "Priya Sharma"],
  ["Mumbai asset inventory", "CSV", "Yesterday, 16:08", "Arjun Nair"],
  ["Depreciation schedule · Q2", "XLSX", "22 Aug, 11:42", "Neha Verma"],
] as const;

export default function ReportsPage() {
  const [notice, setNotice] = useState("");
  return <main className="mx-auto max-w-7xl space-y-8">
    <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm font-medium text-brand-600">Reporting & analytics</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">Reports</h1><p className="mt-2 text-slate-500">Create audit-ready exports and automate updates for stakeholders.</p></div><button onClick={() => setNotice("Report builder opened — connect report filters and export API next.")} className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700">+ Create report</button></header>
    {notice && <div role="status" className="flex items-center justify-between rounded-xl border border-brand-200 bg-brand-50 px-5 py-4 text-sm text-brand-900"><span>{notice}</span><button onClick={() => setNotice("")} className="ml-4 font-semibold">Dismiss</button></div>}
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[['24', 'Reports generated', 'This month'], ['3', 'Scheduled reports', 'All running normally'], ['98%', 'Data freshness', 'Updated in the last 24 hrs'], ['7', 'Saved templates', 'Available to your team']].map(([value, label, hint]) => <article key={label} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-2xl font-bold tracking-tight text-slate-950">{value}</p><p className="mt-1 text-sm font-medium text-slate-700">{label}</p><p className="mt-2 text-xs text-slate-500">{hint}</p></article>)}</section>
    <section><div className="mb-4 flex items-end justify-between"><div><h2 className="font-semibold text-slate-900">Start with a template</h2><p className="mt-1 text-sm text-slate-500">Common reports for operations, finance, and audit teams.</p></div><button className="text-sm font-semibold text-brand-600 hover:text-brand-700">Browse templates →</button></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{reportTypes.map(([title, description, meta]) => <article key={title} className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md"><div className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand-600">▦</div><h3 className="mt-5 font-semibold text-slate-900">{title}</h3><p className="mt-2 min-h-12 text-sm leading-5 text-slate-500">{description}</p><div className="mt-5 flex items-center justify-between"><span className="text-xs font-medium text-slate-400">{meta}</span><button onClick={() => setNotice(`${title} report template selected.`)} className="text-sm font-semibold text-brand-600 hover:text-brand-700">Use template →</button></div></article>)}</div></section>
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-slate-100 px-6 py-5"><div><h2 className="font-semibold text-slate-900">Scheduled reports</h2><p className="mt-1 text-sm text-slate-500">Recurring reports delivered to your team.</p></div><button className="text-sm font-semibold text-brand-600 hover:text-brand-700">Manage schedules →</button></div><div className="overflow-x-auto"><table className="min-w-[780px] w-full text-left"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-6 py-3 font-semibold">Report</th><th className="px-6 py-3 font-semibold">Type</th><th className="px-6 py-3 font-semibold">Next delivery</th><th className="px-6 py-3 font-semibold">Format</th><th className="px-6 py-3 font-semibold">Status</th><th className="px-6 py-3" /></tr></thead><tbody className="divide-y divide-slate-100">{scheduled.map(([name, type, next, format, status]) => <tr key={name} className="hover:bg-slate-50"><td className="px-6 py-4 font-semibold text-slate-800">{name}</td><td className="px-6 py-4 text-sm text-slate-600">{type}</td><td className="px-6 py-4 text-sm text-slate-600">{next}</td><td className="px-6 py-4 text-sm text-slate-600">{format}</td><td className="px-6 py-4"><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">{status}</span></td><td className="px-6 py-4 text-right"><button className="text-sm font-semibold text-brand-600 hover:text-brand-700">Edit</button></td></tr>)}</tbody></table></div></section>
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-slate-100 px-6 py-5"><div><h2 className="font-semibold text-slate-900">Recent exports</h2><p className="mt-1 text-sm text-slate-500">Reports generated across your organization.</p></div><button className="text-sm font-semibold text-brand-600 hover:text-brand-700">View history →</button></div><div className="divide-y divide-slate-100">{exports.map(([name, format, date, author]) => <div key={name} className="flex flex-col gap-2 px-6 py-4 sm:flex-row sm:items-center sm:gap-5"><span className="grid h-9 w-9 place-items-center rounded-lg bg-slate-100 text-xs font-bold text-slate-600">{format}</span><div className="flex-1"><p className="font-medium text-slate-800">{name}</p><p className="mt-0.5 text-sm text-slate-500">Generated by {author}</p></div><p className="text-sm text-slate-500">{date}</p><button className="text-left text-sm font-semibold text-brand-600 hover:text-brand-700">Download</button></div>)}</div></section>
  </main>;
}
