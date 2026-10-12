"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  getDepartmentFinance,
  getFinancialSummary,
  money,
  recalculateAllDepreciation,
  type DepartmentFinance,
  type FinancialSummary,
} from "@/lib/operations";

export default function FinancialPage() {
  const [summary, setSummary] = useState<FinancialSummary | null>(null);
  const [departments, setDepartments] = useState<DepartmentFinance[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    Promise.all([getFinancialSummary(), getDepartmentFinance()])
      .then(([summaryData, departmentData]) => {
        setSummary(summaryData);
        setDepartments(departmentData.sort((a, b) => b.total_cost - a.total_cost));
        setError("");
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load financial data."));
  }, []);

  useEffect(load, [load]);

  const recalculate = async () => {
    setBusy(true);
    try {
      const result = await recalculateAllDepreciation();
      setNotice(`Depreciation recalculated for ${result.assets_updated} asset(s) with a purchase date and price.`);
      load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Recalculation failed.");
    } finally {
      setBusy(false);
    }
  };

  const depreciatedPct =
    summary && summary.total_asset_cost > 0
      ? Math.round((summary.accumulated_depreciation / summary.total_asset_cost) * 100)
      : 0;

  return (
    <main className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-brand-600">Finance</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">Asset finance</h1>
          <p className="mt-1 text-sm text-slate-500">
            What your hardware cost, what it is worth now, and where the money sits by department.
          </p>
        </div>
        <button
          type="button"
          onClick={recalculate}
          disabled={busy}
          className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? "Recalculating…" : "Recalculate depreciation"}
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

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {[
          ["Purchase cost", summary ? money(summary.total_asset_cost) : "—", "Everything registered"],
          ["Book value today", summary ? money(summary.net_book_value) : "—", "After depreciation"],
          ["Depreciated", summary ? `${money(summary.accumulated_depreciation)} (${depreciatedPct}%)` : "—", "Value written off so far"],
        ].map(([label, value, hint]) => (
          <article key={label} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-2xl font-bold text-slate-950">{value}</p>
            <p className="mt-1 text-sm font-medium text-slate-700">{label}</p>
            <p className="mt-1 text-xs text-slate-500">{hint}</p>
          </article>
        ))}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold text-slate-900">By department</h2>
          <p className="mt-1 text-xs text-slate-500">
            Assets with a department set. Assign departments on the asset record to fill this in.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[640px] w-full text-left">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600">
              <tr>
                {["Department", "Assets", "Purchase cost", "Book value", "Share of spend"].map((h) => (
                  <th key={h} className="px-5 py-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {departments.map((row) => {
                const share = summary && summary.total_asset_cost > 0 ? (row.total_cost / summary.total_asset_cost) * 100 : 0;
                return (
                  <tr key={row.department_id} className="text-sm">
                    <td className="px-5 py-3 font-semibold text-slate-800">{row.department_name}</td>
                    <td className="px-5 py-3 text-slate-600">{row.asset_count}</td>
                    <td className="px-5 py-3 text-slate-700">{money(row.total_cost)}</td>
                    <td className="px-5 py-3 text-slate-700">{money(row.current_value)}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-28 overflow-hidden rounded-full bg-slate-100" role="presentation">
                          <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.min(100, share)}%` }} />
                        </div>
                        <span className="text-xs text-slate-500">{share.toFixed(0)}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {departments.length === 0 && !error && (
          <p className="p-8 text-center text-sm text-slate-500">
            No departments yet. Add them under{" "}
            <Link href="/users/departments" className="font-semibold text-brand-600">
              Users → Departments
            </Link>
            .
          </p>
        )}
      </section>
    </main>
  );
}
