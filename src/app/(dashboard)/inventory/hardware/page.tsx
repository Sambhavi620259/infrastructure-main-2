"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  getHardwareStock,
  listReceipts,
  newReference,
  receiveStock,
  type HardwareStockRow,
  type StockReceipt,
} from "@/lib/inventory";
import { listPurchaseOrders, type PurchaseOrder } from "@/lib/procurement";
import { listAssetCategories, type AssetCategory } from "@/lib/tickets";
import { formatDate } from "@/types/asset";

/** Hardware stock derived from receipts and devices, receiving against POs, and registering devices. */
export default function HardwareStockPage() {
  const [stock, setStock] = useState<HardwareStockRow[]>([]);
  const [receipts, setReceipts] = useState<StockReceipt[]>([]);
  const [query, setQuery] = useState("");
  const [receiving, setReceiving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(() => {
    Promise.all([getHardwareStock(), listReceipts()])
      .then(([stockData, receiptData]) => {
        setStock(stockData);
        setReceipts(receiptData);
        setError("");
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load hardware stock."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return stock.filter((row) => `${row.category} ${row.brand ?? ""} ${row.model ?? ""}`.toLowerCase().includes(needle));
  }, [stock, query]);

  const total = (key: keyof HardwareStockRow) => stock.reduce((sum, row) => sum + (Number(row[key]) || 0), 0);
  const open = receipts.filter((r) => r.registered < r.quantity);

  return (
    <main className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-brand-600">Inventory · Hardware Stock</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">Hardware Stock</h1>
          <p className="mt-1 text-sm text-slate-500">
            Receive devices against an approved purchase order, then register each one as an asset. Quantities are calculated from
            receipts and each device&rsquo;s status.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setReceiving(true)}
          disabled={receiving}
          className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700 disabled:opacity-60"
        >
          Receive stock
        </button>
      </header>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
      {notice && (
        <div role="status" className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")} aria-label="Dismiss">×</button>
        </div>
      )}

      {receiving && (
        <ReceiveForm
          onCancel={() => setReceiving(false)}
          onReceived={(receipt) => {
            setReceiving(false);
            setNotice(`Received ${receipt.quantity} × ${receipt.model ?? receipt.category} on ${receipt.po_number}. Register each device below.`);
            load();
          }}
        />
      )}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {(
          [
            ["Purchased", "purchased", "text-slate-900"],
            ["To register", "awaiting_registration", "text-violet-600"],
            ["Available", "available", "text-emerald-600"],
            ["Reserved", "reserved", "text-sky-600"],
            ["Assigned", "assigned", "text-blue-600"],
            ["Under repair", "under_repair", "text-amber-600"],
          ] as const
        ).map(([label, key, color]) => (
          <div key={key} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold text-slate-500">{label}</p>
            <p className={`mt-1 text-2xl font-extrabold ${color}`}>{loading ? "—" : total(key)}</p>
          </div>
        ))}
      </section>

      {open.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-violet-200 bg-white shadow-sm">
          <div className="border-b border-violet-100 bg-violet-50/60 px-5 py-3">
            <h2 className="text-sm font-bold text-slate-900">Received, waiting to be registered ({open.length})</h2>
            <p className="text-xs text-slate-500">Each physical device gets its own asset record with its serial number.</p>
          </div>
          <ul className="divide-y divide-slate-100">
            {open.map((receipt) => (
              <li key={receipt.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                <span className="min-w-0">
                  <span className="block font-semibold text-slate-800">
                    {receipt.quantity} × {[receipt.brand, receipt.model].filter(Boolean).join(" ") || receipt.category}
                    <span className="font-normal text-slate-500"> · {receipt.category}</span>
                  </span>
                  <span className="block text-xs text-slate-500">
                    {receipt.po_number} · received {formatDate(receipt.received_at)}
                    {receipt.location ? ` · ${receipt.location}` : ""} · {receipt.registered} of {receipt.quantity} registered
                  </span>
                </span>
                <Link href={`/assets/hardware/new?receipt=${receipt.id}`} className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-700">
                  Register device
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-bold text-slate-900">Stock by device type</h2>
          <label>
            <span className="sr-only">Search stock</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search category, make or model"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-brand-500 sm:w-72"
            />
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                {["Category", "Make / model", "Purchased", "To register", "Available", "Reserved", "Assigned", "Under repair", "Retired"].map((h) => (
                  <th key={h} className="px-4 py-2.5 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((row) => (
                <tr key={`${row.category}|${row.brand}|${row.model}`} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-semibold text-slate-800">{row.category}</td>
                  <td className="px-4 py-3 text-slate-600">{[row.brand, row.model].filter(Boolean).join(" ") || "—"}</td>
                  <td className="px-4 py-3 font-semibold text-slate-800">{row.purchased}</td>
                  <td className={`px-4 py-3 ${row.awaiting_registration ? "font-semibold text-violet-700" : "text-slate-400"}`}>{row.awaiting_registration}</td>
                  <td className={`px-4 py-3 font-semibold ${row.available ? "text-emerald-700" : "text-slate-400"}`}>{row.available}</td>
                  <td className="px-4 py-3 text-slate-600">{row.reserved}</td>
                  <td className="px-4 py-3 text-slate-600">{row.assigned}</td>
                  <td className="px-4 py-3 text-slate-600">{row.under_repair}</td>
                  <td className="px-4 py-3 text-slate-400">{row.retired}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && visible.length === 0 && (
          <p className="p-8 text-center text-sm text-slate-500">
            {stock.length === 0 ? "No hardware yet. Receive stock against an approved purchase order to start." : "Nothing matches."}
          </p>
        )}
      </section>
    </main>
  );
}

function ReceiveForm({ onCancel, onReceived }: { onCancel: () => void; onReceived: (receipt: StockReceipt) => void }) {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [values, setValues] = useState({ purchase_order_id: "", category: "", brand: "", model: "", specifications: "", quantity: "1", unit_cost: "", location: "", notes: "" });
  const [completePo, setCompletePo] = useState(false);
  // One key per form: a double click records the receipt once.
  const [reference] = useState(newReference);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    listPurchaseOrders("ORDERED").then(setOrders).catch(() => undefined);
    listAssetCategories().then(setCategories).catch(() => undefined);
  }, []);

  const set = (key: keyof typeof values) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [key]: event.target.value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!values.purchase_order_id) return setError("Choose the approved purchase order this delivery is for.");
    if (!values.category.trim()) return setError("Choose the category.");
    if (!/^\d+$/.test(values.quantity) || Number(values.quantity) < 1) return setError("Quantity must be a whole number of at least 1.");
    setBusy(true);
    setError("");
    try {
      onReceived(
        await receiveStock({
          purchase_order_id: values.purchase_order_id,
          category: values.category.trim(),
          brand: values.brand.trim() || undefined,
          model: values.model.trim() || undefined,
          specifications: values.specifications.trim() || undefined,
          quantity: Number(values.quantity),
          unit_cost: values.unit_cost ? Number(values.unit_cost) : 0,
          location: values.location.trim() || undefined,
          notes: values.notes.trim() || undefined,
          complete_po: completePo,
          reference,
        }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not record the receipt.");
    } finally {
      setBusy(false);
    }
  };

  const input = "mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-brand-500";
  const label = "block text-xs font-bold text-slate-700";
  return (
    <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" noValidate>
      <h2 className="text-sm font-extrabold text-slate-900">Receive stock</h2>
      <p className="text-xs text-slate-500">Only purchase orders that have been approved (ordered) can be received against.</p>
      {orders.length === 0 && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          No approved purchase orders. Raise and approve one under{" "}
          <Link href="/inventory/movements?tab=orders" className="font-semibold underline">Purchase &amp; Stock Movements</Link>.
        </p>
      )}
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className={label}>Purchase order *
          <select value={values.purchase_order_id} onChange={set("purchase_order_id")} className={input}>
            <option value="">Choose…</option>
            {orders.map((po) => <option key={po.id} value={po.id}>{po.po_number}{po.vendor_name ? ` · ${po.vendor_name}` : ""}</option>)}
          </select>
        </label>
        <label className={label}>Category *
          <select value={values.category} onChange={set("category")} className={input}>
            <option value="">Choose…</option>
            {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
        </label>
        <label className={label}>Quantity *
          <input type="number" min={1} step={1} value={values.quantity} onChange={set("quantity")} className={input} />
        </label>
        <label className={label}>Manufacturer<input value={values.brand} onChange={set("brand")} maxLength={100} placeholder="e.g. Dell" className={input} /></label>
        <label className={label}>Model<input value={values.model} onChange={set("model")} maxLength={100} placeholder="e.g. Latitude 5440" className={input} /></label>
        <label className={label}>Unit cost<input type="number" min={0} step="0.01" value={values.unit_cost} onChange={set("unit_cost")} className={input} /></label>
        <label className={label}>Storage location<input value={values.location} onChange={set("location")} maxLength={100} placeholder="e.g. Store room B" className={input} /></label>
        <label className={`${label} sm:col-span-2`}>Specifications<input value={values.specifications} onChange={set("specifications")} maxLength={2000} placeholder="e.g. i7, 16 GB, 512 GB SSD" className={input} /></label>
        <label className={`${label} sm:col-span-2 lg:col-span-3`}>Notes<input value={values.notes} onChange={set("notes")} maxLength={1000} className={input} /></label>
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={completePo} onChange={(event) => setCompletePo(event.target.checked)} />
        This completes the purchase order (mark it received)
      </label>
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50">
          {busy ? "Saving…" : "Record receipt"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">Cancel</button>
      </div>
    </form>
  );
}
