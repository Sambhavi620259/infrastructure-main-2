"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { adjustInventoryStock, listInventory, type InventoryItem } from "@/lib/inventory";

const STOCK_STYLE: Record<string, string> = {
  IN_STOCK: "bg-emerald-50 text-emerald-700",
  LOW_STOCK: "bg-amber-50 text-amber-700",
  OUT_OF_STOCK: "bg-rose-50 text-rose-700",
};

const STOCK_LABEL: Record<string, string> = {
  IN_STOCK: "In stock",
  LOW_STOCK: "Low stock",
  OUT_OF_STOCK: "Out of stock",
};

/** Stock list with issue / receive. Used by the IT Agent and IT Admin workspaces. */
export function StockManager({ eyebrow, addHref }: { eyebrow: string; addHref?: string }) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listInventory({ limit: 500 })
      .then((data) => {
        if (cancelled) return;
        setItems(data);
        setError("");
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load inventory.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter(
      (item) =>
        (!lowOnly || item.status !== "IN_STOCK") &&
        `${item.name} ${item.category} ${item.location ?? ""}`.toLowerCase().includes(needle),
    );
  }, [items, query, lowOnly]);

  const lowCount = items.filter((item) => item.status === "LOW_STOCK").length;
  const outCount = items.filter((item) => item.status === "OUT_OF_STOCK").length;

  return (
    <main className="mx-auto max-w-[1400px] space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold text-brand-600">{eyebrow}</p>
          <h1 className="mt-1 text-2xl font-extrabold">Stock &amp; Consumables</h1>
          <p className="mt-1 text-xs text-slate-500">Issue stock to users and record deliveries. Every change is logged.</p>
        </div>
        {addHref && (
          <Link href={addHref} className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white hover:bg-brand-700">
            Add item
          </Link>
        )}
      </header>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-800">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-3">
        {[
          ["Items", items.length, "text-slate-900"],
          ["Low stock", lowCount, "text-amber-600"],
          ["Out of stock", outCount, "text-rose-600"],
        ].map(([label, value, color]) => (
          <div key={String(label)} className="ui-surface p-4">
            <p className="text-[10px] text-slate-500">{label}</p>
            <p className={`mt-1 text-xl font-extrabold ${color}`}>{loading ? "—" : value}</p>
          </div>
        ))}
      </section>

      <section className="ui-surface overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
          <label className="flex-1">
            <span className="sr-only">Search inventory</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search item, category or location..."
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-xs outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={lowOnly} onChange={(event) => setLowOnly(event.target.checked)} />
            Only low or out of stock
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-400">
              <tr>
                {["Item", "Category", "Location", "Quantity", "Reorder at", "Status", ""].map((heading) => (
                  <th key={heading} className="px-4 py-2 font-bold">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((item) => (
                <StockRow
                  key={item.id}
                  item={item}
                  open={open === item.id}
                  onToggle={() => setOpen(open === item.id ? null : item.id)}
                  onSaved={(updated, change) => {
                    setOpen(null);
                    setNotice(
                      `${change > 0 ? "Received" : "Issued"} ${Math.abs(change)} × ${updated.name}. Now ${updated.quantity} in stock.`,
                    );
                    setRefreshKey((key) => key + 1);
                  }}
                  onError={setError}
                />
              ))}
            </tbody>
          </table>
        </div>
        {!loading && visible.length === 0 && !error && (
          <p className="p-8 text-center text-xs text-slate-500">
            {items.length === 0 ? "No inventory items yet. An IT Admin adds them with Add item." : "No items match."}
          </p>
        )}
      </section>
    </main>
  );
}

function StockRow({
  item,
  open,
  onToggle,
  onSaved,
  onError,
}: {
  item: InventoryItem;
  open: boolean;
  onToggle: () => void;
  onSaved: (item: InventoryItem, change: number) => void;
  onError: (message: string) => void;
}) {
  const [direction, setDirection] = useState<"out" | "in">("out");
  const [amount, setAmount] = useState("1");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const quantity = Number.parseInt(amount, 10);
  const valid = Number.isInteger(quantity) && quantity > 0 && reason.trim().length > 0;

  const save = async () => {
    if (!valid) return;
    const change = direction === "out" ? -quantity : quantity;
    setBusy(true);
    try {
      onSaved(await adjustInventoryStock(item.id, change, reason.trim()), change);
      setReason("");
      setAmount("1");
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Stock update failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <tr className="hover:bg-slate-50">
        <td className="px-4 py-3 font-semibold text-slate-700">{item.name}</td>
        <td className="px-4 py-3 text-slate-600">{item.category}</td>
        <td className="px-4 py-3 text-slate-500">{item.location ?? "—"}</td>
        <td className="px-4 py-3 font-bold text-slate-800">{item.quantity}</td>
        <td className="px-4 py-3 text-slate-500">{item.reorder_level}</td>
        <td className="px-4 py-3">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STOCK_STYLE[item.status] ?? STOCK_STYLE.IN_STOCK}`}>
            {STOCK_LABEL[item.status] ?? item.status}
          </span>
        </td>
        <td className="px-4 py-3 text-right">
          <button type="button" onClick={onToggle} className="font-semibold text-brand-600 hover:text-brand-700">
            {open ? "Close" : "Update stock"}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="bg-slate-50/70">
          <td colSpan={7} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <label>
                <span className="sr-only">Direction</span>
                <select
                  value={direction}
                  onChange={(event) => setDirection(event.target.value as "out" | "in")}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs"
                >
                  <option value="out">Issue (stock out)</option>
                  <option value="in">Receive (stock in)</option>
                </select>
              </label>
              <label>
                <span className="sr-only">Quantity</span>
                <input
                  type="number"
                  min={1}
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                />
              </label>
              <label>
                <span className="sr-only">Reason</span>
                <input
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  maxLength={300}
                  placeholder={direction === "out" ? "Issued to… / for…" : "Delivery / PO number"}
                  className="w-64 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                />
              </label>
              <button
                type="button"
                disabled={busy || !valid}
                onClick={save}
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save"}
              </button>
              {direction === "out" && quantity > item.quantity && (
                <span className="text-[11px] text-rose-600">Only {item.quantity} in stock.</span>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
