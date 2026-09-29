"use client";

import Link from "next/link";
import {
  ArrowPathIcon,
  ArrowTrendingUpIcon,
  BellAlertIcon,
  CloudIcon,
  ComputerDesktopIcon,
  ExclamationTriangleIcon,
  FolderIcon,
  PlusIcon,
  QrCodeIcon,
  ShieldCheckIcon,
  TicketIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";

const ticketRows = [
  ["#IT-123", "Network Down", "Sarah", "High", "In Progress", "10 min ago"],
  ["#IT-128", "Laptop replacement", "Liza", "Medium", "Open", "20 min ago"],
  ["#IT-131", "VPN access request", "Tina", "High", "In Progress", "35 min ago"],
] as const;

const systemMetrics = [
  ["Total Assets", "3,248", ComputerDesktopIcon],
  ["Assigned Assets", "2,736", UserGroupIcon],
  ["Open Tickets", "86", TicketIcon],
  ["Online Devices", "94.2%", CloudIcon],
] as const;

const hardwareDistribution = [["Laptops",72],["Desktops",88],["Servers",67],["Mobile",54]] as const;

const quickActions = [
  ["New incident", "Raise and assign an incident", ExclamationTriangleIcon],
  ["New request", "Capture a service request", FolderIcon],
  ["Deploy asset", "Assign an approved device", ComputerDesktopIcon],
  ["Audit hardware", "Start a physical inventory audit", ShieldCheckIcon],
  ["New ticket", "Create a ticket for a user", TicketIcon],
  ["Schedule sync", "Run discovery synchronization", ArrowPathIcon],
] as const;

export default function AgentDashboardPage() {
  return (
    <main className="mx-auto max-w-[1400px] space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold text-brand-600">Users · Bold And Wise Ventures Pvt Ltd</p>
          <h1 className="mt-0.5 text-2xl font-extrabold tracking-tight text-slate-950">Welcome back, Sandeep!</h1>
          <p className="mt-1 text-xs text-slate-500">Here&apos;s what&apos;s happening with your IT environment.</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700">Today · 10:45 AM</div>
      </header>

      <section className="grid gap-3 xl:grid-cols-[1fr_255px]">
        <article className="overflow-hidden rounded-xl border border-blue-200 bg-gradient-to-r from-blue-700 via-blue-600 to-blue-400 p-4 text-white shadow-sm">
          <div className="flex items-center justify-between">
            <div><p className="text-sm font-bold">System Overview</p><p className="text-[10px] text-blue-100">Real-time IT operations</p></div>
            <div className="hidden rounded-xl bg-white/15 px-4 py-2 text-right sm:block"><p className="text-[10px] text-blue-100">All systems</p><p className="text-sm font-extrabold">Operational</p></div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-white p-3 text-slate-900 sm:grid-cols-4">
            {systemMetrics.map(([label,value,Icon]) => <div key={label} className="flex items-center gap-2 border-slate-100 px-2 sm:border-r last:border-0"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-blue-100 bg-blue-50 text-brand-600"><Icon className="h-4 w-4" /></span><div className="min-w-0"><p className="text-sm font-extrabold">{value}</p><p className="truncate text-[9px] font-semibold text-slate-500">{label}</p></div></div>)}
          </div>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
          <div className="flex items-center justify-between"><h2 className="text-sm font-bold text-slate-900">Quick Actions</h2><PlusIcon className="h-4 w-4 text-slate-400" /></div>
          <div className="mt-3 grid grid-cols-2 gap-2">{quickActions.map(([label,desc,Icon]) => <button key={label} type="button" className="rounded-lg border border-slate-100 bg-slate-50 p-2.5 text-left hover:border-blue-200 hover:bg-blue-50"><span className="grid h-7 w-7 place-items-center rounded-full bg-blue-100 text-brand-600"><Icon className="h-3.5 w-3.5" /></span><p className="mt-2 text-[10px] font-bold text-slate-800">{label}</p><p className="mt-0.5 hidden text-[9px] leading-3 text-slate-500 sm:block">{desc}</p></button>)}</div>
          <Link href="/agent/tickets" className="mt-3 flex items-center justify-center rounded-lg bg-brand-600 py-2 text-[10px] font-bold text-white hover:bg-brand-700">View All Actions</Link>
        </article>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="text-sm font-bold">Asset tracking</h2><p className="mt-1 text-[10px] text-slate-500">Total assets <b className="text-slate-700">3,248</b></p><div className="mt-5 flex items-center gap-5"><div className="relative h-24 w-24 rounded-full bg-[conic-gradient(#2563eb_0_60%,#7ddf6b_60%_100%)]"><div className="absolute inset-2 grid place-items-center rounded-full bg-white"><div className="text-center"><p className="text-lg font-extrabold">3,248</p><p className="text-[9px] text-slate-400">Assets</p></div></div></div><div className="space-y-2 text-[10px]"><p><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-brand-500" />Hardware <b>1,955</b></p><p><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-lime-400" />Software <b>1,293</b></p></div></div></article>
        <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="text-sm font-bold">Asset Health</h2><p className="mt-1 text-[10px] text-slate-500">Devices online</p><div className="mt-4 flex items-center gap-5"><div className="relative h-24 w-24 rounded-full bg-[conic-gradient(#4f6cf7_0_94.2%,#eef2ff_94.2%)]"><div className="absolute inset-2 grid place-items-center rounded-full bg-white"><p className="text-lg font-extrabold">94.2%</p></div></div><div><p className="text-xs font-bold text-emerald-600">Healthy</p><p className="mt-1 text-[10px] leading-4 text-slate-500">2,960 devices online<br />288 need attention</p></div></div></article>
        <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="text-sm font-bold">Hardware Distribution</h2><div className="mt-4 space-y-3">{hardwareDistribution.map(([name,width])=><div key={name}><div className="mb-1 flex justify-between text-[10px] text-slate-500"><span>{name}</span><b>{width}%</b></div><div className="h-1.5 rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-500" style={{width:`${width}%`}} /></div></div>)}</div></article>
      </section>

      <section className="grid gap-3 lg:grid-cols-3">
        <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-[10px] font-semibold text-slate-500">Active Cloud Instances</p><p className="mt-1 text-xl font-extrabold">1,215</p><p className="mt-2 text-[10px] text-slate-500">AWS 650 · Azure 410 · GCP 155</p><ArrowTrendingUpIcon className="mt-2 h-5 w-5 text-brand-500" /></article>
        <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-[10px] font-semibold text-slate-500">Total Cloud Storage Utilized</p><p className="mt-1 text-xl font-extrabold">418 TB</p><p className="mt-2 text-[10px] text-slate-500">AWS 214 · Azure 126 · GCP 78</p><CloudIcon className="mt-2 h-5 w-5 text-brand-500" /></article>
        <article className="rounded-xl border border-slate-200 bg-blue-50 p-4 shadow-sm"><p className="text-[10px] font-semibold text-brand-600">Smart Insight</p><p className="mt-1 text-sm font-extrabold text-slate-900">Cloud usage is 18% higher than last month.</p><Link href="/agent/reports" className="mt-3 inline-flex text-[10px] font-bold text-brand-600">View detailed report →</Link></article>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><div><h2 className="text-sm font-bold">Active Ticket Queue</h2><p className="text-[10px] text-slate-500">Tickets assigned to the IT operations team.</p></div><div className="flex items-center gap-2"><Link href="/agent/tickets" className="rounded-md border border-slate-200 px-2 py-1 text-[9px] font-bold text-slate-600">View All</Link><button type="button" className="rounded-md border border-slate-200 px-2 py-1 text-[9px] font-bold text-slate-600">Filter</button></div></div><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left"><thead className="bg-slate-50 text-[9px] uppercase tracking-wider text-slate-400"><tr>{["Ticket ID","Subject","Requester","Priority","Status","Assigned","Last Update"].map(h=><th key={h} className="px-4 py-2 font-bold">{h}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{ticketRows.map(t=><tr key={t[0]} className="text-[10px] hover:bg-slate-50"><td className="px-4 py-2.5 font-bold text-slate-800">{t[0]}</td><td className="px-4 py-2.5 font-semibold text-slate-700">{t[1]}</td><td className="px-4 py-2.5 text-slate-500">{t[2]}</td><td className="px-4 py-2.5"><span className={t[3]==="High"?"font-bold text-rose-500":"font-bold text-amber-500"}>{t[3]}</span></td><td className="px-4 py-2.5 text-slate-600">{t[4]}</td><td className="px-4 py-2.5 text-slate-500">Sandeep</td><td className="px-4 py-2.5 text-slate-400">{t[5]}</td></tr>)}</tbody></table></div></section>

      <section className="grid gap-3 md:grid-cols-3"><article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><QrCodeIcon className="h-5 w-5 text-brand-600" /><h2 className="mt-2 text-sm font-bold">Scan & Identify</h2><p className="mt-1 text-[10px] leading-4 text-slate-500">Scan a QR or barcode to open the complete asset record and assignment history.</p><Link href="/agent/assets" className="mt-3 inline-block text-[10px] font-bold text-brand-600">Open assets →</Link></article><article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><BellAlertIcon className="h-5 w-5 text-amber-500" /><h2 className="mt-2 text-sm font-bold">Warranty alerts</h2><p className="mt-1 text-[10px] leading-4 text-slate-500">18 assets have warranties expiring in the next 30 days.</p><Link href="/agent/inventory" className="mt-3 inline-block text-[10px] font-bold text-brand-600">Review inventory →</Link></article><article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><ShieldCheckIcon className="h-5 w-5 text-emerald-500" /><h2 className="mt-2 text-sm font-bold">Agent permissions</h2><p className="mt-1 text-[10px] leading-4 text-slate-500">Tickets, assigned assets, inventory, user lookup and approved reports.</p><Link href="/agent/settings" className="mt-3 inline-block text-[10px] font-bold text-brand-600">View profile →</Link></article></section>
    </main>
  );
}
