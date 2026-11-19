"use client";

import { useEffect, useState, type FormEvent } from "react";
import { assignLicense, createSoftware, listSoftware, type Software } from "@/lib/software";
import { listUserDirectory, type DirectoryEntry } from "@/lib/users";

const LICENSE_TYPES = ["PERPETUAL", "SUBSCRIPTION", "PER_USER", "SITE"] as const;

export default function SoftwareInventoryPage() {
  const [items, setItems] = useState<Software[]>([]);
  const [users, setUsers] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    listUserDirectory().then(setUsers).catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    listSoftware()
      .then((data) => {
        if (!cancelled) setItems(data);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load software.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const totalSeats = items.reduce((sum, item) => sum + item.total_licenses, 0);
  const usedSeats = items.reduce((sum, item) => sum + item.used_licenses, 0);

  return (
    <main className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-brand-600">Inventory · Software</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">Software Inventory</h1>
          <p className="mt-1 text-sm text-slate-500">Licences you own, seats in use, and who holds them.</p>
        </div>
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          disabled={formOpen}
          className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700 disabled:opacity-60"
        >
          Add software
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
          ["Products", items.length],
          ["Seats in use", usedSeats],
          ["Seats available", totalSeats - usedSeats],
        ].map(([label, value]) => (
          <article key={String(label)} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-2xl font-bold text-slate-950">{loading ? "—" : value}</p>
            <p className="mt-1 text-sm text-slate-600">{label}</p>
          </article>
        ))}
      </section>

      {formOpen && (
        <SoftwareForm
          onCancel={() => setFormOpen(false)}
          onSaved={(software) => {
            setFormOpen(false);
            setNotice(`${software.name} added with ${software.total_licenses} seat(s).`);
            setError("");
            setRefreshKey((key) => key + 1);
          }}
        />
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-[880px] w-full text-left">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600">
              <tr>
                {["Software", "Licence", "Seats used", "Cost", "Expires", ""].map((heading) => (
                  <th key={heading} className="px-5 py-3">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => {
                const full = item.used_licenses >= item.total_licenses;
                const expired = item.expiry_date ? new Date(item.expiry_date) < new Date() : false;
                return (
                  <tr key={item.id} className="align-top text-sm hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <p className="font-semibold text-slate-800">{item.name}</p>
                      <p className="text-xs text-slate-500">
                        {[item.vendor, item.version].filter(Boolean).join(" · ") || "—"}
                      </p>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{item.license_type.replace("_", " ").toLowerCase()}</td>
                    <td className="px-5 py-3">
                      <span className={`font-semibold ${full ? "text-rose-600" : "text-slate-800"}`}>
                        {item.used_licenses} / {item.total_licenses}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{Number(item.cost).toLocaleString()}</td>
                    <td className={`px-5 py-3 ${expired ? "font-semibold text-rose-600" : "text-slate-600"}`}>
                      {item.expiry_date ? new Date(item.expiry_date).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {assigning === item.id ? (
                        <AssignSeat
                          users={users}
                          onCancel={() => setAssigning(null)}
                          onAssign={async (userId, userName) => {
                            try {
                              await assignLicense(item.id, userId);
                              setAssigning(null);
                              setNotice(`${item.name} seat assigned to ${userName}.`);
                              setError("");
                              setRefreshKey((key) => key + 1);
                            } catch (caught) {
                              setError(caught instanceof Error ? caught.message : "Could not assign the seat.");
                            }
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          disabled={full}
                          title={full ? "All seats are in use" : undefined}
                          onClick={() => setAssigning(item.id)}
                          className="text-sm font-semibold text-brand-600 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Assign seat
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!loading && items.length === 0 && !error && (
          <p className="p-10 text-center text-sm text-slate-500">No software recorded yet.</p>
        )}
      </section>
    </main>
  );
}

function AssignSeat({
  users,
  onAssign,
  onCancel,
}: {
  users: DirectoryEntry[];
  onAssign: (userId: string, userName: string) => void;
  onCancel: () => void;
}) {
  const [userId, setUserId] = useState("");
  return (
    <span className="inline-flex items-center gap-2">
      <label>
        <span className="sr-only">User</span>
        <select value={userId} onChange={(event) => setUserId(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs">
          <option value="">Choose a user…</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.full_name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={!userId}
        onClick={() => onAssign(userId, users.find((user) => user.id === userId)?.full_name ?? "user")}
        className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
      >
        Assign
      </button>
      <button type="button" onClick={onCancel} className="text-xs font-semibold text-slate-600">
        Cancel
      </button>
    </span>
  );
}

function SoftwareForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: (software: Software) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? "").trim() || undefined;
    const name = text("name");
    const seats = Number(form.get("total_licenses"));
    if (!name) return setError("Enter the software name.");
    if (!Number.isInteger(seats) || seats < 1) return setError("Seats must be a whole number of at least 1.");
    setBusy(true);
    try {
      const expiry = text("expiry_date");
      onSaved(
        await createSoftware({
          name,
          vendor: text("vendor"),
          version: text("version"),
          license_type: text("license_type"),
          total_licenses: seats,
          cost: Number(form.get("cost")) || 0,
          expiry_date: expiry ? `${expiry}T00:00:00` : undefined,
        }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add the software.");
    } finally {
      setBusy(false);
    }
  };

  const inputClass = "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal";

  return (
    <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" noValidate>
      <h2 className="text-base font-extrabold text-slate-900">Add software</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-4">
        <label className="block text-xs font-semibold text-slate-600 sm:col-span-2">
          Name
          <input name="name" placeholder="e.g. Microsoft 365 Business" className={inputClass} />
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Vendor
          <input name="vendor" className={inputClass} />
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Version
          <input name="version" className={inputClass} />
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Licence type
          <select name="license_type" defaultValue="SUBSCRIPTION" className={inputClass}>
            {LICENSE_TYPES.map((type) => (
              <option key={type} value={type}>
                {type.replace("_", " ").toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Seats
          <input name="total_licenses" type="number" min={1} defaultValue={1} className={inputClass} />
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Total cost
          <input name="cost" type="number" min={0} step="0.01" className={inputClass} />
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Expires
          <input name="expiry_date" type="date" className={inputClass} />
        </label>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50">
          {busy ? "Saving…" : "Save software"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">
          Cancel
        </button>
      </div>
    </form>
  );
}
