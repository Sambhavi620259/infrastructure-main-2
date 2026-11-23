"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { EnvelopeIcon, LockClosedIcon, UserIcon } from "@heroicons/react/24/outline";
import { apiFetch } from "@/lib/api";
import { AuthLayout, IconField } from "@/components/auth/auth-layout";

type RegistrationRole = "IT_ADMIN" | "IT_AGENT" | "SUPER_ADMIN";

export default function RegisterPage() {
  const router = useRouter();
  const [role, setRole] = useState<RegistrationRole>("IT_ADMIN");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // The platform has exactly one Super Admin: the Super Admin option is offered until they register.
  const [superRegistrationOpen, setSuperRegistrationOpen] = useState(false);
  // The server decides which account types may sign up on their own.
  const [itAdminSignupOpen, setItAdminSignupOpen] = useState(false);
  const [userSignupOpen, setUserSignupOpen] = useState(false);
  const [optionsLoaded, setOptionsLoaded] = useState(false);

  useEffect(() => {
    Promise.allSettled([
      apiFetch<{ registration_open?: boolean }>("/api/auth/super-admin-key"),
      apiFetch<{ it_admin?: boolean; super_admin?: boolean; user?: boolean }>("/api/auth/registration-options"),
    ]).then(([keyStatus, options]) => {
      const opts = options.status === "fulfilled" ? options.value : undefined;
      const superOpen =
        keyStatus.status === "fulfilled" &&
        Boolean(keyStatus.value.registration_open) &&
        !(opts && opts.super_admin === false);
      // If the server cannot be asked, offer nothing rather than a form that will be refused.
      const adminOpen = opts?.it_admin === true;
      const userOpen = opts?.user === true;
      setSuperRegistrationOpen(superOpen);
      setItAdminSignupOpen(adminOpen);
      setUserSignupOpen(userOpen);
      setRole(adminOpen ? "IT_ADMIN" : userOpen ? "IT_AGENT" : "SUPER_ADMIN");
      setOptionsLoaded(true);
    });
  }, []);

  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (name.trim().length < 2) return setError("Enter your full name.");
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError("Enter a valid email address.");
    if (password.length < 8) return setError("Password must be at least 8 characters.");

    setError("");
    setSubmitting(true);
    try {
      // One sign-up flow for every role. IT Agents start with no organization
      // until the Super Admin places them.
      await apiFetch("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
          role,
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
  if (optionsLoaded && !itAdminSignupOpen && !userSignupOpen && !superRegistrationOpen) {
    return (
      <AuthLayout>
        <h2 className="text-3xl font-extrabold tracking-tight text-slate-950">Sign-up is closed</h2>
        <p className="mt-2 text-slate-500">
          Accounts on this platform are created by your administrator. Ask them to add you, then sign in.
        </p>
        <Link
          href="/login"
          className="mt-8 inline-block rounded-xl bg-brand-500 px-5 py-3 text-base font-bold text-white hover:bg-brand-600"
        >
          Go to Sign In
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h2 className="text-3xl font-extrabold tracking-tight text-slate-950">Create Account</h2>
      <p className="mt-2 text-slate-500">
        {role === "IT_AGENT"
          ? "Sign up with your work email. The Super Admin will add you to the organization."
          : role === "SUPER_ADMIN"
            ? "You are setting up the platform's only Super Admin."
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
            {itAdminSignupOpen && <option value="IT_ADMIN">IT Admin</option>}
            {userSignupOpen && <option value="IT_AGENT">User</option>}
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
