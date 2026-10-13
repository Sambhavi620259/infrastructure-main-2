"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { assignAsset, listAssets, unassignAsset } from "@/lib/assets";
import { listUsers } from "@/lib/users";
import { assetStatusLabel, assetStatusStyle, type Asset, assetLabel } from "@/types/asset";
import type { AppUser } from "@/types/user";
import { listSeats, releaseSeat, type SoftwareSeat } from "@/lib/software";

export default function AssetAssignmentPage() {
  const [assignable, setAssignable] = useState<Asset[]>([]);
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
      listAssets({ status: "REQUESTED", limit: 200 }),
      listAssets({ status: "ASSIGNED", limit: 200 }),
      listAssets({ status: "IN_USE", limit: 200 }),
      listAssets({ status: "RETURN_REQUESTED", limit: 200 }),
      listUsers({ limit: 200 }),
    ])
      .then(([inStock, requested, assignedNow, inUse, returning, people]) => {
        setAssignable([...inStock, ...requested]);
        setAssigned([...assignedNow, ...inUse, ...returning]);
        setUsers(people.filter((user) => user.status.toUpperCase() === "ACTIVE"));
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
    const form = new FormData(event.currentTarget);
    const assetId = String(form.get("asset_id") ?? "");
    const userId = String(form.get("user_id") ?? "");
    if (!assetId || !userId) return;

    setBusyId(assetId);
    setError("");
    try {
      const updated = await assignAsset(assetId, userId);
      setNotice(`${updated.name} assigned to ${updated.assigned_to_name ?? "the selected user"}.`);
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

  return (
    <main className="mx-auto max-w-7xl space-y-5">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-wider text-brand-600">
          Assets · Assignment
        </p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">Asset Assignment</h1>
        <p className="mt-1 text-sm text-slate-500">Hand a device to someone, or take it back into stock.</p>
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
          <h2 className="text-base font-extrabold text-slate-900">Assign a device</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Only assets in stock or requested can be assigned. {assignable.length} available.
          </p>
        </div>

        <form onSubmit={submit} className="grid gap-5 p-5 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <label className="text-xs font-bold text-slate-700">
            Asset
            <select
              required
              name="asset_id"
              defaultValue=""
              disabled={assignable.length === 0}
              className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-500 disabled:bg-slate-50"
            >
              <option value="" disabled>
                {assignable.length === 0 ? "Nothing available to assign" : "Select an asset"}
              </option>
              {assignable.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name} · {assetLabel(asset)}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-bold text-slate-700">
            Assign to
            <select
              required
              name="user_id"
              defaultValue=""
              disabled={users.length === 0}
              className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-500 disabled:bg-slate-50"
            >
              <option value="" disabled>
                {users.length === 0 ? "No active users" : "Select a person"}
              </option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.full_name} · {user.email}
                </option>
              ))}
            </select>
          </label>

          <button
            type="submit"
            disabled={loading || busyId !== "" || assignable.length === 0 || users.length === 0}
            className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busyId ? "Working…" : "Assign asset"}
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

      <SoftwareSeats />

      <p>
        <Link href="/assets" className="text-sm font-bold text-brand-600 hover:text-brand-700">
          ← Back to all assets
        </Link>
      </p>
    </main>
  );
}

/** Software seats currently held, with release. New seats are given on Software Assets or by fulfilling a software request. */
function SoftwareSeats() {
  const [seats, setSeats] = useState<SoftwareSeat[]>([]);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(() => {
    listSeats({ active: true }).then(setSeats).catch(() => setSeats([]));
  }, []);
  useEffect(load, [load]);

  const release = async (seat: SoftwareSeat) => {
    setBusy(seat.id);
    try {
      await releaseSeat(seat.id);
      setMessage(`${seat.software_name} released from ${seat.user_name}.`);
      load();
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
          <p className="text-xs text-slate-500">Who holds a seat of which product. Assign seats on Software Assets.</p>
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
