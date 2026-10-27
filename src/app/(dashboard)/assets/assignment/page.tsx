"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { assignAsset, listAssets, unassignAsset } from "@/lib/assets";
import { listUsers } from "@/lib/users";
import { assetStatusLabel, assetStatusStyle, type Asset, assetLabel } from "@/types/asset";
import type { AppUser } from "@/types/user";
import { assignLicense, listSeats, listSoftware, releaseSeat, type Software, type SoftwareSeat } from "@/lib/software";

export default function AssetAssignmentPage() {
  const [assignable, setAssignable] = useState<Asset[]>([]);
  const [software, setSoftware] = useState<Software[]>([]);
  const [seats, setSeats] = useState<SoftwareSeat[]>([]);
  const [choice, setChoice] = useState("");
  const [person, setPerson] = useState("");
  const [assigned, setAssigned] = useState<Asset[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    // The list endpoint takes one status at a time, so each status is its own call.
    Promise.all([
      listAssets({ status: "IN_STOCK", limit: 200 }),
      listAssets({ status: "ASSIGNED", limit: 200 }),
      listAssets({ status: "IN_USE", limit: 200 }),
      listAssets({ status: "RETURN_REQUESTED", limit: 200 }),
      listUsers({ limit: 200 }),
      listSoftware().catch(() => [] as Software[]),
      listSeats({ active: true }).catch(() => [] as SoftwareSeat[]),
    ])
      .then(([inStock, assignedNow, inUse, returning, people, products, activeSeats]) => {
        setSeats(activeSeats);
        setAssignable(inStock);
        // Software with seats left can be handed out here too.
        setSoftware(products.filter((product) => product.available_licenses > 0));
        setAssigned([...assignedNow, ...inUse, ...returning]);
        // Devices are held by ordinary users only.
        setUsers(people.filter((user) => user.status.toUpperCase() === "ACTIVE" && user.role === "EMPLOYEE"));
        setError("");
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "Unable to load assignment data.");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const assetId = choice;
    const userId = person;
    if (!assetId || !userId) return;

    setBusyId(assetId);
    setError("");
    try {
      const person = users.find((user) => user.id === userId)?.full_name ?? "the selected user";
      if (assetId.startsWith("sw:")) {
        await assignLicense(assetId.slice(3), userId);
        setNotice(`${software.find((product) => product.id === assetId.slice(3))?.name ?? "Software"} seat given to ${person}.`);
      } else {
        const updated = await assignAsset(assetId, userId);
        setNotice(`${updated.name} assigned to ${updated.assigned_to_name ?? person}.`);
      }
      setChoice("");
      setPerson("");
      load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to assign this asset.");
    } finally {
      setBusyId("");
    }
  };

  const release = async (asset: Asset) => {
    setBusyId(asset.id);
    setError("");
    try {
      await unassignAsset(asset.id);
      setNotice(`${asset.name} returned to stock.`);
      load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to unassign this asset.");
    } finally {
      setBusyId("");
    }
  };

  // A person holds one seat of a product, so those who already have it are not offered again.
  const isSoftware = choice.startsWith("sw:");
  const holders = new Set(isSoftware ? seats.filter((seat) => seat.software_id === choice.slice(3)).map((seat) => seat.user_id) : []);
  const eligible = users.filter((user) => !holders.has(user.id));

  return (
    <main className="mx-auto max-w-7xl space-y-5">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-wider text-brand-600">
          Assets · Assignment
        </p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">Asset Assignment</h1>
        <p className="mt-1 text-sm text-slate-500">Hand hardware or a software seat to a user, or take a device back into stock.</p>
      </header>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="flex items-center justify-between gap-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
        >
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")} className="font-bold" aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-extrabold text-slate-900">Assign an asset</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Hardware in stock and software with seats left can be assigned, and only to users. {assignable.length + software.length} available.
          </p>
        </div>

        <form onSubmit={submit} className="grid gap-5 p-5 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <label className="text-xs font-bold text-slate-700">
            Asset
            <select
              required
              name="asset_id"
              value={choice}
              onChange={(event) => {
                setChoice(event.target.value);
                setPerson("");
              }}
              disabled={assignable.length + software.length === 0}
              className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-500 disabled:bg-slate-50"
            >
              <option value="" disabled>
                {assignable.length + software.length === 0 ? "Nothing available to assign" : "Select an asset"}
              </option>
              {assignable.length > 0 && (
                <optgroup label="Hardware">
                  {assignable.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.name} · {assetLabel(asset)}
                    </option>
                  ))}
                </optgroup>
              )}
              {software.length > 0 && (
                <optgroup label="Software">
                  {software.map((product) => (
                    <option key={product.id} value={`sw:${product.id}`}>
                      {product.name} · {product.available_licenses} seats left
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>

          <label className="text-xs font-bold text-slate-700">
            Assign to
            <select
              required
              name="user_id"
              value={person}
              onChange={(event) => setPerson(event.target.value)}
              disabled={users.length === 0}
              className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-500 disabled:bg-slate-50"
            >
              <option value="" disabled>
                {users.length === 0 ? "No active users" : eligible.length === 0 ? "Everyone already has this seat" : "Select a person"}
              </option>
              {users.map((user) => (
                <option key={user.id} value={user.id} disabled={holders.has(user.id)}>
                  {user.full_name} · {user.email}
                  {holders.has(user.id) ? " (already has this seat)" : ""}
                </option>
              ))}
            </select>
            {isSoftware && holders.size > 0 && (
              <span className="mt-1 block text-[11px] font-normal text-slate-500">
                {holders.size} {holders.size === 1 ? "user already has" : "users already have"} a seat of this software and
                can&rsquo;t be given another. Release their seat below to reassign it.
              </span>
            )}
          </label>

          <button
            type="submit"
            disabled={loading || busyId !== "" || assignable.length + software.length === 0 || eligible.length === 0}
            className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busyId ? "Working…" : isSoftware ? "Assign seat" : "Assign asset"}
          </button>
        </form>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-extrabold text-slate-900">Currently assigned</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {loading
              ? "Loading…"
              : `${assigned.length} device${assigned.length === 1 ? "" : "s"} out with someone`}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[720px] w-full text-left">
            <thead className="bg-blue-50/70 text-[11px] font-bold text-slate-600">
              <tr>
                <th className="px-5 py-3">Asset</th>
                <th className="px-5 py-3">Holder</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {assigned.map((asset) => (
                <tr key={asset.id} className="text-sm hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <Link
                      href={`/assets/${asset.id}`}
                      className="font-semibold text-slate-900 hover:text-brand-600"
                    >
                      {asset.name}
                    </Link>
                    <p className="mt-0.5 text-xs text-slate-500">{assetLabel(asset)}</p>
                  </td>
                  <td className="px-5 py-3">
                    {asset.assigned_to_name ? (
                      <>
                        <p className="font-medium text-slate-700">{asset.assigned_to_name}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{asset.assigned_to_email}</p>
                      </>
                    ) : (
                      <span className="text-slate-400">Unknown</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${assetStatusStyle(asset.status)}`}
                    >
                      {assetStatusLabel(asset.status)}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => release(asset)}
                      disabled={busyId !== ""}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {busyId === asset.id ? "Working…" : "Unassign"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!loading && assigned.length === 0 && !error && (
          <p className="p-10 text-center text-sm text-slate-500">Nothing is assigned right now.</p>
        )}
      </section>

      <SoftwareSeats seats={seats} onChanged={load} />

      <p>
        <Link href="/assets" className="text-sm font-bold text-brand-600 hover:text-brand-700">
          ← Back to all assets
        </Link>
      </p>
    </main>
  );
}

/** Software seats currently held, with release. New seats are given on Software Assets or by fulfilling a software request. */
function SoftwareSeats({ seats, onChanged }: { seats: SoftwareSeat[]; onChanged: () => void }) {
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const release = async (seat: SoftwareSeat) => {
    setBusy(seat.id);
    try {
      await releaseSeat(seat.id);
      setMessage(`${seat.software_name} released from ${seat.user_name}.`);
      onChanged();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not release the seat.");
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="font-extrabold text-slate-950">Software seats ({seats.length})</h2>
          <p className="text-xs text-slate-500">Who holds a seat of which product.</p>
        </div>
        <Link href="/assets/software" className="text-sm font-bold text-brand-600 hover:text-brand-700">Software Assets →</Link>
      </div>
      {message && <p className="border-b border-slate-100 bg-slate-50 px-5 py-2 text-xs text-slate-700">{message}</p>}
      {seats.length === 0 ? (
        <p className="p-8 text-center text-sm text-slate-500">No software seats assigned.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {seats.map((seat) => (
            <li key={seat.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
              <span className="min-w-0">
                <span className="block font-semibold text-slate-800">{seat.software_name} · {seat.user_name}</span>
                <span className="block text-xs text-slate-500">
                  {seat.license_number ?? "No license number"}
                  {seat.asset_label ? ` · on ${seat.asset_label}` : ""}
                </span>
              </span>
              <button type="button" disabled={busy === seat.id} onClick={() => release(seat)} className="text-xs font-bold text-rose-600 hover:text-rose-700 disabled:opacity-50">
                Release
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
