"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { getProfile } from "@/lib/profile";
import { createUser } from "@/lib/users";
import { SUB_ADMIN_MODULES, moduleLabel, roleLabel, type AppUser } from "@/types/user";

/** What each page may create. Users and the IT team are added on separate pages. */
const KINDS = {
  admin: {
    eyebrow: "Super Admin · Add IT Admin",
    title: "Add IT Admin",
    text: "Creates an IT Admin in your company with the password you set. Choose Sub Admin or Reporting User for a narrower role.",
    roles: [
      ["IT_ADMIN", "IT Admin"],
      ["SUB_ADMIN", "Sub Admin"],
      ["REPORTING_USER", "Reporting User"],
    ] as [string, string][],
  },
  user: {
    eyebrow: "Super Admin · Add User",
    title: "Add User",
    text: "Creates a user in your company with the password you set. Users raise requests and see only their own assets and tickets.",
    roles: [["EMPLOYEE", "User"]] as [string, string][],
  },
};

/** One page for adding one kind of person: the IT team (IT Admin and the narrower roles) or a user. */
export function AddPerson({ kind }: { kind: keyof typeof KINDS }) {
  const config = KINDS[kind];
  const [companyId, setCompanyId] = useState("");
  const [role, setRole] = useState(config.roles[0][0]);
  const [formKey, setFormKey] = useState(0);
  const [added, setAdded] = useState<AppUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getProfile().then((profile) => setCompanyId(profile.companyId ?? "")).catch(() => undefined);
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? "").trim();
    const modules = form.getAll("modules").map(String);
    if (!companyId) return setError("Your account is not in a company yet.");
    if (text("password").length < 8) return setError("The password must be at least 8 characters.");
    if (role === "SUB_ADMIN" && modules.length === 0) return setError("Choose at least one module for a Sub Admin.");
    setError("");
    setBusy(true);
    try {
      const person = await createUser({
        company_id: companyId,
        role,
        full_name: text("full_name"),
        email: text("email").toLowerCase(),
        password: text("password"),
        location: text("location") || undefined,
        modules: role === "SUB_ADMIN" ? modules : undefined,
      });
      setAdded(person);
      setFormKey((key) => key + 1); // a clean form, ready for the next person
      setRole(config.roles[0][0]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to add this person.");
    } finally {
      setBusy(false);
    }
  };

  const input = "mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";
  const label = "block text-xs font-bold text-slate-700";

  return (
    <main className="mx-auto max-w-3xl space-y-5">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-wider text-violet-600">{config.eyebrow}</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">{config.title}</h1>
        <p className="mt-1 text-sm text-slate-500">{config.text}</p>
      </header>

      {added && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span>
            <strong>{added.full_name}</strong> was added as {roleLabel(added.role)}. They can sign in with the password you set.
          </span>
          <Link href="/super-admin/work" className="font-semibold text-emerald-900 underline">
            See them in Team work
          </Link>
        </div>
      )}

      <form key={formKey} onSubmit={submit} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-2">
          {config.roles.length > 1 && (
            <label className={`${label} sm:col-span-2`}>
              Role
              <select value={role} onChange={(e) => setRole(e.target.value)} className={input}>
                {config.roles.map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className={label}>
            Full name
            <input name="full_name" required maxLength={150} className={input} />
          </label>
          <label className={label}>
            Email
            <input name="email" type="email" required autoComplete="off" className={input} />
          </label>
          <label className={label}>
            Password
            <input name="password" type="password" required minLength={8} autoComplete="new-password" className={input} />
          </label>
          <label className={label}>
            Location <span className="font-normal text-slate-400">(optional)</span>
            <input name="location" maxLength={150} className={input} />
          </label>
        </div>
        {role === "SUB_ADMIN" && (
          <fieldset className="mt-4">
            <legend className="text-xs font-bold text-slate-700">Modules</legend>
            <div className="mt-1.5 flex flex-wrap gap-4">
              {SUB_ADMIN_MODULES.map((value) => (
                <label key={value} className="flex items-center gap-1.5 text-sm text-slate-700">
                  <input type="checkbox" name="modules" value={value} />
                  {moduleLabel(value)}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
        <div className="mt-5 flex justify-end gap-3">
          <Link href="/super-admin/work" className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50">
            Back to Team work
          </Link>
          <button type="submit" disabled={busy} className="rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-60">
            {busy ? "Adding…" : config.title}
          </button>
        </div>
      </form>
    </main>
  );
}
