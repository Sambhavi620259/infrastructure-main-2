"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import PurchaseOrdersPage from "@/app/(dashboard)/inventory/purchase-orders/page";
import VendorsPage from "@/app/(dashboard)/inventory/vendors/page";
import { StockManager } from "@/components/inventory/stock-manager";
import { listAssets } from "@/lib/assets";
import {
  MOVEMENT_TYPES,
  listInventory,
  listMovements,
  newReference,
  recordMovement,
  type InventoryItem,
  type MovementInput,
  type StockMovement,
} from "@/lib/inventory";
import { listPurchaseOrders, type PurchaseOrder } from "@/lib/procurement";
import { assetLabel, type Asset } from "@/types/asset";

const PAGE_SIZE = 25;

const TYPE_STYLE: Record<string, string> = {
  RECEIPT: "bg-emerald-50 text-emerald-700",
  REGISTER: "bg-violet-50 text-violet-700",
  ASSIGN: "bg-blue-50 text-blue-700",
  RETURN: "bg-sky-50 text-sky-700",
  TRANSFER: "bg-slate-100 text-slate-700",
  ISSUE: "bg-amber-50 text-amber-700",
  ADJUSTMENT: "bg-orange-50 text-orange-700",
  REPAIR: "bg-rose-50 text-rose-700",
  RETIRE: "bg-slate-100 text-slate-500",
};

function label(type: string) {
  return type.charAt(0) + type.slice(1).toLowerCase();
}

type Tab = "movements" | "consumables" | "orders" | "vendors";
const TABS: readonly [Tab, string][] = [
  ["movements", "Stock movements"],
  ["consumables", "Consumables"],
  ["orders", "Purchase orders"],
  ["vendors", "Vendors"],
];

/** Purchasing and stock in one place: the movement ledger, consumable stock, purchase orders and vendors. */
export default function MovementsPage() {
  const [tab, setTab] = useState<Tab>("movements");

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("tab");
    if (TABS.some(([value]) => value === fromUrl)) setTab(fromUrl as Tab);
  }, []);

  return (
    <div className="space-y-4">
      <div className="mx-auto flex max-w-7xl flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1 text-sm font-semibold shadow-sm sm:w-fit">
        {TABS.map(([value, text]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            aria-pressed={tab === value}
            className={`flex-1 rounded-lg px-4 py-2 sm:flex-none ${tab === value ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
          >
            {text}
          </button>
        ))}
      </div>
      {tab === "movements" && <MovementLedger />}
      {tab === "consumables" && <StockManager eyebrow="Inventory · Consumables" addHref="/inventory/new" canManage />}
      {tab === "orders" && <PurchaseOrdersPage />}
      {tab === "vendors" && <VendorsPage />}
    </div>
  );
}

function MovementLedger() {
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [type, setType] = useState("");
  const [kind, setKind] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    listMovements({ movement_type: type || undefined, item_kind: kind || undefined, skip: page * PAGE_SIZE, limit: PAGE_SIZE })
      .then((data) => {
        setMovements(data);
        setError("");
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load stock movements."))
      .finally(() => setLoading(false));
  }, [type, kind, page]);

  useEffect(load, [load]);

  return (
    <main className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-brand-600">Inventory · Purchase &amp; Stock Movements</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">Stock movements</h1>
          <p className="mt-1 text-sm text-slate-500">
            Every receipt, registration, assignment, return, transfer, issue and adjustment, newest first. Stock never goes below zero.
          </p>
        </div>
        <button type="button" onClick={() => setRecording(true)} disabled={recording} className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700 disabled:opacity-60">
          Record movement
        </button>
      </header>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
      {notice && (
        <div role="status" className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")} aria-label="Dismiss">×</button>
        </div>
      )}

      {recording && (
        <MovementForm
          onCancel={() => setRecording(false)}
          onSaved={(movement) => {
            setRecording(false);
            setNotice(`${label(movement.movement_type)} recorded.`);
            setPage(0);
            load();
          }}
        />
      )}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <label className="text-xs font-semibold text-slate-600">
            Type
            <select value={type} onChange={(e) => { setType(e.target.value); setPage(0); }} className="ml-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm">
              <option value="">All</option>
              {MOVEMENT_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Items
            <select value={kind} onChange={(e) => { setKind(e.target.value); setPage(0); }} className="ml-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm">
              <option value="">Hardware and consumables</option>
              <option value="HARDWARE">Hardware</option>
              <option value="CONSUMABLE">Consumables</option>
            </select>
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                {["When", "Type", "Item", "Qty", "From → to", "Reason", "PO", "By"].map((h) => (
                  <th key={h} className="px-4 py-2.5 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {movements.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                    {m.created_at ? new Date(m.created_at).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${TYPE_STYLE[m.movement_type] ?? "bg-slate-100 text-slate-700"}`}>{label(m.movement_type)}</span>
                  </td>
                  <td className="px-4 py-3 font-semibold text-slate-800">
                    {m.asset_label ?? m.item_name ?? (m.item_kind === "HARDWARE" ? "Hardware" : "—")}
                    <span className="block text-[11px] font-normal text-slate-400">{m.item_kind === "HARDWARE" ? "Hardware" : "Consumable"}</span>
                  </td>
                  <td className={`px-4 py-3 font-semibold ${m.quantity < 0 ? "text-rose-600" : "text-slate-800"}`}>{m.quantity > 0 && m.item_kind === "CONSUMABLE" ? `+${m.quantity}` : m.quantity}</td>
                  <td className="px-4 py-3 text-slate-600">{m.from_location || m.to_location ? `${m.from_location ?? "—"} → ${m.to_location ?? "—"}` : "—"}</td>
                  <td className="max-w-xs px-4 py-3 text-slate-600">{m.reason ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{m.po_number ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{m.performed_by_name ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && movements.length === 0 && <p className="p-8 text-center text-sm text-slate-500">No stock movements{type || kind ? " match" : " yet"}.</p>}
        <footer className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
          <span>Page {page + 1}</span>
          <span className="space-x-2">
            <button type="button" disabled={page === 0 || loading} onClick={() => setPage((p) => p - 1)} className="rounded-md border border-slate-200 px-3 py-1 disabled:opacity-50">Previous</button>
            <button type="button" disabled={movements.length < PAGE_SIZE || loading} onClick={() => setPage((p) => p + 1)} className="rounded-md border border-slate-200 px-3 py-1 disabled:opacity-50">Next</button>
          </span>
        </footer>
      </section>
    </main>
  );
}

function MovementForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: (m: StockMovement) => void }) {
  const [kind, setKind] = useState<"CONSUMABLE" | "HARDWARE">("CONSUMABLE");
  const [type, setType] = useState<MovementInput["movement_type"]>("RECEIPT");
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [target, setTarget] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [location, setLocation] = useState("");
  const [poId, setPoId] = useState("");
  const [reason, setReason] = useState("");
  const [reference] = useState(newReference);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    listInventory({ limit: 500 }).then(setItems).catch(() => undefined);
    listAssets({ limit: 500 }).then(setAssets).catch(() => undefined);
    Promise.all([listPurchaseOrders("ORDERED"), listPurchaseOrders("RECEIVED")])
      .then(([a, b]) => setOrders([...a, ...b]))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    setTarget("");
    if (kind === "HARDWARE") setType("TRANSFER");
  }, [kind]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!target) return setError(kind === "HARDWARE" ? "Choose the device." : "Choose the item.");
    if (!reason.trim()) return setError("Give a reason.");
    if (type === "TRANSFER" && !location.trim()) return setError("Give the new location.");
    const qty = Number(quantity);
    if (type !== "TRANSFER" && (!Number.isInteger(qty) || qty === 0 || (type !== "ADJUSTMENT" && qty < 0))) {
      return setError(type === "ADJUSTMENT" ? "An adjustment is a whole number, positive or negative, not zero." : "Quantity must be a whole number of at least 1.");
    }
    setBusy(true);
    setError("");
    try {
      onSaved(
        await recordMovement({
          movement_type: type,
          item_kind: kind,
          asset_id: kind === "HARDWARE" ? target : undefined,
          inventory_item_id: kind === "CONSUMABLE" ? target : undefined,
          quantity: type === "TRANSFER" ? undefined : qty,
          to_location: type === "TRANSFER" ? location.trim() : undefined,
          purchase_order_id: poId || undefined,
          reason: reason.trim(),
          reference,
        }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not record the movement.");
    } finally {
      setBusy(false);
    }
  };

  const input = "mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal";
  const lbl = "block text-xs font-bold text-slate-700";
  const types: MovementInput["movement_type"][] = kind === "HARDWARE" ? ["TRANSFER"] : ["RECEIPT", "ISSUE", "RETURN", "ADJUSTMENT", "TRANSFER"];
  return (
    <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" noValidate>
      <h2 className="text-sm font-extrabold text-slate-900">Record a stock movement</h2>
      <p className="text-xs text-slate-500">
        Devices are received on Hardware Stock and assigned or returned through requests and assignments; here you can move them between locations.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className={lbl}>Items
          <select value={kind} onChange={(e) => setKind(e.target.value as "CONSUMABLE" | "HARDWARE")} className={input}>
            <option value="CONSUMABLE">Consumables</option>
            <option value="HARDWARE">A hardware device</option>
          </select>
        </label>
        <label className={lbl}>Movement
          <select value={type} onChange={(e) => setType(e.target.value as MovementInput["movement_type"])} className={input}>
            {types.map((t) => <option key={t} value={t}>{label(t)}</option>)}
          </select>
        </label>
        <label className={lbl}>{kind === "HARDWARE" ? "Device" : "Item"}
          <select value={target} onChange={(e) => setTarget(e.target.value)} className={input}>
            <option value="">Choose…</option>
            {kind === "HARDWARE"
              ? assets.map((a) => <option key={a.id} value={a.id}>{assetLabel(a)} · {a.name}{a.location_id ? ` (${a.location_id})` : ""}</option>)
              : items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.quantity} in stock)</option>)}
          </select>
        </label>
        {type === "TRANSFER" ? (
          <label className={lbl}>New location<input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={100} className={input} /></label>
        ) : (
          <label className={lbl}>{type === "ADJUSTMENT" ? "Change (+ or −)" : "Quantity"}
            <input type="number" step={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} className={input} />
          </label>
        )}
        {type === "RECEIPT" && (
          <label className={lbl}>Purchase order
            <select value={poId} onChange={(e) => setPoId(e.target.value)} className={input}>
              <option value="">Not linked</option>
              {orders.map((po) => <option key={po.id} value={po.id}>{po.po_number}</option>)}
            </select>
          </label>
        )}
        <label className={`${lbl} sm:col-span-2 lg:col-span-1`}>Reason *<input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className={input} /></label>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50">{busy ? "Saving…" : "Record"}</button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">Cancel</button>
      </div>
    </form>
  );
}
