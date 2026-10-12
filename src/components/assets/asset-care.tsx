"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  calculateAssetDepreciation,
  createMaintenance,
  listMaintenance,
  money,
  updateMaintenance,
  type DepreciationResult,
  type MaintenanceRecord,
} from "@/lib/operations";
import { listVendors, type Vendor } from "@/lib/procurement";
import type { Asset } from "@/types/asset";

const STATUS_STYLE: Record<string, string> = {
  SCHEDULED: "bg-blue-50 text-blue-700",
  IN_PROGRESS: "bg-amber-50 text-amber-700",
  COMPLETED: "bg-emerald-50 text-emerald-700",
  CANCELLED: "bg-slate-100 text-slate-600",
};

function day(value: string | null): string {
  return value ? new Date(value).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—";
}

/**
 * Maintenance history and depreciation for one asset, shown on the asset page.
 * `onAssetChanged` lets the page reload the asset after its status moves.
 */
export function AssetCare({ asset, onAssetChanged }: { asset: Asset; onAssetChanged: () => void }) {
  return (
    <section className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
      <MaintenanceCard asset={asset} onAssetChanged={onAssetChanged} />
      <DepreciationCard asset={asset} />
    </section>
  );
}

function MaintenanceCard({ asset, onAssetChanged }: { asset: Asset; onAssetChanged: () => void }) {
  const [records, setRecords] = useState<MaintenanceRecord[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    listMaintenance({ asset_id: asset.id })
      .then(setRecords)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load maintenance."));
  }, [asset.id]);

  useEffect(load, [load]);
  useEffect(() => {
    listVendors()
      .then((data) => setVendors(data.filter((v) => v.status === "ACTIVE")))
      .catch(() => undefined);
  }, []);

  const open = records.find((r) => r.status === "SCHEDULED" || r.status === "IN_PROGRESS");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const issue = String(form.get("issue") ?? "").trim();
    if (!issue) return setError("Describe the problem.");
    setBusy(true);
    try {
      await createMaintenance({
        asset_id: asset.id,
        issue,
        vendor_id: String(form.get("vendor_id") ?? "") || undefined,
        cost: Number(form.get("cost")) || 0,
        status: form.get("start_now") ? "IN_PROGRESS" : "SCHEDULED",
      });
      setFormOpen(false);
      setError("");
      load();
      onAssetChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not log maintenance.");
    } finally {
      setBusy(false);
    }
  };

  const move = async (record: MaintenanceRecord, status: "IN_PROGRESS" | "COMPLETED" | "CANCELLED") => {
    setBusy(true);
    try {
      await updateMaintenance(record.id, { status });
      setError("");
      load();
      onAssetChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  };

  const unrepairable = ["RETIRED", "DISPOSED", "LOST"].includes(asset.status);

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900">Maintenance</h2>
          <p className="mt-1 text-sm text-slate-500">Starting a repair moves the asset to In repair; closing it returns it.</p>
        </div>
        {!open && !formOpen && !unrepairable && (
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="shrink-0 rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white hover:bg-brand-700"
          >
            Log repair
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {formOpen && (
        <form onSubmit={submit} className="mt-4 space-y-3 rounded-lg border border-slate-200 p-4" noValidate>
          <label className="block text-xs font-semibold text-slate-600">
            Problem
            <input name="issue" placeholder="e.g. Screen flickers" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-slate-600">
              Repair vendor
              <select name="vendor_id" defaultValue="" className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal">
                <option value="">In-house</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-semibold text-slate-600">
              Estimated cost
              <input name="cost" type="number" min={0} step="0.01" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="start_now" defaultChecked /> Start now (asset goes to In repair)
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
              {busy ? "Saving…" : "Log repair"}
            </button>
            <button type="button" onClick={() => setFormOpen(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">
              Cancel
            </button>
          </div>
        </form>
      )}

      {records.length === 0 ? (
        <p className="mt-5 text-sm text-slate-500">No maintenance recorded for this asset.</p>
      ) : (
        <ul className="mt-5 divide-y divide-slate-100 text-sm">
          {records.map((record) => (
            <li key={record.id} className="py-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-800">{record.issue}</p>
                  <p className="text-xs text-slate-500">
                    {day(record.start_date)}
                    {record.completion_date ? ` → ${day(record.completion_date)}` : ""} · {record.vendor_name ?? "In-house"} · cost{" "}
                    {money(record.cost)} · by {record.reported_by_name ?? "unknown"}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLE[record.status]}`}>
                  {record.status.replace("_", " ")}
                </span>
              </div>
              {(record.status === "SCHEDULED" || record.status === "IN_PROGRESS") && (
                <div className="mt-2 flex gap-3 text-xs font-semibold">
                  {record.status === "SCHEDULED" && (
                    <button type="button" disabled={busy} onClick={() => move(record, "IN_PROGRESS")} className="text-amber-700">
                      Start repair
                    </button>
                  )}
                  <button type="button" disabled={busy} onClick={() => move(record, "COMPLETED")} className="text-emerald-700">
                    Mark completed
                  </button>
                  <button type="button" disabled={busy} onClick={() => move(record, "CANCELLED")} className="text-slate-500">
                    Cancel
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function DepreciationCard({ asset }: { asset: Asset }) {
  const [result, setResult] = useState<DepreciationResult | null>(null);
  const [method, setMethod] = useState<"STRAIGHT_LINE" | "DECLINING_BALANCE">("STRAIGHT_LINE");
  const [years, setYears] = useState("5");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const calculate = useCallback(
    async (overrides?: { method: "STRAIGHT_LINE" | "DECLINING_BALANCE"; useful_life_years: number }) => {
      setBusy(true);
      try {
        const data = await calculateAssetDepreciation(asset.id, overrides);
        setResult(data);
        setMethod(data.method as "STRAIGHT_LINE" | "DECLINING_BALANCE");
        setError("");
      } catch (caught) {
        setResult(null);
        setError(caught instanceof Error ? caught.message : "Could not calculate depreciation.");
      } finally {
        setBusy(false);
      }
    },
    [asset.id],
  );

  const missing = !asset.purchase_date || !(Number(asset.purchase_price) > 0);

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="font-semibold text-slate-900">Depreciation</h2>
      {missing ? (
        <p className="mt-3 text-sm text-slate-500">Add a purchase date and price to this asset to see its book value.</p>
      ) : (
        <>
          {result && (
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              {[
                ["Purchase price", money(result.original_cost)],
                ["Book value now", money(result.current_value)],
                ["Depreciated", money(result.total_depreciated)],
                ["Per year", money(result.annual_depreciation)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-slate-500">{label}</dt>
                  <dd className="font-semibold text-slate-800">{value}</dd>
                </div>
              ))}
            </dl>
          )}
          <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4">
            <label className="text-xs font-semibold text-slate-600">
              Method
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as "STRAIGHT_LINE" | "DECLINING_BALANCE")}
                className="mt-1 block rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-normal"
              >
                <option value="STRAIGHT_LINE">Straight line</option>
                <option value="DECLINING_BALANCE">Declining balance</option>
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-600">
              Useful life (years)
              <input
                type="number"
                min={1}
                max={50}
                value={years}
                onChange={(e) => setYears(e.target.value)}
                className="mt-1 block w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-normal"
              />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => calculate({ method, useful_life_years: Math.max(1, Number.parseInt(years, 10) || 5) })}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {busy ? "Calculating…" : result ? "Recalculate & save" : "Calculate book value"}
            </button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
    </article>
  );
}
