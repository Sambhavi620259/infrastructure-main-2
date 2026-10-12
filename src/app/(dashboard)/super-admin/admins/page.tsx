"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createSuperAdmin, formatDay, listSuperAdmins, setSuperAdminActive } from "@/lib/super-admin";
import { getProfile } from "@/lib/profile";
import { initialsOf, statusBadgeClass, type AppUser } from "@/types/user";

export default function PlatformAdminsPage() {
  const [admins, setAdmins] = useState<AppUser[]>([]);
  const [meId, setMeId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [confirming, setConfirming] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    getProfile()
      .then((profile) => setMeId(profile.id))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    listSuperAdmins()
      .then((data) => {
        if (!cancelled) setAdmins(data);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load platform admins.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const setActive = async (admin: AppUser, active: boolean) => {
    try {
      await setSuperAdminActive(admin.id, active);
      setNotice(`${admin.full_name} ${active ? "can sign in again" : "can no longer sign in"}.`);
      setError("");
      setConfirming("");
      setRefreshKey((key) => key + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Update failed.");
    }
  };

  return (
    <main className="mx-auto max-w-[1400px] space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-violet-600">Super Admin · Platform admins</p>
          <h1 className="mt-1 text-2xl font-extrabold text-slate-950">Platform administrators</h1>
          <p className="mt-1 text-sm text-slate-500">People with full access to every organization on the platform.</p>
        </div>
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          disabled={formOpen}
          className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700 disabled:opacity-60"
        >
          + Add Super Admin
        </button>
      </header>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {formOpen && (
        <AdminForm
          onCancel={() => setFormOpen(false)}
          onCreated={(admin) => {
            setFormOpen(false);
            setNotice(`${admin.full_name} is now a Super Admin and can sign in.`);
            setError("");
            setRefreshKey((key) => key + 1);
          }}
        />
      )}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <ul className="divide-y divide-slate-100">
          {admins.map((admin) => (
            <li key={admin.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-violet-50 text-xs font-bold text-violet-700">
                  {initialsOf(admin.full_name)}
                </span>
                <div>
                  <p className="font-bold text-slate-800">
                    {admin.full_name}
                    {admin.id === meId && <span className="ml-2 text-xs font-semibold text-slate-400">(you)</span>}
                  </p>
                  <p className="text-xs text-slate-500">
                    {admin.email} · since {formatDay(admin.created_at)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statusBadgeClass(admin.status)}`}>{admin.status}</span>
                {admin.id !== meId &&
                  (admin.status === "ACTIVE" ? (
                    confirming === admin.id ? (
                      <span className="inline-flex items-center gap-3 text-xs font-bold">
                        <span className="font-normal text-slate-500">Remove platform access?</span>
                        <button type="button" onClick={() => setActive(admin, false)} className="text-rose-600">
                          Deactivate
                        </button>
                        <button type="button" onClick={() => setConfirming("")} className="text-slate-500">
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => setConfirming(admin.id)} className="text-xs font-bold text-rose-600">
                        Deactivate
                      </button>
                    )
                  ) : (
                    <button type="button" onClick={() => setActive(admin, true)} className="text-xs font-bold text-emerald-700">
                      Reactivate
                    </button>
                  ))}
              </div>
            </li>
          ))}
        </ul>
        {!loading && admins.length === 0 && !error && (
          <p className="p-8 text-center text-sm text-slate-500">No platform admins found.</p>
        )}
      </section>
    </main>
  );
}

function AdminForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (admin: AppUser) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    if (name.length < 2 || !email) return setError("Enter a name and email.");
    if (password.length < 8) return setError("The temporary password needs at least 8 characters.");
    setBusy(true);
    try {
      onCreated(await createSuperAdmin({ name, email, password }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add the Super Admin.");
    } finally {
      setBusy(false);
    }
  };

  const inputClass = "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal";

  return (
    <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" noValidate>
      <h2 className="text-sm font-bold text-slate-900">Add a Super Admin</h2>
      <p className="mt-1 text-xs text-amber-700">They will have full control over every organization. Add only people you trust.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <label className="block text-xs font-semibold text-slate-600">
          Name
          <input name="name" className={inputClass} />
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Email
          <input name="email" type="email" className={inputClass} />
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Temporary password
          <input name="password" type="password" autoComplete="new-password" className={inputClass} />
        </label>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50">
          {busy ? "Adding…" : "Add Super Admin"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">
          Cancel
        </button>
      </div>
    </form>
  );
}
