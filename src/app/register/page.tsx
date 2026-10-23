"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { EnvelopeIcon, KeyIcon, LockClosedIcon, UserIcon } from "@heroicons/react/24/outline";
import { apiFetch } from "@/lib/api";
import { AuthLayout, IconField } from "@/components/auth/auth-layout";

type RegistrationRole = "IT_ADMIN" | "IT_AGENT" | "SUPER_ADMIN";

export default function RegisterPage() {
  const router = useRouter();
  const [role, setRole] = useState<RegistrationRole>("IT_ADMIN");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [registrationKey, setRegistrationKey] = useState("");
  const [registrationKeyConfirm, setRegistrationKeyConfirm] = useState("");
  // The platform has exactly one Super Admin. Until they register, the
  // Super Admin option is offered and they create the Super Admin key.
  const [superKeyExists, setSuperKeyExists] = useState<boolean | null>(null);
  const [superRegistrationOpen, setSuperRegistrationOpen] = useState(false);

  useEffect(() => {
    apiFetch<{ exists: boolean; registration_open?: boolean }>("/api/auth/super-admin-key")
      .then((data) => {
        setSuperKeyExists(data.exists);
        setSuperRegistrationOpen(Boolean(data.registration_open));
      })
      .catch(() => {
        setSuperKeyExists(true);
        setSuperRegistrationOpen(false);
      });
  }, []);

  const creatingSuperKey = role === "SUPER_ADMIN" && superKeyExists === false;
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (name.trim().length < 2) return setError("Enter your full name.");
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError("Enter a valid email address.");
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    if (role === "SUPER_ADMIN") {
      if (creatingSuperKey) {
        if (registrationKey.length < 8) return setError("Create a Super Admin key of at least 8 characters.");
        if (registrationKey !== registrationKeyConfirm) return setError("The two keys do not match.");
      } else if (!registrationKey) {
        return setError("Enter the Super Admin key.");
      }
    }

    setError("");
    setSubmitting(true);
    try {
      // One sign-up flow for every role. IT Agents start with no organization
      // until an IT Admin adds them from the Users page.
      await apiFetch("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
          role,
          registrationKey: role === "SUPER_ADMIN" ? registrationKey : undefined,
          registrationKeyConfirm: creatingSuperKey ? registrationKeyConfirm : undefined,
        }),
      });
      router.replace(`/login?role=${role}&email=${encodeURIComponent(email.trim())}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create your account.");
    } finally {
      setSubmitting(false);
    }
  };

  const errorBox = error && (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
      {error}
    </p>
  );
  return (
    <AuthLayout>
      <h2 className="text-3xl font-extrabold tracking-tight text-slate-950">Create Account</h2>
      <p className="mt-2 text-slate-500">
        {role === "IT_AGENT"
          ? "Sign up with your work email. An IT Admin will add you to their organization."
          : role === "SUPER_ADMIN"
            ? creatingSuperKey
              ? "You are setting up the platform's only Super Admin: create the key you will enter at every sign-in."
              : "Enter the Super Admin key."
            : "IT Admins get a new organization."}
      </p>

      <form className="mt-8 space-y-5" onSubmit={submit} noValidate>
        <label className="block text-sm font-semibold text-slate-700">
          Account type
          <select
            value={role}
            onChange={(event) => {
              setRole(event.target.value as RegistrationRole);
              setError("");
            }}
            className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-base font-normal text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          >
            <option value="IT_ADMIN">IT Admin</option>
            <option value="IT_AGENT">User</option>
            {superRegistrationOpen && <option value="SUPER_ADMIN">Super Admin (platform setup)</option>}
          </select>
        </label>
        <IconField
          label="Full name"
          icon={UserIcon}
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="name"
        />
        <IconField
          label="Email Address"
          icon={EnvelopeIcon}
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          placeholder="you@company.com"
        />
        <IconField
          label="Password"
          icon={LockClosedIcon}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
          placeholder="At least 8 characters"
        />
        {role === "SUPER_ADMIN" && superKeyExists !== null && (
          <>
            <IconField
              label={creatingSuperKey ? "Create Super Admin key" : "Super Admin key"}
              icon={KeyIcon}
              type="password"
              value={registrationKey}
              onChange={(event) => setRegistrationKey(event.target.value)}
              autoComplete="off"
              placeholder={creatingSuperKey ? "At least 8 characters" : "Your Super Admin key"}
            />
            {creatingSuperKey && (
              <>
                <IconField
                  label="Confirm Super Admin key"
                  icon={KeyIcon}
                  type="password"
                  value={registrationKeyConfirm}
                  onChange={(event) => setRegistrationKeyConfirm(event.target.value)}
                  autoComplete="off"
                />
                <p className="text-xs text-slate-500">
                  Keep this key safe. You will enter it every time you sign in as Super Admin, and it cannot be shown
                  again.
                </p>
              </>
            )}
          </>
        )}
        {errorBox}
        <button
          disabled={submitting}
          className="w-full rounded-xl bg-brand-500 px-4 py-3.5 text-base font-bold text-white shadow-sm transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Creating account…" : "Create Account"}
        </button>
      </form>

      <p className="mt-8 border-t border-slate-100 pt-6 text-center text-sm text-slate-500">
        Already have an account?{" "}
        <Link href="/login" className="font-bold text-brand-600 hover:text-brand-700">
          Sign In
        </Link>
      </p>
    </AuthLayout>
  );
}
