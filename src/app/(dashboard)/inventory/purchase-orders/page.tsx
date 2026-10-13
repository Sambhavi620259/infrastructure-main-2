"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  PO_NEXT,
  PO_STATUSES,
  createPurchaseOrder,
  listPurchaseOrders,
  listVendors,
  updatePurchaseOrderStatus,
  type PoStatus,
  type PurchaseOrder,
  type Vendor,
} from "@/lib/procurement";

const STATUS_STYLE: Record<PoStatus, string> = {
  PENDING: "bg-amber-50 text-amber-700",
  ORDERED: "bg-blue-50 text-blue-700",
  RECEIVED: "bg-emerald-50 text-emerald-700",
  CANCELLED: "bg-slate-100 text-slate-600",
};

const ACTION_LABEL: Record<PoStatus, string> = {
  PENDING: "Pending",
  ORDERED: "Approve & order",
  RECEIVED: "Mark received",
  CANCELLED: "Cancel",
};

function money(value: string | number): string {
  return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function PurchaseOrdersPage() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [filter, setFilter] = useState<PoStatus | "">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    listVendors()
      .then((data) => setVendors(data.filter((vendor) => vendor.status === "ACTIVE")))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listPurchaseOrders(filter || undefined)
      .then((data) => {
        if (!cancelled) setOrders(data);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load purchase orders.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filter, refreshKey]);

  const move = async (order: PurchaseOrder, status: PoStatus) => {
    setBusyId(order.id);
    try {
      const updated = await updatePurchaseOrderStatus(order.id, status);
      setNotice(`${updated.po_number} is now ${updated.status.toLowerCase()}.`);
      setError("");
      setRefreshKey((key) => key + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Update failed.");
    } finally {
      setBusyId("");
    }
  };

  const openValue = orders
    .filter((order) => order.status === "PENDING" || order.status === "ORDERED")
    .reduce((sum, order) => sum + Number(order.total_amount), 0);

  return (
    <main className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-brand-600">Inventory · Purchase Orders</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">Purchase Orders</h1>
          <p className="mt-1 text-sm text-slate-500">
            Track orders from raised to received. Open orders: <strong>{money(openValue)}</strong>
          </p>
        </div>
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          disabled={formOpen}
          className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700 disabled:opacity-60"
        >
          New purchase order
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

      {formOpen &&
        (vendors.length === 0 ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            Add a vendor first under{" "}
            <Link href="/inventory/vendors" className="font-semibold underline">
              Inventory → Vendors
            </Link>
            .{" "}
            <button type="button" onClick={() => setFormOpen(false)} className="ml-2 font-semibold">
              Close
            </button>
          </div>
        ) : (
          <PurchaseOrderForm
            vendors={vendors}
            onCancel={() => setFormOpen(false)}
            onSaved={(order) => {
              setFormOpen(false);
              setNotice(`Purchase order ${order.po_number} raised with ${order.vendor_name}.`);
              setError("");
              setRefreshKey((key) => key + 1);
            }}
          />
        ))}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-2 border-b border-slate-100 p-4">
          {(["", ...PO_STATUSES] as const).map((status) => (
            <button
              key={status || "all"}
              type="button"
              onClick={() => setFilter(status)}
              aria-pressed={filter === status}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset ${
                filter === status ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
              }`}
            >
              {status ? status.charAt(0) + status.slice(1).toLowerCase() : "All"}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[820px] w-full text-left">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600">
              <tr>
                {["PO number", "Vendor", "Amount", "Order date", "Status", ""].map((heading) => (
                  <th key={heading} className="px-5 py-3">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {orders.map((order) => (
                <tr key={order.id} className="text-sm hover:bg-slate-50">
                  <td className="px-5 py-3 font-mono font-semibold text-slate-800">{order.po_number}</td>
                  <td className="px-5 py-3 text-slate-600">{order.vendor_name ?? "—"}</td>
                  <td className="px-5 py-3 font-semibold text-slate-800">{money(order.total_amount)}</td>
                  <td className="px-5 py-3 text-slate-600">
                    {order.order_date ? new Date(order.order_date).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${STATUS_STYLE[order.status]}`}>{order.status}</span>
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-right">
                    <span className="inline-flex gap-3">
                      {PO_NEXT[order.status].map((next) => (
                        <button
                          key={next}
                          type="button"
                          disabled={busyId === order.id}
                          onClick={() => move(order, next)}
                          className={`text-sm font-semibold disabled:opacity-50 ${
                            next === "CANCELLED" ? "text-rose-600 hover:text-rose-700" : "text-brand-600 hover:text-brand-700"
                          }`}
                        >
                          {ACTION_LABEL[next]}
                        </button>
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && orders.length === 0 && !error && (
          <p className="p-10 text-center text-sm text-slate-500">No purchase orders here.</p>
        )}
      </section>
    </main>
  );
}

function PurchaseOrderForm({
  vendors,
  onCancel,
  onSaved,
}: {
  vendors: Vendor[];
  onCancel: () => void;
  onSaved: (order: PurchaseOrder) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const poNumber = String(form.get("po_number") ?? "").trim();
    const vendorId = String(form.get("vendor_id") ?? "");
    const amount = Number(form.get("total_amount"));
    const orderDate = String(form.get("order_date") ?? "");
    if (!poNumber || !vendorId) return setError("Enter a PO number and choose a vendor.");
    if (!Number.isFinite(amount) || amount < 0) return setError("Enter a valid amount.");
    setBusy(true);
    try {
      onSaved(
        await createPurchaseOrder({
          po_number: poNumber,
          vendor_id: vendorId,
          total_amount: amount,
          order_date: orderDate ? `${orderDate}T00:00:00` : undefined,
        }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not raise the purchase order.");
    } finally {
      setBusy(false);
    }
  };

  const inputClass = "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal";

  return (
    <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" noValidate>
      <h2 className="text-base font-extrabold text-slate-900">New purchase order</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-4">
        <label className="block text-xs font-semibold text-slate-600">
          PO number
          <input name="po_number" placeholder="e.g. PO-2026-014" className={inputClass} />
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Vendor
          <select name="vendor_id" defaultValue="" className={inputClass}>
            <option value="">Choose…</option>
            {vendors.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Total amount
          <input name="total_amount" type="number" min={0} step="0.01" className={inputClass} />
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Order date
          <input name="order_date" type="date" className={inputClass} />
        </label>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50">
          {busy ? "Saving…" : "Raise purchase order"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">
          Cancel
        </button>
      </div>
    </form>
  );
}
