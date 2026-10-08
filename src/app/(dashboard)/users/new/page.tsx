"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createUser, listDepartments } from "@/lib/users";
import { BACKEND_ROLES, SUB_ADMIN_MODULES, moduleLabel, roleLabel, type Department } from "@/types/user";

export default function NewUserPage() {
  const router = useRouter();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [role, setRole] = useState("EMPLOYEE");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listDepartments()
      .then((data) => {
        if (!cancelled) setDepartments(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? "").trim();

    setError("");
    setSubmitting(true);
    try {
      await createUser({
        full_name: text("full_name"),
        email: text("email").toLowerCase(),
        password: text("password"),
        role: text("role"),
        location: text("location") || undefined,
        department_id: text("department_id") || undefined,
        modules: role === "SUB_ADMIN" ? form.getAll("modules").map(String) : undefined,
      });
      router.push("/users");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create this user.");
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto max-w-4xl space-y-5">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-wider text-brand-600">
          Users \u00b7 Provisioning
        </p>
        <h1 className="mt-1 text-2xl font-extrabold">Create user</h1>
        <p className="mt-1 text-sm text-slate-500">
          Creates the account directly with the password you set. To invite an IT Agent to register themselves
          instead, use the invite action on the{" "}
          <Link href="/users" className="font-semibold text-brand-600 hover:text-brand-700">
            users list
          </Link>
          .
        </p>
      </header>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800"
        >
          {error}
        </div>
      )}

      <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="text-xs font-bold text-slate-700">
            Full name <span className="text-rose-500">*</span>
            <input
              required
              name="full_name"
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
              placeholder="e.g. Neha Verma"
            />
          </label>

          <label className="text-xs font-bold text-slate-700">
            Work email <span className="text-rose-500">*</span>
            <input
              required
              type="email"
              name="email"
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
              placeholder="name@company.com"
            />
          </label>

          <label className="text-xs font-bold text-slate-700">
            Temporary password <span className="text-rose-500">*</span>
            <input
              required
              type="password"
              name="password"
              minLength={8}
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
              placeholder="At least 8 characters"
            />
          </label>

          <label className="text-xs font-bold text-slate-700">
            Role <span className="text-rose-500">*</span>
            <select
              required
              name="role"
              value={role}
              onChange={(event) => setRole(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-500"
            >
              {BACKEND_ROLES.map((value) => (
                <option key={value} value={value}>
                  {roleLabel(value)}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-bold text-slate-700">
            Department
            <select
              name="department_id"
              defaultValue=""
              className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-500"
            >
              <option value="">
                {departments.length === 0 ? "No departments created yet" : "No department"}
              </option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-bold text-slate-700">
            Location
            <input
              name="location"
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
              placeholder="e.g. Mumbai \u00b7 HQ"
            />
          </label>
        </div>

        {role === "SUB_ADMIN" && (
          <fieldset className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <legend className="px-1 text-xs font-bold text-slate-700">Modules administered</legend>
            <p className="text-xs text-slate-500">
              A Sub Admin manages one or more modules. Everything they can reach follows from this.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {SUB_ADMIN_MODULES.map((value) => (
                <label key={value} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    name="modules"
                    value={value}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  {moduleLabel(value)}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div className="mt-5 flex justify-end gap-3">
          <Link
            href="/users"
            className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Creating\u2026" : "Create user"}
          </button>
        </div>
      </form>
    </main>
  );
}
