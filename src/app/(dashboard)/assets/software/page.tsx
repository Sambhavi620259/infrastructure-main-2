"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { PlusIcon } from "@heroicons/react/24/outline";
import {
  LICENSE_TYPES,
  addLicense,
  assignLicense,
  getSoftware,
  licenseTypeLabel,
  listSoftware,
  releaseSeat,
  updateLicense,
  type Software,
  type SoftwareDetail,
  type SoftwareLicense,
} from "@/lib/software";
import { listAssets } from "@/lib/assets";
import { listUserDirectory, type DirectoryEntry } from "@/lib/users";
import { assetLabel, formatDate, type Asset } from "@/types/asset";

function Utilization({ used, total }: { used: number; total: number }) {
  const pct = total ? Math.min(100, Math.round((used / total) * 100)) : 0;
  return (
    <div className="w-28">
      <div className="h-1.5 rounded-full bg-slate-100">
        <div className={`h-1.5 rounded-full ${pct >= 90 ? "bg-rose-500" : pct >= 70 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-slate-500">
        {used} of {total} seats ({pct}%)
      </p>
    </div>
  );
}

/** Software products, their license entitlements and who holds a seat. */
export default function SoftwareAssetsPage() {
  const [products, setProducts] = useState<Software[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<SoftwareDetail | null>(null);
  const [users, setUsers] = useState<DirectoryEntry[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

  const loadProducts = useCallback(() => {
    listSoftware()
      .then((data) => {
        setProducts(data);
        setError("");
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load software."))
      .finally(() => setLoading(false));
  }, []);

  const loadDetail = useCallback((id: string) => {
    getSoftware(id)
      .then(setDetail)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load this product."));
  }, []);

  useEffect(() => {
    loadProducts();
    listUserDirectory().then(setUsers).catch(() => undefined);
    const fromUrl = new URLSearchParams(window.location.search).get("product");
    if (fromUrl) setSelected(fromUrl);
  }, [loadProducts]);

  useEffect(() => {
    if (selected) loadDetail(selected);
    else setDetail(null);
  }, [selected, loadDetail]);

  const changed = (message: string) => {
    setNotice(message);
    setError("");
    loadProducts();
    if (selected) loadDetail(selected);
  };

  const visible = products.filter((p) =>
    `${p.name} ${p.vendor ?? ""} ${p.version ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const seats = products.reduce((sum, p) => sum + p.total_licenses, 0);
  const used = products.reduce((sum, p) => sum + p.used_licenses, 0);

  return (
    <main className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-brand-600">Assets · Software</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">Software Assets</h1>
          <p className="mt-1 text-sm text-slate-500">
            Products, the licenses bought for them, and who holds a seat. Seats are given on approved requests or directly here.
          </p>
        </div>
        <Link href="/assets/software/new" className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700">
          <PlusIcon className="h-4 w-4" aria-hidden="true" /> Add software
        </Link>
      </header>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
      {notice && (
        <div role="status" className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")} aria-label="Dismiss">×</button>
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Products", products.length, "text-slate-900"],
          ["Seats purchased", seats, "text-slate-900"],
          ["Seats assigned", used, "text-blue-600"],
          ["Seats available", Math.max(seats - used, 0), "text-emerald-600"],
        ].map(([label, value, color]) => (
          <div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold text-slate-500">{label}</p>
            <p className={`mt-1 text-2xl font-extrabold ${color}`}>{loading ? "—" : value}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-4">
            <label>
              <span className="sr-only">Search software</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search name, publisher or version"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-brand-500"
              />
            </label>
          </div>
          {visible.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-500">
              {products.length === 0 ? "No software yet. Register one with Register software." : "No products match."}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {visible.map((product) => (
                <li key={product.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(product.id)}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 ${selected === product.id ? "bg-brand-50/60" : ""}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-800">{product.name}</span>
                      <span className="block truncate text-xs text-slate-500">
                        {[product.vendor, product.version].filter(Boolean).join(" · ") || "—"} · {product.license_count} license
                        {product.license_count === 1 ? "" : "s"}
                      </span>
                    </span>
                    <Utilization used={product.used_licenses} total={product.total_licenses} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </article>

        {detail ? (
          <ProductPanel detail={detail} users={users} onChanged={changed} onError={setError} />
        ) : (
          <article className="grid place-items-center rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
            Choose a product to see its licenses and seats.
          </article>
        )}
      </section>
    </main>
  );
}

function ProductPanel({
  detail,
  users,
  onChanged,
  onError,
}: {
  detail: SoftwareDetail;
  users: DirectoryEntry[];
  onChanged: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [addingLicense, setAddingLicense] = useState(false);
  const [userId, setUserId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [devices, setDevices] = useState<Asset[]>([]);
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    setDeviceId("");
    if (!userId) return setDevices([]);
    listAssets({ assigned_to: userId, limit: 100 }).then(setDevices).catch(() => setDevices([]));
  }, [userId]);

  const active = detail.seats.filter((seat) => seat.is_active);
  const history = detail.seats.filter((seat) => !seat.is_active);
  const holders = new Set(active.map((seat) => seat.user_id));

  const assign = async (event: FormEvent) => {
    event.preventDefault();
    if (!userId) return;
    setBusy(true);
    try {
      await assignLicense(detail.id, userId, { asset_id: deviceId || undefined });
      const name = users.find((u) => u.id === userId)?.full_name ?? "the user";
      setUserId("");
      onChanged(`${name} now has a seat of ${detail.name}.`);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Could not assign a seat.");
    } finally {
      setBusy(false);
    }
  };

  const release = async (seatId: string, name: string | null) => {
    setBusy(true);
    try {
      await releaseSeat(seatId);
      onChanged(`Seat released from ${name ?? "the user"}; it is available again.`);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Could not release the seat.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-extrabold text-slate-900">{detail.name}</h2>
            <p className="text-sm text-slate-500">{[detail.vendor, detail.version].filter(Boolean).join(" · ") || "No publisher recorded"}</p>
          </div>
          <Utilization used={detail.used_licenses} total={detail.total_licenses} />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h3 className="text-sm font-bold text-slate-900">Licenses ({detail.licenses.length})</h3>
          <button type="button" onClick={() => setAddingLicense(true)} disabled={addingLicense} className="text-xs font-bold text-brand-600 hover:text-brand-700 disabled:opacity-50">
            + Add license
          </button>
        </div>
        {addingLicense && (
          <LicenseForm
            onCancel={() => setAddingLicense(false)}
            onSave={async (input) => {
              await addLicense(detail.id, input);
              setAddingLicense(false);
              onChanged(`${input.seats} more seat${input.seats === 1 ? "" : "s"} of ${detail.name} recorded.`);
            }}
          />
        )}
        {detail.licenses.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-500">No licenses yet. Add one to have seats to assign.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {detail.licenses.map((license) => (
              <LicenseRow key={license.id} license={license} onChanged={onChanged} onError={onError} />
            ))}
          </ul>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-3">
          <h3 className="text-sm font-bold text-slate-900">Seats in use ({active.length})</h3>
        </div>
        <form onSubmit={assign} className="flex flex-wrap items-end gap-2 border-b border-slate-100 bg-slate-50/60 px-5 py-3">
          <label className="text-xs font-semibold text-slate-600">
            Give a seat to
            <select value={userId} onChange={(event) => setUserId(event.target.value)} className="mt-1 block w-52 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm">
              <option value="">Choose a user…</option>
              {users.filter((u) => !holders.has(u.id)).map((u) => (
                <option key={u.id} value={u.id}>{u.full_name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">
            On device <span className="font-normal text-slate-400">(optional)</span>
            <select value={deviceId} onChange={(event) => setDeviceId(event.target.value)} disabled={!userId} className="mt-1 block w-48 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm disabled:opacity-50">
              <option value="">Any / not recorded</option>
              {devices.map((asset) => (
                <option key={asset.id} value={asset.id}>{assetLabel(asset)} · {asset.name}</option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={busy || !userId || detail.available_licenses < 1} className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-50">
            Assign seat
          </button>
          {detail.available_licenses < 1 && <span className="text-xs font-semibold text-rose-600">No seats available</span>}
        </form>
        {active.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-500">Nobody holds a seat yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {active.map((seat) => (
              <li key={seat.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <span className="min-w-0">
                  <span className="block font-semibold text-slate-800">{seat.user_name}</span>
                  <span className="block text-xs text-slate-500">
                    Since {formatDate(seat.assigned_at)}
                    {seat.asset_label ? ` · on ${seat.asset_label}` : ""}
                    {seat.assigned_by_name ? ` · by ${seat.assigned_by_name}` : ""}
                  </span>
                </span>
                <button type="button" disabled={busy} onClick={() => release(seat.id, seat.user_name)} className="text-xs font-bold text-rose-600 hover:text-rose-700 disabled:opacity-50">
                  Release
                </button>
              </li>
            ))}
          </ul>
        )}
        {history.length > 0 && (
          <div className="border-t border-slate-100 px-5 py-3">
            <button type="button" onClick={() => setShowHistory((open) => !open)} className="text-xs font-semibold text-slate-600">
              {showHistory ? "Hide" : "Show"} released seats ({history.length})
            </button>
            {showHistory && (
              <ul className="mt-2 space-y-1 text-xs text-slate-500">
                {history.map((seat) => (
                  <li key={seat.id}>
                    {seat.user_name}: {formatDate(seat.assigned_at)} – {formatDate(seat.released_at)}
                    {seat.released_by_name ? ` (released by ${seat.released_by_name})` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function LicenseRow({ license, onChanged, onError }: { license: SoftwareLicense; onChanged: (m: string) => void; onError: (m: string) => void }) {
  const [editing, setEditing] = useState(false);
  const expired = license.expiry_date && new Date(license.expiry_date) < new Date();
  return (
    <li className="px-5 py-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-slate-800">
            {licenseTypeLabel(license.license_type)} · {license.seats} seat{license.seats === 1 ? "" : "s"}
            {license.status !== "ACTIVE" && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">{license.status}</span>}
            {expired && <span className="ml-2 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">Expired</span>}
          </p>
          <p className="font-mono text-xs text-slate-600">{license.license_number ?? "No license number"}</p>
          <p className="text-xs text-slate-500">
            {license.assigned} assigned · {license.available} available
            {license.purchase_date ? ` · bought ${formatDate(license.purchase_date)}` : ""}
            {license.expiry_date ? ` · expires ${formatDate(license.expiry_date)}` : ""}
            {license.renewal_date ? ` · renewal ${formatDate(license.renewal_date)}` : ""}
          </p>
        </div>
        <button type="button" onClick={() => setEditing((open) => !open)} className="text-xs font-bold text-brand-600 hover:text-brand-700">
          {editing ? "Close" : "Edit / renew"}
        </button>
      </div>
      {editing && (
        <LicenseForm
          license={license}
          onCancel={() => setEditing(false)}
          onSave={async (input) => {
            try {
              await updateLicense(license.id, input);
              setEditing(false);
              onChanged("License updated.");
            } catch (caught) {
              onError(caught instanceof Error ? caught.message : "Could not update the license.");
            }
          }}
        />
      )}
    </li>
  );
}

function LicenseForm({
  license,
  onSave,
  onCancel,
}: {
  license?: SoftwareLicense;
  onSave: (input: { license_type: string; license_number?: string; seats: number; purchase_date?: string; expiry_date?: string; renewal_date?: string; cost?: number }) => Promise<void>;
  onCancel: () => void;
}) {
  const day = (value: string | null | undefined) => (value ? value.slice(0, 10) : "");
  const [type, setType] = useState(license?.license_type ?? "SUBSCRIPTION");
  const [number, setNumber] = useState(license?.license_number ?? "");
  const [seats, setSeats] = useState(license ? String(license.seats) : "");
  const [purchase, setPurchase] = useState(day(license?.purchase_date));
  const [expiry, setExpiry] = useState(day(license?.expiry_date));
  const [renewal, setRenewal] = useState(day(license?.renewal_date));
  const [cost, setCost] = useState(license ? String(Number(license.cost) || "") : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^\d+$/.test(seats) || Number(seats) < 1) return setError("License count must be a whole number of at least 1.");
    setBusy(true);
    setError("");
    const date = (value: string) => (value ? `${value}T00:00:00` : undefined);
    try {
      await onSave({
        license_type: type, license_number: number.trim() || undefined, seats: Number(seats),
        purchase_date: date(purchase), expiry_date: date(expiry), renewal_date: date(renewal),
        cost: cost ? Number(cost) : undefined,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  const input = "mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm font-normal";
  return (
    <form onSubmit={submit} className="mt-3 grid gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-xs font-semibold text-slate-600 sm:grid-cols-3" noValidate>
      <label>License type
        <select value={type} onChange={(e) => setType(e.target.value)} className={input}>
          {LICENSE_TYPES.map((t) => <option key={t} value={t}>{licenseTypeLabel(t)}</option>)}
        </select>
      </label>
      <label>License Number
        <input value={number} onChange={(e) => setNumber(e.target.value)} maxLength={255} autoComplete="off" className={`${input} font-mono`} />
      </label>
      <label>License Count
        <input type="number" min={1} step={1} value={seats} onChange={(e) => setSeats(e.target.value)} className={input} />
      </label>
      <label>Purchase date<input type="date" value={purchase} onChange={(e) => setPurchase(e.target.value)} className={input} /></label>
      <label>Expiry date<input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className={input} /></label>
      <label>Renewal date<input type="date" value={renewal} onChange={(e) => setRenewal(e.target.value)} className={input} /></label>
      <label>Cost<input type="number" min={0} step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} className={input} /></label>
      {error && <p role="alert" className="text-red-700 sm:col-span-3">{error}</p>}
      <div className="flex items-end gap-2 sm:col-span-2">
        <button type="submit" disabled={busy} className="rounded-lg bg-brand-600 px-3 py-2 font-bold text-white hover:bg-brand-700 disabled:opacity-50">
          {busy ? "Saving…" : license ? "Save license" : "Add license"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 px-3 py-2 text-slate-700">Cancel</button>
      </div>
    </form>
  );
}
