"use client";

import { useEffect, useMemo, useState } from "react";
import { adjustInventoryStock, createInventory, listInventory, requestInventory, type InventoryItem } from "@/lib/inventory";
import { listUserDirectory, type DirectoryEntry } from "@/lib/users";
import { InventoryRequests } from "@/components/inventory/inventory-requests";

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

/**
 * Stock list. Admins (canManage) add items, receive and issue stock, and
 * approve users' requests; users pick an item and request it.
 */
export function StockManager({
  eyebrow,
  canManage = false,
}: {
  eyebrow: string;
  canManage?: boolean;
}) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [adding, setAdding] = useState(false);
  const [people, setPeople] = useState<DirectoryEntry[]>([]);

  // Consumables are given to ordinary users only.
  useEffect(() => {
    if (canManage) listUserDirectory({ onlyUsers: true }).then(setPeople).catch(() => setPeople([]));
  }, [canManage]);

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
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load consumables.");
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
          <h1 className="mt-1 text-2xl font-extrabold">Consumables</h1>
          <p className="mt-1 text-xs text-slate-500">
            {canManage
              ? "Add consumables, give them to users and record deliveries. Every change is logged."
              : "Pick an item and request it. Your IT Admin approves and gives it to you."}
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setAdding((value) => !value)}
            aria-expanded={adding}
            className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white hover:bg-brand-700"
          >
            {adding ? "Close" : "+ Add consumable"}
          </button>
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

      {canManage && adding && (
        <AddConsumable
          onAdded={(name) => {
            setAdding(false);
            setNotice(`${name} added to consumables.`);
            setError("");
            setRefreshKey((key) => key + 1);
          }}
          onError={setError}
        />
      )}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[
          ["Consumables", items.length, "text-slate-900"],
          ["Low stock", lowCount, "text-amber-600"],
          ["Out of stock", outCount, "text-rose-600"],
        ].map(([label, value, color]) => (
          <div key={String(label)} className="ui-surface p-4">
            <p className="text-[10px] text-slate-500">{label}</p>
            <p className={`mt-1 text-xl font-extrabold ${color}`}>{loading ? "—" : value}</p>
          </div>
        ))}
      </section>

      <InventoryRequests
        admin={canManage}
        refreshKey={refreshKey}
        onChanged={(message) => {
          setNotice(message);
          setError("");
          setRefreshKey((key) => key + 1);
        }}
      />

      <section className="ui-surface overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
          <label className="flex-1">
            <span className="sr-only">Search consumables</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search consumable, category or location..."
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
                {["Consumable", "Category", "Location", "In stock", "Reorder at", "Status", ""].map((heading) => (
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
                  canManage={canManage}
                  people={people}
                  open={open === item.id}
                  onToggle={() => setOpen(open === item.id ? null : item.id)}
                  onRequested={(quantity) => {
                    setOpen(null);
                    setNotice(`Requested ${quantity} × ${item.name}. Your IT Admin has been notified.`);
                    setError("");
                    setRefreshKey((key) => key + 1);
                  }}
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
            {items.length === 0 ? "No consumables yet. Use + Add consumable to add the first one." : "No consumables match."}
          </p>
        )}
      </section>
    </main>
  );
}

function StockRow({
  item,
  canManage,
  people,
  open,
  onToggle,
  onRequested,
  onSaved,
  onError,
}: {
  item: InventoryItem;
  canManage: boolean;
  people: DirectoryEntry[];
  open: boolean;
  onToggle: () => void;
  onRequested: (quantity: number) => void;
  onSaved: (item: InventoryItem, change: number) => void;
  onError: (message: string) => void;
}) {
  const [direction, setDirection] = useState<"out" | "in">("out");
  const [amount, setAmount] = useState("1");
  const [reason, setReason] = useState("");
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);

  const quantity = Number.parseInt(amount, 10);
  const giving = canManage && direction === "out";
  // Giving needs a user; receiving and requesting need a reason.
  const valid = Number.isInteger(quantity) && quantity > 0 && (giving ? recipient !== "" : reason.trim().length > 0);

  const save = async () => {
    if (!valid) return;
    const change = direction === "out" ? -quantity : quantity;
    setBusy(true);
    try {
      if (!canManage) {
        await requestInventory(item.id, quantity, reason.trim());
        onRequested(quantity);
        setReason("");
        setAmount("1");
        return;
      }
      const who = people.find((person) => person.id === recipient)?.full_name;
      const note = giving ? `Given to ${who ?? "a user"}${reason.trim() ? `: ${reason.trim()}` : ""}` : reason.trim();
      onSaved(await adjustInventoryStock(item.id, change, note), change);
      setReason("");
      setRecipient("");
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
            {open ? "Close" : canManage ? "Give / receive" : "Request"}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="bg-slate-50/70">
          <td colSpan={7} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              {canManage ? (
                <label>
                  <span className="sr-only">Direction</span>
                  <select
                    value={direction}
                    onChange={(event) => setDirection(event.target.value as "out" | "in")}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs"
                  >
                    <option value="out">Give to a user</option>
                    <option value="in">Receive more</option>
                  </select>
                </label>
              ) : (
                <span className="text-[11px] font-semibold text-slate-600">Request {item.name}:</span>
              )}
              {giving && (
                <label>
                  <span className="sr-only">Give to</span>
                  <select
                    value={recipient}
                    onChange={(event) => setRecipient(event.target.value)}
                    className="w-56 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs"
                  >
                    <option value="">{people.length === 0 ? "No users yet" : "Choose a user…"}</option>
                    {people.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.full_name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
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
                <span className="sr-only">{giving ? "Note" : "Reason"}</span>
                <input
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  maxLength={300}
                  placeholder={!canManage ? "What is it for?" : direction === "out" ? "Note (optional)" : "Delivery / PO number"}
                  className="w-64 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                />
              </label>
              <button
                type="button"
                disabled={busy || !valid}
                onClick={save}
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {busy ? "Saving…" : !canManage ? "Send request" : direction === "out" ? "Give" : "Receive"}
              </button>
              {direction === "out" && quantity > item.quantity && (
                <span className="text-[11px] text-rose-600">
                  Only {item.quantity} in stock{canManage ? "." : "; your IT Admin can approve once more arrives."}
                </span>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/** Add a consumable, in the same style as adding an asset. */
function AddConsumable({ onAdded, onError }: { onAdded: (name: string) => void; onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const field = "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500";

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? "").trim();
    setBusy(true);
    try {
      const item = await createInventory({
        name: text("name"),
        category: text("category"),
        quantity: Number(text("quantity")) || 0,
        reorder_level: Number(text("reorder_level")) || 0,
        unit_cost: Number(text("unit_cost")) || undefined,
        location: text("location") || undefined,
      });
      onAdded(item.name);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Unable to add the consumable.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="ui-surface grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
      <label className="text-xs font-bold text-slate-700">
        Name <span className="text-rose-500">*</span>
        <input required name="name" maxLength={150} placeholder="e.g. USB-C cable" className={field} />
      </label>
      <label className="text-xs font-bold text-slate-700">
        Category <span className="text-rose-500">*</span>
        <input required name="category" maxLength={100} placeholder="e.g. Cables" className={field} />
      </label>
      <label className="text-xs font-bold text-slate-700">
        Quantity in stock
        <input type="number" name="quantity" min={0} defaultValue={0} className={field} />
      </label>
      <label className="text-xs font-bold text-slate-700">
        Reorder at
        <input type="number" name="reorder_level" min={0} defaultValue={5} className={field} />
      </label>
      <label className="text-xs font-bold text-slate-700">
        Unit cost <span className="font-normal text-slate-400">(optional)</span>
        <input type="number" name="unit_cost" min={0} step="0.01" className={field} />
      </label>
      <label className="text-xs font-bold text-slate-700">
        Location <span className="font-normal text-slate-400">(optional)</span>
        <input name="location" maxLength={100} placeholder="e.g. Bengaluru store" className={field} />
      </label>
      <div className="sm:col-span-2 lg:col-span-3">
        <button type="submit" disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-60">
          {busy ? "Adding…" : "Add consumable"}
        </button>
      </div>
    </form>
  );
}
